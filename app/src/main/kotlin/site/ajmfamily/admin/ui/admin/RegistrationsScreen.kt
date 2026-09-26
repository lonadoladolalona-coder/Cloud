package site.ajmfamily.admin.ui.admin

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.weight
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.IosShare
import androidx.compose.material.icons.filled.Logout
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Checkbox
import androidx.compose.material3.Card
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import site.ajmfamily.admin.core.logic.registrationsToCsv
import site.ajmfamily.admin.core.model.Registration
import site.ajmfamily.admin.core.model.RegistrationSource
import site.ajmfamily.admin.core.model.RegistrationStatus
import site.ajmfamily.admin.ui.common.ConfirmDialog
import site.ajmfamily.admin.ui.common.ErrorBox
import site.ajmfamily.admin.ui.common.HeroStatTile
import site.ajmfamily.admin.ui.common.LoadingBox
import site.ajmfamily.admin.ui.common.SourceBadge
import site.ajmfamily.admin.ui.common.StatTile
import site.ajmfamily.admin.ui.common.StatusPill
import site.ajmfamily.admin.ui.common.TextPromptDialog
import site.ajmfamily.admin.util.shareCsv

private val SORT_OPTIONS = listOf(
    "Newest first" to ("Timestamp" to true),
    "Oldest first" to ("Timestamp" to false),
    "Name (A–Z)" to ("Name" to false),
    "Name (Z–A)" to ("Name" to true),
    "Status (A–Z)" to ("Status" to false),
    "Source (A–Z)" to ("Source" to false)
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RegistrationsScreen(
    viewModel: AdminViewModel,
    onOpenHistory: () -> Unit,
    onOpenZoomSend: () -> Unit,
    onLogOut: () -> Unit
) {
    val state by viewModel.state.collectAsState()
    val context = LocalContext.current
    val snackbarHostState = remember { SnackbarHostState() }
    var menuOpen by remember { mutableStateOf(false) }
    var confirmDeleteId by remember { mutableStateOf<String?>(null) }
    var confirmBulkDelete by remember { mutableStateOf(false) }
    var promptArchiveName by remember { mutableStateOf(false) }

    LaunchedEffect(state.toast) {
        state.toast?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.consumeToast()
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = { Text("Registrations") },
                actions = {
                    IconButton(onClick = onOpenZoomSend) {
                        Icon(Icons.AutoMirrored.Filled.Send, contentDescription = "Send Zoom Link")
                    }
                    IconButton(onClick = { viewModel.refresh() }) {
                        Icon(Icons.Filled.Refresh, contentDescription = "Refresh")
                    }
                    IconButton(onClick = { menuOpen = true }) {
                        Icon(Icons.Filled.MoreVert, contentDescription = "More")
                    }
                    DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                        DropdownMenuItem(
                            text = { Text("History") },
                            leadingIcon = { Icon(Icons.Filled.History, contentDescription = null) },
                            onClick = { menuOpen = false; onOpenHistory() }
                        )
                        DropdownMenuItem(
                            text = { Text("Export CSV") },
                            leadingIcon = { Icon(Icons.Filled.IosShare, contentDescription = null) },
                            onClick = {
                                menuOpen = false
                                shareCsv(context, "registrations.csv", registrationsToCsv(state.visibleRows))
                            }
                        )
                        DropdownMenuItem(
                            text = { Text("Log out") },
                            leadingIcon = { Icon(Icons.Filled.Logout, contentDescription = null) },
                            onClick = { menuOpen = false; onLogOut() }
                        )
                    }
                }
            )
        },
        bottomBar = {
            if (state.selected.isNotEmpty()) {
                BulkBar(
                    count = state.selected.size,
                    onConfirm = { viewModel.bulkStatus(RegistrationStatus.CONFIRMED) },
                    onContacted = { viewModel.bulkStatus(RegistrationStatus.CONTACTED) },
                    onPending = { viewModel.bulkStatus(RegistrationStatus.PENDING) },
                    onArchive = { promptArchiveName = true },
                    onDelete = { confirmBulkDelete = true },
                    onClear = { viewModel.clearSelection() }
                )
            }
        }
    ) { padding ->
        when {
            state.loading -> LoadingBox(Modifier.padding(padding))
            state.error != null -> ErrorBox(state.error!!, onRetry = { viewModel.refresh() }, modifier = Modifier.padding(padding))
            else -> LazyColumn(
                modifier = Modifier.padding(padding).fillMaxWidth(),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                item { StatsRow(state) }
                item { FilterTabsRow(state, onFilter = viewModel::setFilter) }
                item { SearchAndSort(state, onSearch = viewModel::setSearch, onSort = viewModel::setSort) }
                if (state.visibleRows.isEmpty()) {
                    item { Text("No registrations in this view.", modifier = Modifier.padding(vertical = 24.dp)) }
                }
                items(state.visibleRows, key = { it.id.ifBlank { it.hashCode().toString() } }) { row ->
                    RegistrationCard(
                        row = row,
                        duplicate = state.duplicateInfo[row]?.isDuplicate == true,
                        selected = row.id in state.selected,
                        busy = row.id in state.busyIds,
                        onToggleSelect = { viewModel.toggleSelected(row.id) },
                        onStatusChange = { viewModel.setStatus(row.id, it) },
                        onDelete = { confirmDeleteId = row.id }
                    )
                }
            }
        }
    }

    confirmDeleteId?.let { id ->
        ConfirmDialog(
            title = "Delete registration?",
            text = "This removes the row from the sheet. This cannot be undone.",
            confirmLabel = "Delete",
            destructive = true,
            onConfirm = { viewModel.deleteOne(id); confirmDeleteId = null },
            onDismiss = { confirmDeleteId = null }
        )
    }

    if (confirmBulkDelete) {
        ConfirmDialog(
            title = "Delete ${state.selected.size} registrations?",
            text = "This cannot be undone.",
            confirmLabel = "Delete",
            destructive = true,
            onConfirm = { viewModel.bulkDelete(); confirmBulkDelete = false },
            onDismiss = { confirmBulkDelete = false }
        )
    }

    if (promptArchiveName) {
        TextPromptDialog(
            title = "Move to history",
            label = "Past event name",
            confirmLabel = "Move",
            onConfirm = { name -> viewModel.archiveSelected(name); promptArchiveName = false },
            onDismiss = { promptArchiveName = false }
        )
    }
}

@Composable
private fun StatsRow(state: AdminUiState) {
    val stats = state.stats
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        HeroStatTile(
            total = stats.totalActive,
            confirmed = stats.confirmed,
            contacted = stats.contacted,
            pending = stats.pending,
            modifier = Modifier.fillMaxWidth()
        )
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.horizontalScroll(rememberScrollState())) {
            StatTile("Pending", "${stats.pending}", modifier = Modifier.width(130.dp))
            StatTile("Contacted", "${stats.contacted}", modifier = Modifier.width(130.dp))
            StatTile("Confirmed", "${stats.confirmed}", modifier = Modifier.width(130.dp))
            StatTile("Duplicates", "${stats.duplicates}", modifier = Modifier.width(130.dp))
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun FilterTabsRow(state: AdminUiState, onFilter: (String) -> Unit) {
    val stats = state.stats
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.horizontalScroll(rememberScrollState())) {
        FilterChip(selected = state.filter == FILTER_ALL, onClick = { onFilter(FILTER_ALL) }, label = { Text("All ${stats.totalActive}") })
        RegistrationSource.ALL.forEach { source ->
            FilterChip(
                selected = state.filter == source,
                onClick = { onFilter(source) },
                label = { Text("$source ${stats.bySource[source] ?: 0}") }
            )
        }
        FilterChip(
            selected = state.filter == FILTER_DUPLICATES,
            onClick = { onFilter(FILTER_DUPLICATES) },
            label = { Text("⚠ Duplicates ${stats.duplicates}") }
        )
    }
}

@Composable
private fun SearchAndSort(state: AdminUiState, onSearch: (String) -> Unit, onSort: (String, Boolean) -> Unit) {
    var sortExpanded by remember { mutableStateOf(false) }
    val currentLabel = SORT_OPTIONS.firstOrNull { it.second == (state.sortField to state.sortDesc) }?.first ?: "Newest first"

    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedTextField(
            value = state.search,
            onValueChange = onSearch,
            leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
            placeholder = { Text("Search name, phone, email…") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth()
        )
        Box {
            OutlinedButton(onClick = { sortExpanded = true }, modifier = Modifier.fillMaxWidth()) {
                Text("Sort: $currentLabel")
            }
            DropdownMenu(expanded = sortExpanded, onDismissRequest = { sortExpanded = false }) {
                SORT_OPTIONS.forEach { (label, value) ->
                    DropdownMenuItem(
                        text = { Text(label) },
                        onClick = { onSort(value.first, value.second); sortExpanded = false }
                    )
                }
            }
        }
    }
}

@Composable
private fun RegistrationCard(
    row: Registration,
    duplicate: Boolean,
    selected: Boolean,
    busy: Boolean,
    onToggleSelect: () -> Unit,
    onStatusChange: (String) -> Unit,
    onDelete: () -> Unit
) {
    var statusMenuOpen by remember { mutableStateOf(false) }
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.Top) {
                Checkbox(checked = selected, onCheckedChange = { onToggleSelect() })
                Column(Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(row.name.ifBlank { "(no name)" }, style = MaterialTheme.typography.titleMedium)
                        if (duplicate) {
                            Text(" ⚠ duplicate", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.error)
                        }
                    }
                    Spacer(Modifier.padding(top = 4.dp))
                    SourceBadge(row.source)
                    if (row.phone.isNotBlank()) Text(row.phone, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 4.dp))
                    if (row.email.isNotBlank()) Text(row.email, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    if (row.details.isNotBlank()) Text(row.details, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 4.dp))
                }
                IconButton(onClick = onDelete, enabled = !busy) {
                    Icon(Icons.Filled.Delete, contentDescription = "Delete")
                }
            }
            Row(Modifier.padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Box {
                    StatusPill(row.status, modifier = Modifier.clickable { statusMenuOpen = true })
                    DropdownMenu(expanded = statusMenuOpen, onDismissRequest = { statusMenuOpen = false }) {
                        RegistrationStatus.ALL.forEach { s ->
                            DropdownMenuItem(text = { Text(s) }, onClick = { onStatusChange(s); statusMenuOpen = false })
                        }
                    }
                }
            }
        }
    }
}
