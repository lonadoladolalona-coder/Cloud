package site.ajmfamily.admin.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first

/** Live, in-memory view of the settings/keys the rest of the app reads on every request. */
class AppSession(
    private val settingsStore: SettingsStore,
    private val secureKeyStore: SecureKeyStore
) {
    private val _webAppUrl = MutableStateFlow("")
    val webAppUrl: StateFlow<String> = _webAppUrl.asStateFlow()

    private val _adminKey = MutableStateFlow(secureKeyStore.adminKey)
    val adminKey: StateFlow<String?> = _adminKey.asStateFlow()

    private val _mediaKey = MutableStateFlow(secureKeyStore.mediaKey)
    val mediaKey: StateFlow<String?> = _mediaKey.asStateFlow()

    suspend fun load() {
        _webAppUrl.value = settingsStore.webAppUrl.first()
    }

    suspend fun setWebAppUrl(url: String) {
        settingsStore.setWebAppUrl(url)
        _webAppUrl.value = url.trim()
    }

    fun setAdminKey(key: String) {
        secureKeyStore.adminKey = key
        _adminKey.value = key
    }

    fun clearAdminKey() {
        secureKeyStore.clearAdminKey()
        _adminKey.value = null
    }

    fun setMediaKey(key: String) {
        secureKeyStore.mediaKey = key
        _mediaKey.value = key
    }

    fun clearMediaKey() {
        secureKeyStore.clearMediaKey()
        _mediaKey.value = null
    }
}
