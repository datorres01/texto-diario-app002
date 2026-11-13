package com.textodiario.app

import android.app.Application

class TextoDiarioApp : Application() {
    override fun onCreate() {
        super.onCreate()
        PrefsManager(this).applyThemeMode()
    }
}
