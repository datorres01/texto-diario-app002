package com.textodiario.app

import android.annotation.SuppressLint
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.os.Handler
import android.os.Looper
import android.util.Base64
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

class LiveVoiceManager(private val listener: Listener) {

    interface Listener {
        fun onStatusChanged(status: String, isActive: Boolean)
        fun onTranscript(speaker: String, text: String)
        fun onAiSpeakingChanged(speaking: Boolean)
        fun onError(message: String)
        fun onClosed()
    }

    private val mainHandler = Handler(Looper.getMainLooper())
    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .build()

    private var webSocket: WebSocket? = null
    private var audioRecord: AudioRecord? = null
    private var echoCanceler: AcousticEchoCanceler? = null
    private var audioTrack: AudioTrack? = null
    private var playbackExecutor: ExecutorService? = null

    @Volatile
    private var running = false

    @Volatile
    var isMuted = false
        private set

    fun setMuted(muted: Boolean) {
        isMuted = muted
    }

    fun start(baseUrl: String, voiceName: String, dailyContext: String) {
        stop()
        val cleanBase = baseUrl.trim().trimEnd('/')
        if (cleanBase.isBlank()) {
            listener.onError("Falta la URL del servidor de voz IA en Ajustes.")
            return
        }

        val wsUrl = when {
            cleanBase.startsWith("https://") -> "wss://${cleanBase.removePrefix("https://")}/api/live"
            cleanBase.startsWith("http://") -> "ws://${cleanBase.removePrefix("http://")}/api/live"
            else -> "wss://$cleanBase/api/live"
        }

        running = true
        isMuted = false
        mainHandler.post { listener.onStatusChanged("Conectando micrófono y voz en vivo...", false) }

        val request = Request.Builder().url(wsUrl).build()
        webSocket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(ws: WebSocket, response: Response) {
                val initJson = JSONObject().apply {
                    put("type", "init")
                    put("voiceName", voiceName)
                    put("dailyContext", dailyContext)
                }.toString()
                ws.send(initJson)
            }

            override fun onMessage(ws: WebSocket, text: String) {
                if (!running) return
                try {
                    val msg = JSONObject(text)
                    if (msg.optBoolean("ready", false)) {
                        startAudioIo()
                        mainHandler.post {
                            listener.onStatusChanged("Escuchando · Habla cuando quieras", true)
                        }
                    }

                    if (msg.has("audio")) {
                        val b64 = msg.optString("audio", "")
                        if (b64.isNotBlank()) {
                            enqueuePcmPlayback(b64)
                        }
                    }

                    if (msg.optBoolean("interrupted", false)) {
                        clearPlaybackBuffer()
                    }

                    val inputText = msg.optString("inputTranscript", "")
                    if (inputText.isNotBlank()) {
                        mainHandler.post { listener.onTranscript("user", inputText) }
                    }

                    val outputText = msg.optString("outputTranscript", "")
                    if (outputText.isNotBlank()) {
                        mainHandler.post { listener.onTranscript("ai", outputText) }
                    }

                    if (msg.optBoolean("turnComplete", false)) {
                        mainHandler.post { listener.onAiSpeakingChanged(false) }
                    }

                    if (msg.has("error")) {
                        val err = msg.optString("error", "Error en conversación en vivo.")
                        mainHandler.post { listener.onError(err) }
                    }

                    if (msg.optBoolean("closed", false)) {
                        stop()
                        mainHandler.post { listener.onClosed() }
                    }
                } catch (_: Exception) {
                }
            }

            override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                if (!running) return
                val codeInfo = response?.code?.let { " (HTTP $it)" } ?: ""
                val msg = if (response?.code == 404) {
                    "Servidor no publicado todavía (404). Publica tu app en AI Studio (Deploy App)."
                } else {
                    "No se pudo conectar la voz en vivo$codeInfo: ${t.message ?: ""}"
                }
                stop()
                mainHandler.post { listener.onError(msg) }
            }

            override fun onClosed(ws: WebSocket, code: Int, reason: String) {
                if (running) {
                    stop()
                    mainHandler.post { listener.onClosed() }
                }
            }
        })
    }

    fun sendTextPrompt(text: String) {
        val clean = text.trim()
        if (clean.isBlank()) return
        val ws = webSocket ?: return
        val json = JSONObject().apply { put("text", clean) }.toString()
        ws.send(json)
    }

    @SuppressLint("MissingPermission")
    private fun startAudioIo() {
        try {
            val outRate = 24000
            val outMin = AudioTrack.getMinBufferSize(
                outRate,
                AudioFormat.CHANNEL_OUT_MONO,
                AudioFormat.ENCODING_PCM_16BIT
            ).coerceAtLeast(4096)

            val track = AudioTrack.Builder()
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build()
                )
                .setAudioFormat(
                    AudioFormat.Builder()
                        .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                        .setSampleRate(outRate)
                        .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                        .build()
                )
                .setBufferSizeInBytes(outMin * 4)
                .setTransferMode(AudioTrack.MODE_STREAM)
                .build()
            track.play()
            audioTrack = track
            playbackExecutor = Executors.newSingleThreadExecutor()

            val inRate = 16000
            val inMin = AudioRecord.getMinBufferSize(
                inRate,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT
            ).coerceAtLeast(4096)

            val rec = AudioRecord(
                MediaRecorder.AudioSource.VOICE_COMMUNICATION,
                inRate,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT,
                inMin * 2
            )
            if (rec.state != AudioRecord.STATE_INITIALIZED) {
                rec.release()
                mainHandler.post { listener.onError("No se pudo iniciar el micrófono.") }
                return
            }

            try {
                if (AcousticEchoCanceler.isAvailable()) {
                    echoCanceler = AcousticEchoCanceler.create(rec.audioSessionId)?.apply {
                        enabled = true
                    }
                }
            } catch (_: Throwable) {
            }

            audioRecord = rec
            rec.startRecording()

            thread(start = true, name = "LiveMicCapture") {
                val buf = ByteArray(3200) // ~100ms at 16kHz PCM16
                while (running && rec.recordingState == AudioRecord.RECORDSTATE_RECORDING) {
                    val read = rec.read(buf, 0, buf.size)
                    if (read > 0 && !isMuted && running) {
                        val b64 = Base64.encodeToString(buf, 0, read, Base64.NO_WRAP)
                        val payload = JSONObject().apply { put("audio", b64) }.toString()
                        webSocket?.send(payload)
                    }
                }
            }
        } catch (se: SecurityException) {
            mainHandler.post { listener.onError("Falta permiso de micrófono para conversar por voz.") }
            stop()
        } catch (e: Exception) {
            mainHandler.post { listener.onError(e.message ?: "Error al iniciar audio en vivo.") }
            stop()
        }
    }

    private fun enqueuePcmPlayback(base64Audio: String) {
        val exec = playbackExecutor ?: return
        exec.execute {
            if (!running) return@execute
            try {
                val pcm = Base64.decode(base64Audio, Base64.DEFAULT)
                if (pcm.isNotEmpty()) {
                    mainHandler.post { listener.onAiSpeakingChanged(true) }
                    audioTrack?.write(pcm, 0, pcm.size)
                }
            } catch (_: Exception) {
            }
        }
    }

    private fun clearPlaybackBuffer() {
        mainHandler.post { listener.onAiSpeakingChanged(false) }
        try {
            audioTrack?.let {
                it.pause()
                it.flush()
                it.play()
            }
        } catch (_: Exception) {
        }
    }

    fun stop() {
        running = false
        try {
            webSocket?.close(1000, "closed")
        } catch (_: Exception) {
        }
        webSocket = null

        try {
            echoCanceler?.release()
        } catch (_: Exception) {
        }
        echoCanceler = null

        try {
            audioRecord?.stop()
            audioRecord?.release()
        } catch (_: Exception) {
        }
        audioRecord = null

        try {
            playbackExecutor?.shutdownNow()
        } catch (_: Exception) {
        }
        playbackExecutor = null

        try {
            audioTrack?.pause()
            audioTrack?.flush()
            audioTrack?.stop()
            audioTrack?.release()
        } catch (_: Exception) {
        }
        audioTrack = null
    }
}
