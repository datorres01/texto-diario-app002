package com.textodiario.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

class UnlockMonitorService : Service() {

    private val unlockReceiver = object : BroadcastReceiver() {
        override fun onReceive(ctx: Context, intent: Intent) {
            if (intent.action != Intent.ACTION_USER_PRESENT) return

            val prefs = PrefsManager(ctx)
            if (!prefs.unlockModeEnabled) return

            val today = PrefsManager.todayIso()
            if (prefs.lastUnlockFiredDate == today) return

            if (prefs.isWithinUnlockWindow()) {
                prefs.lastUnlockFiredDate = today
                AlarmReceiver.launchAlarmScreen(ctx, "unlock_window")
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        val filter = IntentFilter(Intent.ACTION_USER_PRESENT)
        ContextCompat.registerReceiver(
            this,
            unlockReceiver,
            filter,
            ContextCompat.RECEIVER_NOT_EXPORTED
        )
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val prefs = PrefsManager(this)
        if (!prefs.unlockModeEnabled) {
            stopSelf()
            return START_NOT_STICKY
        }

        startForeground(SERVICE_ID, buildNotification(prefs))
        return START_STICKY
    }

    override fun onDestroy() {
        try {
            unregisterReceiver(unlockReceiver)
        } catch (_: Exception) {
        }
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun buildNotification(prefs: PrefsManager): Notification {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val channel = NotificationChannel(
            CHANNEL_MONITOR,
            "Detección al desbloquear",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Mantiene activa la lectura automática al desbloquear en tu horario."
            setShowBadge(false)
        }
        nm.createNotificationChannel(channel)

        val openPending = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, CHANNEL_MONITOR)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("Texto Diario activo")
            .setContentText("Al desbloquear entre ${prefs.unlockStartTime} y ${prefs.unlockEndTime}")
            .setOngoing(true)
            .setSilent(true)
            .setContentIntent(openPending)
            .build()
    }

    companion object {
        private const val CHANNEL_MONITOR = "texto_diario_monitor_channel"
        private const val SERVICE_ID = 1101

        fun start(context: Context) {
            val intent = Intent(context, UnlockMonitorService::class.java)
            ContextCompat.startForegroundService(context, intent)
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, UnlockMonitorService::class.java))
        }
    }
}
