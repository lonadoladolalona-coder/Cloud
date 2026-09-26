package site.ajmfamily.admin

import android.app.Application
import site.ajmfamily.admin.di.AppContainer

class AjmApplication : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
    }
}
