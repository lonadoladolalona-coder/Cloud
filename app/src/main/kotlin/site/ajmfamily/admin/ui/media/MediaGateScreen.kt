package site.ajmfamily.admin.ui.media

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import kotlinx.coroutines.launch
import site.ajmfamily.admin.core.net.AjmApi
import site.ajmfamily.admin.core.net.ApiOutcome
import site.ajmfamily.admin.data.AppSession
import site.ajmfamily.admin.ui.common.KeyGateScaffold

@Composable
fun MediaGateScreen(
    api: AjmApi,
    session: AppSession,
    onSignedIn: () -> Unit,
    onGoToSettings: () -> Unit
) {
    val webAppUrl by session.webAppUrl.collectAsState()
    val savedKey by session.mediaKey.collectAsState()
    var checking by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(savedKey) {
        if (savedKey != null) onSignedIn()
    }

    KeyGateScaffold(
        title = "Media Office",
        description = "The media team's shared content log, plan and stock.",
        keyLabel = "Media key",
        checking = checking,
        error = error,
        needsSetup = webAppUrl.isBlank(),
        onGoToSettings = onGoToSettings,
        onSubmit = { key ->
            error = null
            checking = true
            scope.launch {
                when (val result = api.mediaLogin(webAppUrl, key)) {
                    is ApiOutcome.Success -> session.setMediaKey(key)
                    is ApiOutcome.Failure -> error = result.message
                }
                checking = false
            }
        }
    )
}
