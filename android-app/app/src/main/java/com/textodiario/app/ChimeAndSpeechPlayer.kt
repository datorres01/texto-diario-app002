package com.textodiario.app

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.media.MediaPlayer
import android.os.Bundle
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.speech.tts.Voice
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import java.io.File
import java.util.Locale
import kotlin.coroutines.resume
import kotlin.math.PI
import kotlin.math.exp
import kotlin.math.sin

class ChimeAndSpeechPlayer(private val context: Context) {
    private var mediaPlayer: MediaPlayer? = null
    private var tts: TextToSpeech? = null
    @Volatile
    private var stopped = false

    suspend fun playGentleChime(chimeType: String = "chime") = playChime(chimeType)

    suspend fun playChime(chimeType: String) = withContext(Dispatchers.IO) {
        if (stopped) return@withContext
        val sampleRate = 24000

        val notes: List<Pair<Double, Double>> = when (chimeType) {
            "harp" -> listOf(
                440.0 to 0.42,
                554.37 to 0.42,
                659.25 to 0.48,
                880.0 to 0.70
            )
            "tone" -> listOf(
                587.33 to 0.45,
                0.0 to 0.15,
                587.33 to 0.65
            )
            else -> listOf(
                523.25 to 0.50,
                659.25 to 0.55,
                783.99 to 0.75
            )
        }

        val totalSamples = notes.sumOf { (sampleRate * it.second).toInt() }
        val pcm = ShortArray(totalSamples)
        var offset = 0

        for ((freq, durSec) in notes) {
            val count = (sampleRate * durSec).toInt()
            if (freq > 0.0) {
                for (i in 0 until count) {
                    val t = i.toDouble() / sampleRate
                    val attack = minOf(1.0, t / 0.025)
                    val decay = exp(-t * 4.2)
                    val wave = sin(2.0 * PI * freq * t) * 0.76 +
                        sin(2.0 * PI * (freq * 2.0) * t) * 0.16
                    val sample = (wave * attack * decay * Short.MAX_VALUE * 0.45).toInt()
                        .coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt())
                    pcm[offset + i] = sample.toShort()
                }
            }
            offset += count
        }

        val track = AudioTrack.Builder()
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build()
            )
            .setAudioFormat(
                AudioFormat.Builder()
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setSampleRate(sampleRate)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .build()
            )
            .setBufferSizeInBytes(pcm.size * 2)
            .setTransferMode(AudioTrack.MODE_STATIC)
            .build()

        try {
            track.write(pcm, 0, pcm.size)
            track.play()
            val waitMs = (totalSamples * 1000L) / sampleRate
            var elapsed = 0L
            while (elapsed < waitMs && !stopped) {
                delay(50)
                elapsed += 50
            }
        } finally {
            try {
                track.stop()
                track.release()
            } catch (_: Exception) {
            }
        }
    }

    suspend fun speakText(
        text: String,
        prefs: PrefsManager,
        onFallbackNotice: ((String) -> Unit)? = null
    ): Boolean {
        if (stopped) return false
        val cleanText = DailyTextRepository.sanitizeForSpeech(text)

        val ttsResult = DailyTextRepository.fetchGeminiTtsWav(
            context = context,
            baseUrl = prefs.apiBaseUrl,
            text = cleanText,
            voiceName = prefs.voiceName
        )

        if (stopped) return false

        if (ttsResult.wavBytes != null) {
            val played = playWavBytes(ttsResult.wavBytes, prefs.speechRate)
            if (played) return true
        }

        if (stopped) return false
        onFallbackNotice?.invoke(
            ttsResult.errorReason ?: "Usando voz local del teléfono."
        )
        return speakWithDeviceTts(cleanText, prefs.speechRate)
    }

    private suspend fun playWavBytes(wavBytes: ByteArray, rate: Float): Boolean =
        withContext(Dispatchers.Main) {
            val tempFile = File.createTempFile("td_voice_", ".wav", context.cacheDir)
            tempFile.writeBytes(wavBytes)

            suspendCancellableCoroutine { cont ->
                val mp = MediaPlayer()
                mediaPlayer = mp
                try {
                    mp.setAudioAttributes(
                        AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_ALARM)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                            .build()
                    )
                    mp.setDataSource(tempFile.absolutePath)
                    mp.setOnPreparedListener { player ->
                        if (stopped) {
                            player.release()
                            tempFile.delete()
                            if (cont.isActive) cont.resume(false)
                            return@setOnPreparedListener
                        }
                        try {
                            player.playbackParams = player.playbackParams.setSpeed(rate)
                        } catch (_: Exception) {
                        }
                        player.start()
                    }
                    mp.setOnCompletionListener { player ->
                        player.release()
                        if (mediaPlayer === player) mediaPlayer = null
                        tempFile.delete()
                        if (cont.isActive) cont.resume(!stopped)
                    }
                    mp.setOnErrorListener { player, _, _ ->
                        player.release()
                        if (mediaPlayer === player) mediaPlayer = null
                        tempFile.delete()
                        if (cont.isActive) cont.resume(false)
                        true
                    }
                    mp.prepareAsync()
                } catch (_: Exception) {
                    try {
                        mp.release()
                    } catch (_: Exception) {
                    }
                    mediaPlayer = null
                    tempFile.delete()
                    if (cont.isActive) cont.resume(false)
                }

                cont.invokeOnCancellation {
                    try {
                        mp.stop()
                        mp.release()
                    } catch (_: Exception) {
                    }
                    tempFile.delete()
                }
            }
        }

    private suspend fun speakWithDeviceTts(text: String, rate: Float): Boolean =
        suspendCancellableCoroutine { cont ->
            var localTts: TextToSpeech? = null
            localTts = TextToSpeech(context.applicationContext) { status ->
                if (status != TextToSpeech.SUCCESS || stopped) {
                    localTts?.shutdown()
                    if (cont.isActive) cont.resume(false)
                    return@TextToSpeech
                }
                val engine = localTts ?: return@TextToSpeech
                tts = engine

                val res = engine.setLanguage(Locale("es", "MX"))
                if (res == TextToSpeech.LANG_MISSING_DATA || res == TextToSpeech.LANG_NOT_SUPPORTED) {
                    engine.language = Locale("es", "ES")
                }

                try {
                    val bestSpanishVoice = engine.voices
                        ?.filter { it.locale.language == "es" && !it.features.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED) }
                        ?.sortedWith(
                            compareByDescending<Voice> { it.quality }
                                .thenByDescending { it.locale.country in listOf("MX", "US", "419", "ES") }
                        )
                        ?.firstOrNull()
                    if (bestSpanishVoice != null) {
                        engine.voice = bestSpanishVoice
                    }
                } catch (_: Exception) {
                }

                engine.setSpeechRate(rate)
                engine.setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build()
                )
                engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                    override fun onStart(utteranceId: String?) {}
                    override fun onDone(utteranceId: String?) {
                        engine.shutdown()
                        if (tts === engine) tts = null
                        if (cont.isActive) cont.resume(!stopped)
                    }

                    @Deprecated("Deprecated in Java")
                    override fun onError(utteranceId: String?) {
                        engine.shutdown()
                        if (tts === engine) tts = null
                        if (cont.isActive) cont.resume(false)
                    }
                })
                val params = Bundle()
                engine.speak(text, TextToSpeech.QUEUE_FLUSH, params, "texto_diario_utt")
            }

            cont.invokeOnCancellation {
                try {
                    localTts?.stop()
                    localTts?.shutdown()
                } catch (_: Exception) {
                }
            }
        }

    fun pause(): Boolean {
        val mp = mediaPlayer
        if (mp != null) {
            return try {
                if (mp.isPlaying) {
                    mp.pause()
                    true
                } else {
                    false
                }
            } catch (_: Exception) {
                false
            }
        }
        return false
    }

    fun resume(): Boolean {
        val mp = mediaPlayer
        if (mp != null) {
            return try {
                if (!mp.isPlaying) {
                    mp.start()
                    true
                } else {
                    false
                }
            } catch (_: Exception) {
                false
            }
        }
        return false
    }

    fun stop() {
        stopped = true
        try {
            mediaPlayer?.stop()
            mediaPlayer?.release()
        } catch (_: Exception) {
        }
        mediaPlayer = null

        try {
            tts?.stop()
            tts?.shutdown()
        } catch (_: Exception) {
        }
        tts = null
    }
}
