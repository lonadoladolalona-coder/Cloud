package site.ajmfamily.admin.ui.admin.history

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.weight
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import site.ajmfamily.admin.core.model.Meeting
import site.ajmfamily.admin.core.model.MeetingResult
import site.ajmfamily.admin.core.model.Registration
import site.ajmfamily.admin.ui.admin.AdminViewModel
import site.ajmfamily.admin.ui.common.EmptyBox
import site.ajmfamily.admin.util.formatIsoTimestamp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HistoryScreen(viewModel: AdminViewModel, onBack: () -> Unit) {
    val state by viewModel.state.collectAsState()
    var tab by remember { mutableStateOf(0) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("History") },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") }
                }
            )
        }
    ) { padding ->
        Column(Modifier.padding(padding)) {
            TabRow(selectedTabIndex = tab) {
                Tab(selected = tab == 0, onClick = { tab = 0 }, text = { Text("Zoom sends (${state.meetings.size})") })
                Tab(selected = tab == 1, onClick = { tab = 1 }, text = { Text("Past events (${state.archivedGroups.size})") })
            }

            Box(Modifier.weight(1f)) {
                if (tab == 0) {
                    if (state.meetings.isEmpty()) {
                        EmptyBox("No Zoom-link sends yet", "Sends made from “Send Zoom Link” on the Registrations screen show up here.")
                    } else {
                        LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            items(state.meetings, key = { it.id }) { meeting -> MeetingCard(meeting) }
                        }
                    }
                } else {
                    if (state.archivedGroups.isEmpty()) {
                        EmptyBox("No past events", "Use “Move to history” on Registrations to file people under a past event.")
                    } else {
                        LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            state.archivedGroups.forEach { (name, people) ->
                                item(key = "group_$name") {
                                    PastEventCard(name = name, people = people, onRestoreAll = { viewModel.unarchiveGroup(people.map { it.id }) })
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun MeetingCard(meeting: Meeting) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp)) {
            Text(meeting.name, style = MaterialTheme.typography.titleMedium)
            Text(
                "Updated ${formatIsoTimestamp(meeting.updatedAt)}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Text(
                "${meeting.sent} sent · ${meeting.skipped} skipped",
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.padding(top = 4.dp)
            )
            if (meeting.message.isNotBlank()) {
                Text(
                    meeting.message,
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.padding(top = 8.dp)
                )
            }
            meeting.recipients.forEach { r ->
                Row(Modifier.fillMaxWidth().padding(top = 6.dp)) {
                    Text(r.name.ifBlank { r.phone }, style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
                    Text(
                        if (r.result == MeetingResult.SENT) "Sent" else "Skipped",
                        style = MaterialTheme.typography.bodySmall,
                        color = if (r.result == MeetingResult.SENT) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        }
    }
}

@Composable
private fun PastEventCard(name: String, people: List<Registration>, onRestoreAll: () -> Unit) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp)) {
            Row(Modifier.fillMaxWidth()) {
                Column(Modifier.weight(1f)) {
                    Text(name.ifBlank { "(unnamed)" }, style = MaterialTheme.typography.titleMedium)
                    Text("${people.size} people", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                TextButton(onClick = onRestoreAll) { Text("Restore all") }
            }
            people.take(10).forEach { p ->
                Text("• ${p.name.ifBlank { "(no name)" }} — ${p.phone}", style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 4.dp))
            }
            if (people.size > 10) {
                Text("…and ${people.size - 10} more", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp))
            }
        }
    }
}
