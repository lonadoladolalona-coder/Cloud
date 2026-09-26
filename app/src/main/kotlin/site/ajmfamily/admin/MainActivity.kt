package site.ajmfamily.admin

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import site.ajmfamily.admin.ui.nav.AjmNavHost
import site.ajmfamily.admin.ui.theme.AjmAdminTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        val container = (application as AjmApplication).container

        setContent {
            LaunchedEffect(Unit) {
                container.session.load()
            }
            AjmAdminTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    AjmNavHost(container = container)
                }
            }
        }
    }
}
