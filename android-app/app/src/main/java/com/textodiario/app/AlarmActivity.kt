package com.textodiario.app

import android.app.KeyguardManager
import android.app.TimePickerDialog
import android.content.Context
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import androidx.appcompat.app.AppCompatActivity
import com.textodiario.app.databinding.ActivityAlarmBinding
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

class AlarmActivity : AppCompatActivity() {

    private lateinit var binding: ActivityAlarmBinding
    private lateinit var prefs: PrefsManager
    private var player: ChimeAndSpeechPlayer? = null
    private var alarmJob: Job? = null
    private var isPaused = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
            val km = getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
            km.requestDismissKeyguard(this, null)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                    WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                    WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
            )
        }
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        binding = ActivityAlarmBinding.inflate(layoutInflater)
        setContentView(binding.root)

        prefs = PrefsManager(this)
        binding.tvAlarmClock.text = SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date())

        setupControls()
        startAlarmSequence()
    }

    private fun setupControls() {
        binding.btnStopAlarm.setOnClickListener {
            stopAndFinish()
        }

        binding.btnPauseOrResume.setOnClickListener {
            if (!isPaused) {
                val pausedNow = player?.pause() ?: false
                isPaused = true
                if (!pausedNow) {
                    player?.stop()
                    alarmJob?.cancel()
                }
                binding.btnPauseOrResume.text = "Continuar lectura"
                binding.tvAlarmStatus.text = "Lectura en pausa"
                binding.layoutPostponeOptions.visibility = View.VISIBLE
            } else {
                val resumed = player?.resume() ?: false
                isPaused = false
                binding.btnPauseOrResume.text = "Pausar y leer después"
                binding.layoutPostponeOptions.visibility = View.GONE
                if (!resumed) {
                    startAlarmSequence()
                } else {
                    binding.tvAlarmStatus.text = "Leyendo el texto diario..."
                }
            }
        }

        binding.btnSnooze15m.setOnClickListener { postponeMinutes(15) }
        binding.btnSnooze30m.setOnClickListener { postponeMinutes(30) }
        binding.btnSnooze1h.setOnClickListener { postponeMinutes(60) }
        binding.btnSnooze2h.setOnClickListener { postponeMinutes(120) }
        binding.btnSnooze3h.setOnClickListener { postponeMinutes(180) }

        binding.btnSnoozeCustom.setOnClickListener {
            val now = Calendar.getInstance()
            TimePickerDialog(
                this,
                { _, hourOfDay, minute ->
                    val target = Calendar.getInstance().apply {
                        set(Calendar.HOUR_OF_DAY, hourOfDay)
                        set(Calendar.MINUTE, minute)
                        set(Calendar.SECOND, 0)
                        set(Calendar.MILLISECOND, 0)
                        if (timeInMillis <= System.currentTimeMillis()) {
                            add(Calendar.DAY_OF_YEAR, 1)
                        }
                    }
                    AlarmScheduler.scheduleSnoozeAt(this, target.timeInMillis)
                    stopAndFinish()
                },
                now.get(Calendar.HOUR_OF_DAY),
                now.get(Calendar.MINUTE),
                false
            ).show()
        }
    }

    private fun postponeMinutes(minutes: Int) {
        AlarmScheduler.scheduleSnoozeMinutes(this, minutes)
        stopAndFinish()
    }

    private fun startAlarmSequence() {
        alarmJob?.cancel()
        player?.stop()

        val localPlayer = ChimeAndSpeechPlayer(this)
        player = localPlayer

        alarmJob = CoroutineScope(Dispatchers.Main).launch {
            binding.tvAlarmStatus.text = "Sonando alarma..."
            val textFuture = launch(Dispatchers.IO) {
                try {
                    val today = PrefsManager.todayIso()
                    val daily = DailyTextRepository.getDailyText(prefs, today)
                    runOnUiThread {
                        binding.tvAlarmDateTitle.text = daily.dateTitle
                        binding.tvAlarmScripture.text = daily.themeScripture
                        binding.tvAlarmBody.text = daily.bodyParagraphs.joinToString("\n\n")
                    }
                } catch (_: Exception) {
                }
            }

            localPlayer.playChime(prefs.chimeType)
            binding.tvAlarmStatus.text = "Anunciando: Hora de leer el texto diario"
            localPlayer.speakText("Hora de leer el texto diario.", prefs) { reason ->
                binding.tvAlarmStatus.text = "Voz local ($reason)"
            }

            if (prefs.autoReadOnAlarm) {
                textFuture.join()
                val today = PrefsManager.todayIso()
                try {
                    val daily = DailyTextRepository.getDailyText(prefs, today)
                    binding.tvAlarmStatus.text = "Leyendo con voz IA (${prefs.voiceName})..."
                    val completed = localPlayer.speakText(daily.spokenText, prefs) { reason ->
                        binding.tvAlarmStatus.text = "Leyendo con voz local: $reason"
                    }
                    if (completed) {
                        prefs.markDateCompleted(today)
                        binding.tvAlarmStatus.text = "Lectura completada ✓"
                    }
                } catch (_: Exception) {
                    binding.tvAlarmStatus.text = "No se pudo descargar el texto de hoy"
                }
            } else {
                binding.tvAlarmStatus.text = "Listo para leer"
            }
        }
    }

    private fun stopAndFinish() {
        alarmJob?.cancel()
        player?.stop()
        player = null
        finish()
    }

    override fun onDestroy() {
        alarmJob?.cancel()
        player?.stop()
        player = null
        super.onDestroy()
    }
}
