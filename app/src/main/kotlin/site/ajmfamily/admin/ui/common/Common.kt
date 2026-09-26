package site.ajmfamily.admin.ui.common

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import site.ajmfamily.admin.core.model.RegistrationSource
import site.ajmfamily.admin.core.model.RegistrationStatus
import site.ajmfamily.admin.ui.theme.Bad
import site.ajmfamily.admin.ui.theme.Blue
import site.ajmfamily.admin.ui.theme.BlueSoft
import site.ajmfamily.admin.ui.theme.Gold
import site.ajmfamily.admin.ui.theme.Line
import site.ajmfamily.admin.ui.theme.Muted
import site.ajmfamily.admin.ui.theme.Ok
import site.ajmfamily.admin.ui.theme.OkSoft
import site.ajmfamily.admin.ui.theme.Pink
import site.ajmfamily.admin.ui.theme.WarnSoft

@Composable
fun StatTile(title: String, value: String, modifier: Modifier = Modifier, accent: Color = Blue, accentSoft: Color = BlueSoft) {
    Card(modifier = modifier, colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Column(Modifier.padding(16.dp)) {
            Box(
                Modifier
                    .background(accentSoft, RoundedCornerShape(10.dp))
                    .padding(horizontal = 8.dp, vertical = 4.dp)
            ) {
                Text(title.uppercase(), style = MaterialTheme.typography.labelSmall, color = accent)
            }
            Text(value, style = MaterialTheme.typography.headlineMedium, modifier = Modifier.padding(top = 8.dp))
        }
    }
}

@Composable
fun HeroStatTile(total: Int, confirmed: Int, contacted: Int, pending: Int, modifier: Modifier = Modifier) {
    Card(
        modifier = modifier,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer)
    ) {
        Column(Modifier.padding(20.dp)) {
            Text("TOTAL REGISTRATIONS", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onPrimaryContainer)
            Text("$total", style = MaterialTheme.typography.displaySmall, color = MaterialTheme.colorScheme.onPrimaryContainer)
            if (total > 0) {
                StackBar(confirmed = confirmed, contacted = contacted, pending = pending, total = total, modifier = Modifier.padding(top = 12.dp))
                Text(
                    "$confirmed confirmed · $contacted contacted · $pending pending",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onPrimaryContainer,
                    modifier = Modifier.padding(top = 6.dp)
                )
            }
        }
    }
}

@Composable
private fun StackBar(confirmed: Int, contacted: Int, pending: Int, total: Int, modifier: Modifier = Modifier) {
    Box(
        modifier
            .fillMaxWidth()
            .background(Color.White.copy(alpha = 0.25f), RoundedCornerShape(50))
    ) {
        Box(Modifier.fillMaxWidth(confirmed.toFloat() / total).background(Ok, RoundedCornerShape(50)).padding(vertical = 4.dp)) {}
    }
}

@Composable
fun StatusPill(status: String, modifier: Modifier = Modifier) {
    val (bg, fg) = when (status) {
        RegistrationStatus.CONFIRMED -> OkSoft to Ok
        RegistrationStatus.CONTACTED -> BlueSoft to Blue
        else -> Line to Muted
    }
    Box(modifier.background(bg, RoundedCornerShape(50)).padding(horizontal = 12.dp, vertical = 6.dp)) {
        Text(status, style = MaterialTheme.typography.labelMedium, color = fg)
    }
}

@Composable
fun SourceBadge(source: String, modifier: Modifier = Modifier) {
    val (bg, fg) = when (source) {
        RegistrationSource.WOMENS_MEET -> Pink.copy(alpha = 0.15f) to Pink
        RegistrationSource.EVENT_BOOKING -> BlueSoft to Blue
        RegistrationSource.SPEAKING_INVITATION -> WarnSoft to Gold
        else -> Line to Muted
    }
    Box(modifier.background(bg, RoundedCornerShape(50)).padding(horizontal = 10.dp, vertical = 4.dp)) {
        Text(source, style = MaterialTheme.typography.labelSmall, color = fg)
    }
}

@Composable
fun LoadingBox(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        CircularProgressIndicator()
    }
}

@Composable
fun ErrorBox(message: String, onRetry: (() -> Unit)? = null, modifier: Modifier = Modifier) {
    Column(
        modifier.fillMaxSize().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Text(message, color = Bad, style = MaterialTheme.typography.bodyMedium)
        if (onRetry != null) {
            TextButton(onClick = onRetry, modifier = Modifier.padding(top = 8.dp)) { Text("Retry") }
        }
    }
}

@Composable
fun EmptyBox(title: String, subtitle: String? = null, modifier: Modifier = Modifier) {
    Column(
        modifier.fillMaxSize().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Text(title, style = MaterialTheme.typography.titleMedium)
        if (subtitle != null) {
            Text(subtitle, style = MaterialTheme.typography.bodySmall, color = Muted, modifier = Modifier.padding(top = 4.dp))
        }
    }
}

@Composable
fun ConfirmDialog(
    title: String,
    text: String,
    confirmLabel: String = "Confirm",
    destructive: Boolean = false,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { Text(text) },
        confirmButton = {
            TextButton(onClick = onConfirm) {
                Text(confirmLabel, color = if (destructive) Bad else MaterialTheme.colorScheme.primary)
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } }
    )
}

@Composable
fun TextPromptDialog(
    title: String,
    label: String,
    initial: String = "",
    confirmLabel: String = "OK",
    onConfirm: (String) -> Unit,
    onDismiss: () -> Unit
) {
    var value by remember { mutableStateOf(initial) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            OutlinedTextField(value = value, onValueChange = { value = it }, label = { Text(label) }, singleLine = true)
        },
        confirmButton = {
            TextButton(onClick = { onConfirm(value) }, enabled = value.isNotBlank()) { Text(confirmLabel) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } }
    )
}

val screenPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp)
