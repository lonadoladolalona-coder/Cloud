package site.ajmfamily.admin.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val LightColors = lightColorScheme(
    primary = Blue,
    onPrimary = Color.White,
    primaryContainer = BlueSoft,
    onPrimaryContainer = Navy,
    secondary = Gold,
    onSecondary = Color.White,
    tertiary = Pink,
    onTertiary = Color.White,
    error = Bad,
    onError = Color.White,
    errorContainer = BadSoft,
    onErrorContainer = Bad,
    background = BgLight,
    onBackground = Ink,
    surface = Color.White,
    onSurface = Ink,
    surfaceVariant = Line,
    onSurfaceVariant = Muted,
    outline = Line
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFF8FB5FF),
    onPrimary = Navy,
    primaryContainer = Color(0xFF1E3A6B),
    onPrimaryContainer = BlueSoft,
    secondary = Gold,
    onSecondary = Color(0xFF3B2A00),
    tertiary = Pink,
    onTertiary = Color.White,
    error = Color(0xFFFF8A80),
    onError = Color(0xFF3B0A0A),
    background = Color(0xFF0F1626),
    onBackground = Color(0xFFE6EAF5),
    surface = Color(0xFF17203A),
    onSurface = Color(0xFFE6EAF5),
    surfaceVariant = Color(0xFF26314F),
    onSurfaceVariant = Color(0xFFB7C0D6),
    outline = Color(0xFF3A4666)
)

@Composable
fun AjmAdminTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit
) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkColors else LightColors,
        typography = MaterialTheme.typography,
        content = content
    )
}
