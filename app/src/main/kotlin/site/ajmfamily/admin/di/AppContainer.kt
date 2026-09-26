package site.ajmfamily.admin.di

import android.content.Context
import site.ajmfamily.admin.core.net.AjmApi
import site.ajmfamily.admin.data.AppSession
import site.ajmfamily.admin.data.OkHttpTransport
import site.ajmfamily.admin.data.SecureKeyStore
import site.ajmfamily.admin.data.SettingsStore

/** Hand-rolled dependency container — small enough that Hilt/Dagger would be pure overhead. */
class AppContainer(context: Context) {
    private val appContext = context.applicationContext

    val settingsStore = SettingsStore(appContext)
    val secureKeyStore = SecureKeyStore(appContext)
    val session = AppSession(settingsStore, secureKeyStore)
    val api = AjmApi(OkHttpTransport())
}
