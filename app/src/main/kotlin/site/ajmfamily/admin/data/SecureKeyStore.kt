package site.ajmfamily.admin.data

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Stores the admin key and media key on-device, encrypted at rest. Unlike the
 * web gates (which hold the key in memory only, for the lifetime of the tab),
 * a native app is expected to remember it between launches; "Log out" in each
 * section clears just that section's key.
 */
class SecureKeyStore(context: Context) {
    private val masterKey = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()

    private val prefs = EncryptedSharedPreferences.create(
        context,
        "secure_keys",
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )

    var adminKey: String?
        get() = prefs.getString(KEY_ADMIN, null)
        set(value) = prefs.edit().putString(KEY_ADMIN, value).apply()

    var mediaKey: String?
        get() = prefs.getString(KEY_MEDIA, null)
        set(value) = prefs.edit().putString(KEY_MEDIA, value).apply()

    fun clearAdminKey() = prefs.edit().remove(KEY_ADMIN).apply()
    fun clearMediaKey() = prefs.edit().remove(KEY_MEDIA).apply()

    private companion object {
        const val KEY_ADMIN = "admin_key"
        const val KEY_MEDIA = "media_key"
    }
}
