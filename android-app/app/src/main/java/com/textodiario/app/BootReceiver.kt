package com.textodiario.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        AlarmScheduler.restoreAll(context)
        val prefs = PrefsManager(context)
        if (prefs.unlockModeEnabled) {
            UnlockMonitorService.start(context)
        }
    }
}
