package com.textodiario.app

import android.content.Context
import androidx.appcompat.app.AppCompatDelegate
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

data class DaySchedule(
    val enabled: Boolean,
    val time: String
)

data class VoiceOption(
    val id: String,
    val label: String,
    val description: String
)

data class ChimeOption(
    val id: String,
    val label: String,
    val description: String
)

class PrefsManager(context: Context) {
    private val prefs = context.getSharedPreferences("texto_diario_prefs", Context.MODE_PRIVATE)

    companion object {
        const val DEFAULT_API_BASE_URL =
            "https://ais-pre-lhujvyenk26dwzvdpuwlm6-914765574037.us-east1.run.app"

        val VOICE_OPTIONS = listOf(
            VoiceOption("Kore", "Kore", "Femenina · Serena y cálida"),
            VoiceOption("Zephyr", "Zephyr", "Femenina · Clara y luminosa"),
            VoiceOption("Puck", "Puck", "Masculina · Amable y cercana"),
            VoiceOption("Charon", "Charon", "Masculina · Pausada y profunda"),
            VoiceOption("Fenrir", "Fenrir", "Masculina · Firme y expresiva")
        )

        val CHIME_OPTIONS = listOf(
            ChimeOption("chime", "Campana suave", "Acorde ascendente cálido"),
            ChimeOption("harp", "Arpa matutina", "Cuatro notas delicadas"),
            ChimeOption("tone", "Tono simple", "Dos pulsos discretos")
        )

        val SPEECH_RATES = listOf(0.9f, 1.0f, 1.1f, 1.2f)

        val ORDERED_DAYS = listOf(
            Calendar.MONDAY,
            Calendar.TUESDAY,
            Calendar.WEDNESDAY,
            Calendar.THURSDAY,
            Calendar.FRIDAY,
            Calendar.SATURDAY,
            Calendar.SUNDAY
        )

        fun dayLabel(dayOfWeek: Int): String = when (dayOfWeek) {
            Calendar.MONDAY -> "Lunes"
            Calendar.TUESDAY -> "Martes"
            Calendar.WEDNESDAY -> "Miércoles"
            Calendar.THURSDAY -> "Jueves"
            Calendar.FRIDAY -> "Viernes"
            Calendar.SATURDAY -> "Sábado"
            Calendar.SUNDAY -> "Domingo"
            else -> "Día"
        }

        fun dayShortLabel(dayOfWeek: Int): String = when (dayOfWeek) {
            Calendar.MONDAY -> "Lun"
            Calendar.TUESDAY -> "Mar"
            Calendar.WEDNESDAY -> "Mié"
            Calendar.THURSDAY -> "Jue"
            Calendar.FRIDAY -> "Vie"
            Calendar.SATURDAY -> "Sáb"
            Calendar.SUNDAY -> "Dom"
            else -> ""
        }

        fun todayIso(): String {
            val fmt = SimpleDateFormat("yyyy-MM-dd", Locale.US)
            return fmt.format(Date())
        }

        fun dateIsoForOffset(daysOffset: Int): String {
            val cal = Calendar.getInstance()
            cal.add(Calendar.DAY_OF_YEAR, daysOffset)
            val fmt = SimpleDateFormat("yyyy-MM-dd", Locale.US)
            return fmt.format(cal.time)
        }
    }

    var exactAlarmEnabled: Boolean
        get() = prefs.getBoolean("exact_alarm_enabled", false)
        set(value) = prefs.edit().putBoolean("exact_alarm_enabled", value).apply()

    var unlockModeEnabled: Boolean
        get() = prefs.getBoolean("unlock_mode_enabled", true)
        set(value) = prefs.edit().putBoolean("unlock_mode_enabled", value).apply()

    var unlockStartTime: String
        get() = prefs.getString("unlock_start_time", "07:00") ?: "07:00"
        set(value) = prefs.edit().putString("unlock_start_time", value).apply()

    var unlockEndTime: String
        get() = prefs.getString("unlock_end_time", "12:00") ?: "12:00"
        set(value) = prefs.edit().putString("unlock_end_time", value).apply()

    var lastUnlockFiredDate: String
        get() = prefs.getString("last_unlock_fired_date", "") ?: ""
        set(value) = prefs.edit().putString("last_unlock_fired_date", value).apply()

    var voiceName: String
        get() = prefs.getString("voice_name", "Kore") ?: "Kore"
        set(value) = prefs.edit().putString("voice_name", value).apply()

    var chimeType: String
        get() = prefs.getString("chime_type", "chime") ?: "chime"
        set(value) = prefs.edit().putString("chime_type", value).apply()

    var speechRate: Float
        get() = prefs.getFloat("speech_rate", 1.0f)
        set(value) = prefs.edit().putFloat("speech_rate", value).apply()

    var themeMode: String
        get() = prefs.getString("theme_mode", "light") ?: "light"
        set(value) = prefs.edit().putString("theme_mode", value).apply()

    var autoReadOnAlarm: Boolean
        get() = prefs.getBoolean("auto_read_on_alarm", true)
        set(value) = prefs.edit().putBoolean("auto_read_on_alarm", value).apply()

    var apiBaseUrl: String
        get() = prefs.getString("api_base_url", DEFAULT_API_BASE_URL) ?: DEFAULT_API_BASE_URL
        set(value) = prefs.edit().putString("api_base_url", value.trim().trimEnd('/')).apply()

    var snoozeTargetMs: Long
        get() = prefs.getLong("snooze_target_ms", 0L)
        set(value) = prefs.edit().putLong("snooze_target_ms", value).apply()

    fun applyThemeMode() {
        val target = if (themeMode == "dark") {
            AppCompatDelegate.MODE_NIGHT_YES
        } else {
            AppCompatDelegate.MODE_NIGHT_NO
        }
        AppCompatDelegate.setDefaultNightMode(target)
    }

    fun getDaySchedule(dayOfWeek: Int): DaySchedule {
        val defaultTime = if (dayOfWeek == Calendar.SATURDAY || dayOfWeek == Calendar.SUNDAY) {
            "09:00"
        } else {
            "08:00"
        }
        val enabled = prefs.getBoolean("day_enabled_$dayOfWeek", true)
        val time = prefs.getString("day_time_$dayOfWeek", defaultTime) ?: defaultTime
        return DaySchedule(enabled, time)
    }

    fun setDaySchedule(dayOfWeek: Int, enabled: Boolean, time: String) {
        prefs.edit()
            .putBoolean("day_enabled_$dayOfWeek", enabled)
            .putString("day_time_$dayOfWeek", time)
            .apply()
    }

    fun isWithinUnlockWindow(now: Calendar = Calendar.getInstance()): Boolean {
        val startParts = unlockStartTime.split(":")
        val endParts = unlockEndTime.split(":")
        if (startParts.size != 2 || endParts.size != 2) return false

        val startMinutes = (startParts[0].toIntOrNull() ?: 7) * 60 + (startParts[1].toIntOrNull() ?: 0)
        val endMinutes = (endParts[0].toIntOrNull() ?: 12) * 60 + (endParts[1].toIntOrNull() ?: 0)
        val currentMinutes = now.get(Calendar.HOUR_OF_DAY) * 60 + now.get(Calendar.MINUTE)

        return if (startMinutes <= endMinutes) {
            currentMinutes in startMinutes..endMinutes
        } else {
            currentMinutes >= startMinutes || currentMinutes <= endMinutes
        }
    }

    fun getCompletedDates(): Set<String> {
        return prefs.getStringSet("completed_dates", emptySet())?.toSet() ?: emptySet()
    }

    fun markDateCompleted(dateIso: String) {
        val updated = getCompletedDates().toMutableSet()
        if (updated.add(dateIso)) {
            prefs.edit().putStringSet("completed_dates", updated).apply()
        }
    }

    fun toggleDateCompleted(dateIso: String) {
        val updated = getCompletedDates().toMutableSet()
        if (updated.contains(dateIso)) {
            updated.remove(dateIso)
        } else {
            updated.add(dateIso)
        }
        prefs.edit().putStringSet("completed_dates", updated).apply()
    }

    fun calculateStreak(): Int {
        val set = getCompletedDates()
        if (set.isEmpty()) return 0

        val fmt = SimpleDateFormat("yyyy-MM-dd", Locale.US)
        val cal = Calendar.getInstance()
        var cursor = fmt.format(cal.time)
        if (!set.contains(cursor)) {
            cal.add(Calendar.DAY_OF_YEAR, -1)
            cursor = fmt.format(cal.time)
            if (!set.contains(cursor)) return 0
        }

        var streak = 0
        while (set.contains(cursor)) {
            streak++
            cal.add(Calendar.DAY_OF_YEAR, -1)
            cursor = fmt.format(cal.time)
        }
        return streak
    }

    fun saveCachedTextJson(dateIso: String, json: String) {
        prefs.edit().putString("cached_text_$dateIso", json).apply()
    }

    fun getCachedTextJson(dateIso: String): String? {
        return prefs.getString("cached_text_$dateIso", null)
    }
}
