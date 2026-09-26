package site.ajmfamily.admin.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.dataStore by preferencesDataStore(name = "settings")

/**
 * Holds the deployed Apps Script Web App URL. This is a per-install setting,
 * never hardcoded into source, so the same public repo works for any deployment.
 */
class SettingsStore(private val context: Context) {
    private val webAppUrlKey = stringPreferencesKey("web_app_url")

    val webAppUrl: Flow<String> = context.dataStore.data.map { it[webAppUrlKey] ?: "" }

    suspend fun setWebAppUrl(url: String) {
        context.dataStore.edit { it[webAppUrlKey] = url.trim() }
    }
}
