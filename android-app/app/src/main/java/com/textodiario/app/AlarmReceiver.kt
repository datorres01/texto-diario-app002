package com.textodiario.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.PowerManager
import androidx.core.app.NotificationCompat

class AlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        val wakeLock = pm.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "TextoDiario:AlarmReceiverWake"
        )
        wakeLock.acquire(15_000L)

        try {
            val source = intent.getStringExtra("source") ?: "weekly"
            val prefs = PrefsManager(context)
            if (source == "snooze") {
                prefs.snoozeTargetMs = 0L
            } else {
                AlarmScheduler.scheduleNextWeeklyAlarm(context)
            }

            launchAlarmScreen(context, source)
        } finally {
            if (wakeLock.isHeld) {
                wakeLock.release()
            }
        }
    }

    companion object {
        private const val CHANNEL_ALARM = "texto_diario_alarm_channel"

        fun launchAlarmScreen(context: Context, source: String) {
            val alarmIntent = Intent(context, AlarmActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP
                putExtra("source", source)
            }

            val fullScreenPending = PendingIntent.getActivity(
                context,
                2001,
                alarmIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            val channel = NotificationChannel(
                CHANNEL_ALARM,
                "Alarma del Texto Diario",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Muestra y reproduce la lectura automática del texto diario."
                setSound(null, null)
                lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
            }
            nm.createNotificationChannel(channel)

            val notif = NotificationCompat.Builder(context, CHANNEL_ALARM)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle("Hora de leer el texto diario")
                .setContentText("Toca para abrir la lectura automática")
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setAutoCancel(true)
                .setFullScreenIntent(fullScreenPending, true)
                .setContentIntent(fullScreenPending)
                .build()

            nm.notify(2001, notif)

            try {
                context.startActivity(alarmIntent)
            } catch (_: Exception) {
                // Full-screen intent notification handles restricted background starts
            }
        }
    }
}
