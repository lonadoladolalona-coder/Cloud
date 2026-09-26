package site.ajmfamily.admin.ui.admin.zoom

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.weight
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import site.ajmfamily.admin.core.model.MeetingResult
import site.ajmfamily.admin.core.model.Registration
import site.ajmfamily.admin.ui.admin.AdminViewModel
import site.ajmfamily.admin.ui.common.EmptyBox
import site.ajmfamily.admin.util.openWhatsApp
import java.time.LocalDate
import java.time.format.DateTimeFormatter

private const val DEFAULT_MESSAGE = "Hi {name}! 🙏 Thank you for confirming. Here's your Zoom link: [PASTE ZOOM LINK HERE]\n\nSee you there!"

private sealed interface ZoomStep {
    data object Setup : ZoomStep
    data class Queue(val index: Int, val opened: Boolean) : ZoomStep
    data class Done(val sent: Int, val total: Int, val stopped: Boolean) : ZoomStep
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ZoomSendScreen(viewModel: AdminViewModel, onDone: () -> Unit) {
    val state by viewModel.state.collectAsState()
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    val pool = remember(state.rows) { viewModel.dedupedConfirmed(state.rows) }
    var meetingName by remember { mutableStateOf("Zoom meeting — " + LocalDate.now().format(DateTimeFormatter.ofPattern("d MMM yyyy"))) }
    var message by remember { mutableStateOf(DEFAULT_MESSAGE) }
    var selectedIds by remember { mutableStateOf(pool.map { it.id }.toSet()) }
    var recipients by remember { mutableStateOf<List<Registration>>(emptyList()) }
    var step by remember { mutableStateOf<ZoomStep>(ZoomStep.Setup) }
    var sentCount by remember { mutableStateOf(0) }
    var messageSavedOnce by remember { mutableStateOf(false) }

    fun record(person: Registration, result: String) {
        scope.launch {
            viewModel.markMeeting(meetingName, result, person, if (!messageSavedOnce) message else null)
            messageSavedOnce = true
        }
    }

    fun advance(current: ZoomStep.Queue) {
        val next = current.index + 1
        step = if (next >= recipients.size) ZoomStep.Done(sentCount, recipients.size, stopped = false) else ZoomStep.Queue(next, opened = false)
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Send Zoom Link") },
                navigationIcon = { IconButton(onClick = onDone) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Close") } }
            )
        }
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize().padding(16.dp)) {
            when (val s = step) {
                is ZoomStep.Setup -> SetupStep(
                    pool = pool,
                    meetingName = meetingName,
                    onMeetingName = { meetingName = it },
                    message = message,
                    onMessage = { message = it },
                    selectedIds = selectedIds,
                    onToggle = { id -> selectedIds = if (id in selectedIds) selectedIds - id else selectedIds + id },
                    onSelectAll = { selectedIds = pool.map { it.id }.toSet() },
                    onClear = { selectedIds = emptySet() },
                    onStart = {
                        recipients = pool.filter { it.id in selectedIds }
                        sentCount = 0
                        messageSavedOnce = false
                        step = ZoomStep.Queue(0, opened = false)
                    }
                )

                is ZoomStep.Queue -> {
                    val person = recipients[s.index]
                    QueueStep(
                        index = s.index,
                        total = recipients.size,
                        person = person,
                        opened = s.opened,
                        onOpen = {
                            openWhatsApp(context, person.phone, message.replace("{name}", person.name.ifBlank { "there" }))
                            step = s.copy(opened = true)
                        },
                        onSkip = { record(person, MeetingResult.SKIPPED); advance(s) },
                        onConfirmSent = { sentCount++; record(person, MeetingResult.SENT); advance(s) },
                        onStop = { step = ZoomStep.Done(sentCount, recipients.size, stopped = true) }
                    )
                }

                is ZoomStep.Done -> DoneStep(sent = s.sent, total = s.total, stopped = s.stopped, onClose = onDone)
            }
        }
    }
}

@Composable
private fun SetupStep(
    pool: List<Registration>,
    meetingName: String,
    onMeetingName: (String) -> Unit,
    message: String,
    onMessage: (String) -> Unit,
    selectedIds: Set<String>,
    onToggle: (String) -> Unit,
    onSelectAll: () -> Unit,
    onClear: () -> Unit,
    onStart: () -> Unit
) {
    Column(Modifier.fillMaxSize()) {
        Text(
            "Goes to everyone marked Confirmed. Opens one WhatsApp chat at a time — you just hit send for each.",
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.padding(bottom = 12.dp)
        )
        OutlinedTextField(
            value = meetingName,
            onValueChange = onMeetingName,
            label = { Text("Meeting name — this send is saved under it in History") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth()
        )
        OutlinedTextField(
            value = message,
            onValueChange = onMessage,
            label = { Text("Message") },
            supportingText = { Text("{name} is replaced with each person's name automatically.") },
            minLines = 4,
            modifier = Modifier.fillMaxWidth().padding(top = 12.dp)
        )
        Row(Modifier.fillMaxWidth().padding(top = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("Recipients (${selectedIds.size}/${pool.size})", style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
            TextButton(onClick = onSelectAll) { Text("Select all") }
            TextButton(onClick = onClear) { Text("Clear") }
        }
        if (pool.isEmpty()) {
            EmptyBox("No Confirmed registrants", "Mark some registrations as Confirmed first.", modifier = Modifier.weight(1f))
        } else {
            LazyColumn(modifier = Modifier.weight(1f).padding(top = 4.dp)) {
                items(pool, key = { it.id }) { person ->
                    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(checked = person.id in selectedIds, onCheckedChange = { onToggle(person.id) })
                        Column(Modifier.weight(1f)) {
                            Text(person.name.ifBlank { "(no name)" }, style = MaterialTheme.typography.bodyMedium)
                            Text(person.phone, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
        }
        Button(onClick = onStart, enabled = selectedIds.isNotEmpty(), modifier = Modifier.fillMaxWidth().padding(top = 12.dp)) {
            Text("Start Sending")
        }
    }
}

@Composable
private fun QueueStep(
    index: Int,
    total: Int,
    person: Registration,
    opened: Boolean,
    onOpen: () -> Unit,
    onSkip: () -> Unit,
    onConfirmSent: () -> Unit,
    onStop: () -> Unit
) {
    Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        Text("${index + 1} of $total", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(person.name.ifBlank { "(no name)" }, style = MaterialTheme.typography.headlineSmall, modifier = Modifier.padding(top = 8.dp))
        Text(person.phone, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)

        if (opened) {
            Text("Did you hit send in WhatsApp?", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 24.dp, bottom = 12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TextButton(onClick = onStop) { Text("Stop") }
                OutlinedButton(onClick = onOpen) { Text("Reopen WhatsApp") }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 8.dp)) {
                OutlinedButton(onClick = onSkip) { Text("Skip (not sent)") }
                Button(onClick = onConfirmSent) { Text("✓ Yes, sent — Next") }
            }
        } else {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 24.dp)) {
                TextButton(onClick = onStop) { Text("Stop") }
                OutlinedButton(onClick = onSkip) { Text("Skip") }
                Button(onClick = onOpen) { Text("Open WhatsApp →") }
            }
        }
    }
}

@Composable
private fun DoneStep(sent: Int, total: Int, stopped: Boolean, onClose: () -> Unit) {
    Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        Text("✓", style = MaterialTheme.typography.displayMedium, color = MaterialTheme.colorScheme.primary)
        Text("All done", style = MaterialTheme.typography.headlineSmall, modifier = Modifier.padding(top = 8.dp))
        Text(
            "Sent to $sent of $total recipient${if (total == 1) "" else "s"}${if (stopped) " (stopped early)" else ""}.",
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.padding(top = 8.dp, bottom = 20.dp)
        )
        Button(onClick = onClose) { Text("Close") }
    }
}
