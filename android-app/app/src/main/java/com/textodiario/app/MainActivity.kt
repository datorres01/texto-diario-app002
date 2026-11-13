package com.textodiario.app

import android.Manifest
import android.app.AlarmManager
import android.app.TimePickerDialog
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.GridLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.google.android.material.button.MaterialButton
import com.google.android.material.materialswitch.MaterialSwitch
import com.textodiario.app.databinding.ActivityMainBinding
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

class MainActivity : AppCompatActivity() {

    private data class ChatEntry(
        val speaker: String, // "user" or "ai"
        var text: String
    )

    private lateinit var binding: ActivityMainBinding
    private lateinit var prefs: PrefsManager
    private var selectedDateOffset = 0
    private var currentDailyText: DailyText? = null
    private var inlinePlayer: ChimeAndSpeechPlayer? = null
    private var inlineJob: Job? = null
    private var previewJob: Job? = null

    private var liveVoiceManager: LiveVoiceManager? = null
    private var isLiveVoiceRunning = false
    private val chatMessages = mutableListOf<ChatEntry>()
    private val textChatHistory = mutableListOf<Pair<String, String>>()

    private val notifPermLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            refreshPermissionButtons()
            if (granted && prefs.unlockModeEnabled) {
                UnlockMonitorService.start(this)
            }
        }

    private val micPermLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            refreshPermissionButtons()
            if (granted) {
                startLiveVoiceSession()
            } else {
                Toast.makeText(
                    this,
                    "Necesitas permitir el micrófono para hablar en vivo.",
                    Toast.LENGTH_SHORT
                ).show()
            }
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = PrefsManager(this)
        prefs.applyThemeMode()

        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        setupNavigation()
        setupTodayTab()
        setupChatTab()
        setupScheduleTab()
        setupSettingsTab()
        refreshThemeLabels()

        AlarmScheduler.restoreAll(this)
        if (prefs.unlockModeEnabled) {
            UnlockMonitorService.start(this)
        }

        loadSelectedDayText()
        refreshServerHealth()
    }

    override fun onResume() {
        super.onResume()
        refreshSnoozeBanner()
        refreshPermissionButtons()
        refreshStreakAndHistory()
        refreshChatHeader()
    }

    private fun setupNavigation() {
        binding.bottomNav.setOnItemSelectedListener { item ->
            showTab(item.itemId)
            true
        }

        binding.btnTopTheme.setOnClickListener {
            toggleThemeMode()
        }

        binding.btnTopTestAlarm.setOnClickListener {
            startActivity(Intent(this, AlarmActivity::class.java))
        }
    }

    private fun showTab(itemId: Int) {
        binding.tabToday.visibility = if (itemId == R.id.nav_today) View.VISIBLE else View.GONE
        binding.tabChat.visibility = if (itemId == R.id.nav_chat) View.VISIBLE else View.GONE
        binding.tabSchedule.visibility = if (itemId == R.id.nav_schedule) View.VISIBLE else View.GONE
        binding.tabSettings.visibility = if (itemId == R.id.nav_settings) View.VISIBLE else View.GONE
        if (binding.bottomNav.selectedItemId != itemId) {
            binding.bottomNav.selectedItemId = itemId
        }
        binding.mainScrollView.scrollTo(0, 0)
    }

    private fun toggleThemeMode() {
        prefs.themeMode = if (prefs.themeMode == "dark") "light" else "dark"
        prefs.applyThemeMode()
    }

    private fun refreshThemeLabels() {
        val isDark = prefs.themeMode == "dark"
        binding.btnTopTheme.text = if (isDark) "Claro" else "Oscuro"
        binding.tvThemeDesc.text = if (isDark) "Modo oscuro activo" else "Modo claro activo"
        binding.btnToggleTheme.text = if (isDark) "Cambiar a claro" else "Cambiar a oscuro"
    }

    private fun setupTodayTab() {
        binding.btnPrevDay.setOnClickListener {
            selectedDateOffset -= 1
            loadSelectedDayText()
        }
        binding.btnGoToday.setOnClickListener {
            selectedDateOffset = 0
            loadSelectedDayText()
        }
        binding.btnNextDay.setOnClickListener {
            selectedDateOffset += 1
            loadSelectedDayText()
        }

        binding.btnOpenChat.setOnClickListener {
            showTab(R.id.nav_chat)
        }

        binding.btnListenInline.setOnClickListener {
            val daily = currentDailyText ?: return@setOnClickListener
            stopInlineAudio()
            binding.tvAudioNotice.visibility = View.GONE

            val player = ChimeAndSpeechPlayer(this)
            inlinePlayer = player
            binding.btnListenInline.isEnabled = false
            binding.btnListenInline.text = "Cargando voz IA..."
            binding.btnStopInline.visibility = View.VISIBLE

            inlineJob = CoroutineScope(Dispatchers.Main).launch {
                val ok = player.speakText(daily.spokenText, prefs) { reason ->
                    binding.tvAudioNotice.text =
                        "Se usó voz del teléfono porque el servidor IA respondió: $reason"
                    binding.tvAudioNotice.visibility = View.VISIBLE
                }
                if (ok) {
                    prefs.markDateCompleted(daily.date)
                    refreshCompletedButton()
                    refreshStreakAndHistory()
                }
                binding.btnListenInline.isEnabled = true
                binding.btnListenInline.text = "Escuchar voz IA"
                binding.btnStopInline.visibility = View.GONE
            }
        }

        binding.btnStopInline.setOnClickListener {
            stopInlineAudio()
        }

        binding.btnMarkCompleted.setOnClickListener {
            val daily = currentDailyText ?: return@setOnClickListener
            prefs.toggleDateCompleted(daily.date)
            refreshCompletedButton()
            refreshStreakAndHistory()
        }

        binding.btnCancelSnooze.setOnClickListener {
            AlarmScheduler.cancelSnooze(this)
            refreshSnoozeBanner()
        }
    }

    private fun stopInlineAudio() {
        inlineJob?.cancel()
        inlinePlayer?.stop()
        inlinePlayer = null
        binding.btnListenInline.isEnabled = true
        binding.btnListenInline.text = "Escuchar voz IA"
        binding.btnStopInline.visibility = View.GONE
    }

    private fun loadSelectedDayText() {
        val dateIso = PrefsManager.dateIsoForOffset(selectedDateOffset)
        binding.tvDateTitle.text = "Cargando texto..."
        binding.tvThemeScripture.text = ""
        binding.tvBodyText.text = ""

        CoroutineScope(Dispatchers.Main).launch {
            try {
                val daily = DailyTextRepository.getDailyText(prefs, dateIso)
                currentDailyText = daily
                binding.tvDateTitle.text = daily.dateTitle
                binding.tvThemeScripture.text = daily.themeScripture
                binding.tvBodyText.text = daily.bodyParagraphs.joinToString("\n\n")
                refreshCompletedButton()
                refreshChatHeader()

                // Pre-cache AI voice audio silently so alarm playback is instant
                CoroutineScope(Dispatchers.IO).launch {
                    DailyTextRepository.precacheDailyAudio(applicationContext, prefs, daily)
                }
            } catch (e: Exception) {
                binding.tvDateTitle.text = "Sin conexión"
                binding.tvBodyText.text = e.message ?: "No se pudo cargar el texto diario."
            }
        }
    }

    private fun refreshCompletedButton() {
        val dateIso = currentDailyText?.date ?: PrefsManager.todayIso()
        val done = prefs.getCompletedDates().contains(dateIso)
        binding.btnMarkCompleted.text = if (done) "Lectura completada ✓" else "Marcar como leído"
    }

    private fun refreshSnoozeBanner() {
        val target = prefs.snoozeTargetMs
        if (target > System.currentTimeMillis()) {
            val fmt = SimpleDateFormat("hh:mm a", Locale.getDefault()).format(Date(target))
            binding.tvSnoozeInfo.text = "Lectura programada automáticamente a las $fmt"
            binding.cardSnoozeBanner.visibility = View.VISIBLE
        } else {
            binding.cardSnoozeBanner.visibility = View.GONE
        }
    }

    // ---------------- TAB 2: CONVERSAR ----------------

    private fun setupChatTab() {
        binding.btnStartLiveVoice.setOnClickListener {
            if (isLiveVoiceRunning) {
                stopLiveVoiceSession()
            } else {
                val hasMic = ContextCompat.checkSelfPermission(
                    this,
                    Manifest.permission.RECORD_AUDIO
                ) == PackageManager.PERMISSION_GRANTED
                if (hasMic) {
                    startLiveVoiceSession()
                } else {
                    micPermLauncher.launch(Manifest.permission.RECORD_AUDIO)
                }
            }
        }

        binding.btnMuteLiveVoice.setOnClickListener {
            val mgr = liveVoiceManager ?: return@setOnClickListener
            val nextMute = !mgr.isMuted
            mgr.setMuted(nextMute)
            binding.btnMuteLiveVoice.text = if (nextMute) "Activar mic" else "Silenciar"
            binding.tvLiveStatus.text = if (nextMute) {
                "Micrófono silenciado"
            } else {
                "Escuchando · Habla cuando quieras"
            }
        }

        binding.btnSendChat.setOnClickListener {
            sendWrittenQuestion()
        }

        binding.etChatInput.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_SEND) {
                sendWrittenQuestion()
                true
            } else {
                false
            }
        }

        refreshChatHeader()
    }

    private fun refreshChatHeader() {
        val title = currentDailyText?.dateTitle ?: "Texto del día"
        binding.tvChatContextTitle.text = "$title · Voz IA: ${prefs.voiceName}"
    }

    private fun buildDailyContextForChat(): String {
        val daily = currentDailyText ?: return ""
        return "${daily.dateTitle}\nCita: ${daily.themeScripture}\nComentario: ${daily.bodyParagraphs.joinToString(" ")}"
    }

    private fun startLiveVoiceSession() {
        stopInlineAudio()
        isLiveVoiceRunning = true
        binding.btnStartLiveVoice.text = "Terminar voz"
        binding.btnMuteLiveVoice.visibility = View.VISIBLE
        binding.btnMuteLiveVoice.text = "Silenciar"

        val manager = LiveVoiceManager(object : LiveVoiceManager.Listener {
            override fun onStatusChanged(status: String, isActive: Boolean) {
                binding.tvLiveStatus.text = status
            }

            override fun onTranscript(speaker: String, text: String) {
                appendChatMessage(speaker, text, mergeSameSpeaker = true)
            }

            override fun onAiSpeakingChanged(speaking: Boolean) {
                if (!isLiveVoiceRunning) return
                val muted = liveVoiceManager?.isMuted == true
                binding.tvLiveStatus.text = when {
                    speaking -> "Respondiendo con voz IA (${prefs.voiceName})..."
                    muted -> "Micrófono silenciado"
                    else -> "Escuchando · Habla cuando quieras"
                }
            }

            override fun onError(message: String) {
                isLiveVoiceRunning = false
                binding.btnStartLiveVoice.text = "Hablar en vivo"
                binding.btnMuteLiveVoice.visibility = View.GONE
                binding.tvLiveStatus.text = message
            }

            override fun onClosed() {
                isLiveVoiceRunning = false
                binding.btnStartLiveVoice.text = "Hablar en vivo"
                binding.btnMuteLiveVoice.visibility = View.GONE
                binding.tvLiveStatus.text = "Conversación por voz finalizada."
            }
        })

        liveVoiceManager = manager
        manager.start(prefs.apiBaseUrl, prefs.voiceName, buildDailyContextForChat())
    }

    private fun stopLiveVoiceSession() {
        liveVoiceManager?.stop()
        liveVoiceManager = null
        isLiveVoiceRunning = false
        binding.btnStartLiveVoice.text = "Hablar en vivo"
        binding.btnMuteLiveVoice.visibility = View.GONE
        binding.tvLiveStatus.text = "Toca «Hablar en vivo» para conversar con micrófono, o escribe abajo."
    }

    private fun sendWrittenQuestion() {
        val text = binding.etChatInput.text.toString().trim()
        if (text.isEmpty()) return
        binding.etChatInput.setText("")

        if (isLiveVoiceRunning && liveVoiceManager != null) {
            appendChatMessage("user", text, mergeSameSpeaker = false)
            liveVoiceManager?.sendTextPrompt(text)
            return
        }

        appendChatMessage("user", text, mergeSameSpeaker = false)
        textChatHistory.add("user" to text)
        binding.btnSendChat.isEnabled = false
        binding.tvLiveStatus.text = "Pensando respuesta..."

        CoroutineScope(Dispatchers.Main).launch {
            val result = DailyTextRepository.sendChatMessage(
                baseUrl = prefs.apiBaseUrl,
                message = text,
                dailyContext = buildDailyContextForChat(),
                history = textChatHistory
            )
            binding.btnSendChat.isEnabled = true

            result.onSuccess { (reply, spokenReply) ->
                textChatHistory.add("model" to reply)
                appendChatMessage("ai", reply, mergeSameSpeaker = false)
                binding.tvLiveStatus.text = "Respuesta lista"

                if (binding.switchChatAutoSpeak.isChecked) {
                    stopInlineAudio()
                    val player = ChimeAndSpeechPlayer(this@MainActivity)
                    inlinePlayer = player
                    binding.tvLiveStatus.text = "Leyendo respuesta con voz IA (${prefs.voiceName})..."
                    player.speakText(spokenReply, prefs) { reason ->
                        binding.tvLiveStatus.text = "Voz local: $reason"
                    }
                    binding.tvLiveStatus.text = "Toca «Hablar en vivo» o escribe otra pregunta."
                }
            }.onFailure { err ->
                binding.tvLiveStatus.text = err.message ?: "No se pudo enviar la pregunta."
            }
        }
    }

    private fun appendChatMessage(speaker: String, text: String, mergeSameSpeaker: Boolean) {
        val clean = text.trim()
        if (clean.isEmpty()) return

        val last = chatMessages.lastOrNull()
        if (mergeSameSpeaker && last != null && last.speaker == speaker) {
            last.text = "${last.text} $clean".replace(Regex("\\s+"), " ").trim()
        } else {
            chatMessages.add(ChatEntry(speaker, clean))
        }
        renderChatMessages()
    }

    private fun renderChatMessages() {
        binding.containerChatMessages.removeAllViews()
        for (entry in chatMessages) {
            val isUser = entry.speaker == "user"
            val wrapper = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(16, 12, 16, 12)
                setBackgroundColor(
                    ContextCompat.getColor(
                        this@MainActivity,
                        if (isUser) R.color.brand_primary else R.color.surface_card
                    )
                )
            }

            val lp = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                setMargins(if (isUser) 48 else 0, 0, if (isUser) 0 else 48, 12)
            }

            val header = TextView(this).apply {
                text = if (isUser) "Tú" else "Voz IA (${prefs.voiceName})"
                textSize = 11f
                setTextColor(
                    ContextCompat.getColor(
                        this@MainActivity,
                        if (isUser) R.color.on_brand_primary else R.color.text_secondary
                    )
                )
            }

            val body = TextView(this).apply {
                text = entry.text
                textSize = 14f
                setPadding(0, 4, 0, 0)
                setTextColor(
                    ContextCompat.getColor(
                        this@MainActivity,
                        if (isUser) R.color.on_brand_primary else R.color.text_primary
                    )
                )
            }

            wrapper.addView(header)
            wrapper.addView(body)
            binding.containerChatMessages.addView(wrapper, lp)
        }

        binding.mainScrollView.post {
            binding.mainScrollView.fullScroll(View.FOCUS_DOWN)
        }
    }

    // ---------------- TAB 3: HORARIO Y CONSTANCIA ----------------

    private fun setupScheduleTab() {
        binding.switchUnlockMode.isChecked = prefs.unlockModeEnabled
        binding.btnUnlockStart.text = "Desde: ${prefs.unlockStartTime}"
        binding.btnUnlockEnd.text = "Hasta: ${prefs.unlockEndTime}"

        binding.switchUnlockMode.setOnCheckedChangeListener { _, isChecked ->
            prefs.unlockModeEnabled = isChecked
            if (isChecked) {
                UnlockMonitorService.start(this)
            } else {
                UnlockMonitorService.stop(this)
            }
        }

        binding.btnUnlockStart.setOnClickListener {
            pickTimeString(prefs.unlockStartTime) { picked ->
                prefs.unlockStartTime = picked
                binding.btnUnlockStart.text = "Desde: $picked"
                if (prefs.unlockModeEnabled) UnlockMonitorService.start(this)
            }
        }

        binding.btnUnlockEnd.setOnClickListener {
            pickTimeString(prefs.unlockEndTime) { picked ->
                prefs.unlockEndTime = picked
                binding.btnUnlockEnd.text = "Hasta: $picked"
                if (prefs.unlockModeEnabled) UnlockMonitorService.start(this)
            }
        }

        binding.btnResetUnlockToday.setOnClickListener {
            prefs.lastUnlockFiredDate = ""
            Toast.makeText(
                this,
                "Listo: volverá a saltar la próxima vez que desbloquees en tu franja.",
                Toast.LENGTH_SHORT
            ).show()
        }

        binding.switchExactAlarm.isChecked = prefs.exactAlarmEnabled
        binding.switchExactAlarm.setOnCheckedChangeListener { _, isChecked ->
            prefs.exactAlarmEnabled = isChecked
            AlarmScheduler.scheduleNextWeeklyAlarm(this)
        }

        binding.btnApplyAllDays.setOnClickListener {
            pickTimeString("08:00") { picked ->
                PrefsManager.ORDERED_DAYS.forEach { dow ->
                    prefs.setDaySchedule(dow, true, picked)
                }
                prefs.exactAlarmEnabled = true
                binding.switchExactAlarm.isChecked = true
                AlarmScheduler.scheduleNextWeeklyAlarm(this)
                renderDayRows()
            }
        }

        renderDayRows()
        refreshStreakAndHistory()
    }

    private fun renderDayRows() {
        binding.containerDays.removeAllViews()
        PrefsManager.ORDERED_DAYS.forEach { dow ->
            val sched = prefs.getDaySchedule(dow)
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(0, 12, 0, 12)
            }

            val sw = MaterialSwitch(this).apply {
                isChecked = sched.enabled
                setOnCheckedChangeListener { _, checked ->
                    val current = prefs.getDaySchedule(dow)
                    prefs.setDaySchedule(dow, checked, current.time)
                    AlarmScheduler.scheduleNextWeeklyAlarm(this@MainActivity)
                }
            }

            val label = TextView(this).apply {
                text = PrefsManager.dayLabel(dow)
                textSize = 15f
                setTextColor(ContextCompat.getColor(this@MainActivity, R.color.text_primary))
                setPadding(20, 0, 16, 0)
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            }

            val timeBtn = MaterialButton(
                this,
                null,
                com.google.android.material.R.attr.materialButtonOutlinedStyle
            ).apply {
                text = sched.time
                setOnClickListener {
                    pickTimeString(prefs.getDaySchedule(dow).time) { picked ->
                        prefs.setDaySchedule(dow, true, picked)
                        sw.isChecked = true
                        text = picked
                        AlarmScheduler.scheduleNextWeeklyAlarm(this@MainActivity)
                    }
                }
            }

            row.addView(sw)
            row.addView(label)
            row.addView(timeBtn)
            binding.containerDays.addView(row)
        }
    }

    private fun refreshStreakAndHistory() {
        val streak = prefs.calculateStreak()
        val completed = prefs.getCompletedDates()
        binding.tvStreakSummary.text =
            "Racha actual: $streak días seguidos · Total: ${completed.size} días"

        binding.gridHistory.removeAllViews()
        val cal = Calendar.getInstance()
        val fmt = SimpleDateFormat("yyyy-MM-dd", Locale.US)

        for (offset in -13..0) {
            val dayCal = (cal.clone() as Calendar).apply { add(Calendar.DAY_OF_YEAR, offset) }
            val iso = fmt.format(dayCal.time)
            val isDone = completed.contains(iso)
            val dow = dayCal.get(Calendar.DAY_OF_WEEK)
            val dayNum = dayCal.get(Calendar.DAY_OF_MONTH)

            val cell = TextView(this).apply {
                text = "${PrefsManager.dayShortLabel(dow)}\n$dayNum${if (isDone) "\n✓" else ""}"
                gravity = Gravity.CENTER
                textSize = 11f
                setPadding(6, 12, 6, 12)
                setBackgroundColor(
                    ContextCompat.getColor(
                        this@MainActivity,
                        if (isDone) R.color.brand_primary else R.color.surface_subtle
                    )
                )
                setTextColor(
                    ContextCompat.getColor(
                        this@MainActivity,
                        if (isDone) R.color.on_brand_primary else R.color.text_primary
                    )
                )
                setOnClickListener {
                    prefs.toggleDateCompleted(iso)
                    refreshCompletedButton()
                    refreshStreakAndHistory()
                }
            }

            val params = GridLayout.LayoutParams().apply {
                width = 0
                height = GridLayout.LayoutParams.WRAP_CONTENT
                columnSpec = GridLayout.spec(GridLayout.UNDEFINED, 1f)
                setMargins(4, 4, 4, 4)
            }
            binding.gridHistory.addView(cell, params)
        }
    }

    // ---------------- TAB 4: AJUSTES ----------------

    private fun setupSettingsTab() {
        binding.btnToggleTheme.setOnClickListener {
            toggleThemeMode()
        }

        binding.switchAutoRead.isChecked = prefs.autoReadOnAlarm
        binding.switchAutoRead.setOnCheckedChangeListener { _, checked ->
            prefs.autoReadOnAlarm = checked
        }

        renderVoicePicker()
        renderSpeechRateButtons()
        renderChimePicker()

        binding.etServerUrl.setText(prefs.apiBaseUrl)
        binding.btnSaveServerUrl.setOnClickListener {
            val url = binding.etServerUrl.text.toString().trim()
            prefs.apiBaseUrl = url
            refreshServerHealth()
            currentDailyText?.let { daily ->
                CoroutineScope(Dispatchers.IO).launch {
                    DailyTextRepository.precacheDailyAudio(applicationContext, prefs, daily)
                }
            }
        }

        binding.btnPermOverlay.setOnClickListener {
            val intent = Intent(
                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:$packageName")
            )
            startActivity(intent)
        }

        binding.btnPermExactAlarm.setOnClickListener {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val intent = Intent(
                    Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
                    Uri.parse("package:$packageName")
                )
                startActivity(intent)
            } else {
                Toast.makeText(this, "No es necesario en tu versión de Android", Toast.LENGTH_SHORT).show()
            }
        }

        binding.btnPermBattery.setOnClickListener {
            val intent = Intent(
                Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                Uri.parse("package:$packageName")
            )
            startActivity(intent)
        }

        binding.btnPermNotifications.setOnClickListener {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                notifPermLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
            } else {
                Toast.makeText(this, "Notificaciones ya activas", Toast.LENGTH_SHORT).show()
            }
        }

        binding.btnPermMicrophone.setOnClickListener {
            micPermLauncher.launch(Manifest.permission.RECORD_AUDIO)
        }

        refreshPermissionButtons()
    }

    private fun renderVoicePicker() {
        binding.containerVoices.removeAllViews()
        for (option in PrefsManager.VOICE_OPTIONS) {
            val selected = prefs.voiceName == option.id
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(16, 14, 14, 14)
                setBackgroundColor(
                    ContextCompat.getColor(
                        this@MainActivity,
                        if (selected) R.color.selected_card_bg else R.color.surface_subtle
                    )
                )
                setOnClickListener {
                    prefs.voiceName = option.id
                    renderVoicePicker()
                    refreshChatHeader()
                    currentDailyText?.let { daily ->
                        CoroutineScope(Dispatchers.IO).launch {
                            DailyTextRepository.precacheDailyAudio(applicationContext, prefs, daily)
                        }
                    }
                }
            }

            val rowLp = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                setMargins(0, 0, 0, 10)
            }

            val textCol = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            }

            val title = TextView(this).apply {
                text = if (selected) "✓ ${option.label}" else option.label
                textSize = 15f
                setTextColor(
                    ContextCompat.getColor(
                        this@MainActivity,
                        if (selected) R.color.brand_primary else R.color.text_primary
                    )
                )
            }

            val desc = TextView(this).apply {
                text = option.description
                textSize = 12f
                setTextColor(ContextCompat.getColor(this@MainActivity, R.color.text_secondary))
            }

            textCol.addView(title)
            textCol.addView(desc)

            val previewBtn = MaterialButton(
                this,
                null,
                com.google.android.material.R.attr.materialButtonOutlinedStyle
            ).apply {
                text = "Escuchar"
                setOnClickListener {
                    previewVoiceOption(option.id, this)
                }
            }

            row.addView(textCol)
            row.addView(previewBtn)
            binding.containerVoices.addView(row, rowLp)
        }
    }

    private fun previewVoiceOption(voiceId: String, btn: MaterialButton) {
        previewJob?.cancel()
        stopInlineAudio()
        prefs.voiceName = voiceId
        renderVoicePicker()
        refreshChatHeader()

        val player = ChimeAndSpeechPlayer(this)
        inlinePlayer = player
        btn.isEnabled = false
        btn.text = "Probando..."

        previewJob = CoroutineScope(Dispatchers.Main).launch {
            player.speakText(
                "Hora de leer el texto diario. Esta es la voz de inteligencia artificial.",
                prefs
            ) { reason ->
                Toast.makeText(this@MainActivity, reason, Toast.LENGTH_LONG).show()
            }
            btn.isEnabled = true
            btn.text = "Escuchar"
        }
    }

    private fun renderSpeechRateButtons() {
        binding.containerSpeechRates.removeAllViews()
        for (rate in PrefsManager.SPEECH_RATES) {
            val selected = prefs.speechRate == rate
            val styleAttr = if (selected) {
                com.google.android.material.R.attr.materialButtonStyle
            } else {
                com.google.android.material.R.attr.materialButtonOutlinedStyle
            }
            val btn = MaterialButton(this, null, styleAttr).apply {
                text = String.format(Locale.US, "%.1fx", rate)
                textSize = 12f
                setPadding(4, 0, 4, 0)
                setOnClickListener {
                    prefs.speechRate = rate
                    renderSpeechRateButtons()
                }
            }
            val lp = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
                setMargins(4, 0, 4, 0)
            }
            binding.containerSpeechRates.addView(btn, lp)
        }
    }

    private fun renderChimePicker() {
        binding.containerChimes.removeAllViews()
        for (option in PrefsManager.CHIME_OPTIONS) {
            val selected = prefs.chimeType == option.id
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(16, 14, 14, 14)
                setBackgroundColor(
                    ContextCompat.getColor(
                        this@MainActivity,
                        if (selected) R.color.selected_card_bg else R.color.surface_subtle
                    )
                )
                setOnClickListener {
                    prefs.chimeType = option.id
                    renderChimePicker()
                }
            }

            val rowLp = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                setMargins(0, 0, 0, 10)
            }

            val textCol = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            }

            val title = TextView(this).apply {
                text = if (selected) "✓ ${option.label}" else option.label
                textSize = 15f
                setTextColor(
                    ContextCompat.getColor(
                        this@MainActivity,
                        if (selected) R.color.brand_primary else R.color.text_primary
                    )
                )
            }

            val desc = TextView(this).apply {
                text = option.description
                textSize = 12f
                setTextColor(ContextCompat.getColor(this@MainActivity, R.color.text_secondary))
            }

            textCol.addView(title)
            textCol.addView(desc)

            val testBtn = MaterialButton(
                this,
                null,
                com.google.android.material.R.attr.materialButtonOutlinedStyle
            ).apply {
                text = "Probar"
                setOnClickListener {
                    prefs.chimeType = option.id
                    renderChimePicker()
                    CoroutineScope(Dispatchers.Main).launch {
                        ChimeAndSpeechPlayer(this@MainActivity).playChime(option.id)
                    }
                }
            }

            row.addView(textCol)
            row.addView(testBtn)
            binding.containerChimes.addView(row, rowLp)
        }
    }

    private fun refreshServerHealth() {
        binding.tvServerStatus.text = "Comprobando conexión con el servidor de Voz IA..."
        CoroutineScope(Dispatchers.Main).launch {
            val (ok, msg) = DailyTextRepository.checkServerHealth(prefs.apiBaseUrl)
            binding.tvServerStatus.text = msg
            binding.tvServerStatus.setBackgroundColor(
                ContextCompat.getColor(
                    this@MainActivity,
                    if (ok) R.color.status_ok_bg else R.color.status_warn_bg
                )
            )
            binding.tvServerStatus.setTextColor(
                ContextCompat.getColor(
                    this@MainActivity,
                    if (ok) R.color.status_ok_text else R.color.status_warn_text
                )
            )
        }
    }

    private fun refreshPermissionButtons() {
        val overlayOk = Settings.canDrawOverlays(this)
        binding.btnPermOverlay.text =
            if (overlayOk) "1. Mostrar sobre otras apps ✓" else "1. Mostrar sobre otras apps (Activar)"

        val alarmOk = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            (getSystemService(Context.ALARM_SERVICE) as AlarmManager).canScheduleExactAlarms()
        } else {
            true
        }
        binding.btnPermExactAlarm.text =
            if (alarmOk) "2. Alarmas exactas ✓" else "2. Permitir alarmas exactas (Activar)"

        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        val batteryOk = pm.isIgnoringBatteryOptimizations(packageName)
        binding.btnPermBattery.text =
            if (batteryOk) "3. Sin restricción de batería ✓" else "3. Sin restricción de batería (Activar)"

        val notifOk = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) ==
                PackageManager.PERMISSION_GRANTED
        } else {
            true
        }
        binding.btnPermNotifications.text =
            if (notifOk) "4. Notificaciones ✓" else "4. Permitir notificaciones (Activar)"

        val micOk = ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.RECORD_AUDIO
        ) == PackageManager.PERMISSION_GRANTED
        binding.btnPermMicrophone.text =
            if (micOk) "5. Micrófono (para conversar) ✓" else "5. Permitir micrófono (para conversar)"
    }

    private fun pickTimeString(current: String, onPicked: (String) -> Unit) {
        val parts = current.split(":")
        val h = parts.getOrNull(0)?.toIntOrNull() ?: 8
        val m = parts.getOrNull(1)?.toIntOrNull() ?: 0
        TimePickerDialog(
            this,
            { _, hourOfDay, minute ->
                onPicked(String.format(Locale.US, "%02d:%02d", hourOfDay, minute))
            },
            h,
            m,
            false
        ).show()
    }

    override fun onDestroy() {
        previewJob?.cancel()
        stopInlineAudio()
        stopLiveVoiceSession()
        super.onDestroy()
    }
}
