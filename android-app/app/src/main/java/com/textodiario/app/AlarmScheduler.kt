package com.textodiario.app

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import java.util.Calendar

object AlarmScheduler {
    private const val REQ_WEEKLY_ALARM = 1001
    private const val REQ_SNOOZE_ALARM = 1002

    fun scheduleNextWeeklyAlarm(context: Context) {
        val prefs = PrefsManager(context)
        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager

        val pending = createAlarmPendingIntent(context, REQ_WEEKLY_ALARM, "weekly")
        alarmManager.cancel(pending)

        if (!prefs.exactAlarmEnabled) return

        val nextCal = findNextWeeklyTrigger(prefs) ?: return
        setExactAlarmClock(context, alarmManager, nextCal.timeInMillis, pending)
    }

    fun scheduleSnoozeMinutes(context: Context, minutes: Int) {
        val targetMs = System.currentTimeMillis() + minutes * 60_000L
        scheduleSnoozeAt(context, targetMs)
    }

    fun scheduleSnoozeAt(context: Context, targetMs: Long) {
        val prefs = PrefsManager(context)
        prefs.snoozeTargetMs = targetMs
        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val pending = createAlarmPendingIntent(context, REQ_SNOOZE_ALARM, "snooze")
        alarmManager.cancel(pending)
        setExactAlarmClock(context, alarmManager, targetMs, pending)
    }

    fun cancelSnooze(context: Context) {
        val prefs = PrefsManager(context)
        prefs.snoozeTargetMs = 0L
        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val pending = createAlarmPendingIntent(context, REQ_SNOOZE_ALARM, "snooze")
        alarmManager.cancel(pending)
    }

    fun restoreAll(context: Context) {
        val prefs = PrefsManager(context)
        scheduleNextWeeklyAlarm(context)
        val snooze = prefs.snoozeTargetMs
        if (snooze > System.currentTimeMillis()) {
            scheduleSnoozeAt(context, snooze)
        } else if (snooze > 0L) {
            prefs.snoozeTargetMs = 0L
        }
    }

    private fun setExactAlarmClock(
        context: Context,
        alarmManager: AlarmManager,
        triggerAtMillis: Long,
        operation: PendingIntent
    ) {
        val showIntent = PendingIntent.getActivity(
            context,
            0,
            Intent(context, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !alarmManager.canScheduleExactAlarms()) {
            alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAtMillis, operation)
            return
        }

        val clockInfo = AlarmManager.AlarmClockInfo(triggerAtMillis, showIntent)
        alarmManager.setAlarmClock(clockInfo, operation)
    }

    private fun createAlarmPendingIntent(
        context: Context,
        requestCode: Int,
        source: String
    ): PendingIntent {
        val intent = Intent(context, AlarmReceiver::class.java).apply {
            putExtra("source", source)
        }
        return PendingIntent.getBroadcast(
            context,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    fun findNextWeeklyTrigger(prefs: PrefsManager, now: Calendar = Calendar.getInstance()): Calendar? {
        for (offset in 0..7) {
            val candidate = (now.clone() as Calendar).apply {
                add(Calendar.DAY_OF_YEAR, offset)
            }
            val dow = candidate.get(Calendar.DAY_OF_WEEK)
            val sched = prefs.getDaySchedule(dow)
            if (!sched.enabled) continue

            val parts = sched.time.split(":")
            if (parts.size != 2) continue
            val hh = parts[0].toIntOrNull() ?: continue
            val mm = parts[1].toIntOrNull() ?: continue

            candidate.set(Calendar.HOUR_OF_DAY, hh)
            candidate.set(Calendar.MINUTE, mm)
            candidate.set(Calendar.SECOND, 0)
            candidate.set(Calendar.MILLISECOND, 0)

            if (candidate.timeInMillis > now.timeInMillis) {
                return candidate
            }
        }
        return null
    }
}
