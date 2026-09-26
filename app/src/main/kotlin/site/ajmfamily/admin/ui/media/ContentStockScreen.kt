package site.ajmfamily.admin.ui.media

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.weight
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.IosShare
import androidx.compose.material.icons.filled.OpenInNew
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
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import site.ajmfamily.admin.core.logic.mediaItemsToCsv
import site.ajmfamily.admin.core.model.DEFAULT_CATEGORIES
import site.ajmfamily.admin.core.model.MediaItem
import site.ajmfamily.admin.core.model.MediaItemStatus
import site.ajmfamily.admin.core.model.MediaPlatform
import site.ajmfamily.admin.ui.common.EmptyBox
import site.ajmfamily.admin.ui.common.ErrorBox
import site.ajmfamily.admin.ui.common.LoadingBox
import site.ajmfamily.admin.util.shareCsv

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ContentStockScreen(viewModel: MediaViewModel) {
    val state by viewModel.state.collectAsState()
    val context = LocalContext.current
    var statusFilter by remember { mutableStateOf<String?>(null) }
    var search by remember { mutableStateOf("") }

    val filtered = remember(state.items, statusFilter, search) {
        state.items
            .filter { statusFilter == null || it.status == statusFilter }
            .filter { search.isBlank() || it.title.contains(search, ignoreCase = true) }
    }

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text("Content Stock", style = MaterialTheme.typography.titleMedium)
            TextButton(onClick = { shareCsv(context, "content_stock.csv", mediaItemsToCsv(state.items)) }) {
                Icon(Icons.Filled.IosShare, contentDescription = null, modifier = Modifier.padding(end = 4.dp))
                Text("Export")
            }
        }

        AddItemForm(onAdd = viewModel::addItem)

        Row(Modifier.padding(top = 8.dp).horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            FilterChip(selected = statusFilter == null, onClick = { statusFilter = null }, label = { Text("All") })
            MediaItemStatus.ALL.forEach { s ->
                FilterChip(selected = statusFilter == s, onClick = { statusFilter = s }, label = { Text(s) })
            }
        }
        OutlinedTextField(
            value = search,
            onValueChange = { search = it },
            placeholder = { Text("Search titles…") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth().padding(top = 8.dp)
        )

        when {
            state.itemsLoading -> LoadingBox(Modifier.weight(1f))
            state.itemsError != null -> ErrorBox(state.itemsError!!, onRetry = viewModel::loadItems, modifier = Modifier.weight(1f))
            filtered.isEmpty() -> EmptyBox("Nothing here yet", modifier = Modifier.weight(1f))
            else -> LazyColumn(Modifier.weight(1f).padding(top = 8.dp)) {
                items(filtered, key = { it.id }) { item ->
                    ContentItemCard(
                        item = item,
                        onStatus = { viewModel.setItemStatus(item, it) },
                        onPlatform = { viewModel.setItemPlatform(item, it) },
                        onDelete = { viewModel.deleteItem(item.id) }
                    )
                }
            }
        }
    }
}

@Composable
private fun AddItemForm(onAdd: (title: String, type: String, link: String) -> Unit) {
    var title by remember { mutableStateOf("") }
    var type by remember { mutableStateOf(DEFAULT_CATEGORIES.first()) }
    var link by remember { mutableStateOf("") }
    var typeExpanded by remember { mutableStateOf(false) }

    Column {
        OutlinedTextField(
            value = title,
            onValueChange = { title = it },
            placeholder = { Text("Title — e.g. Easter morning reel") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth()
        )
        Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("Type:", style = MaterialTheme.typography.bodyMedium)
            Box {
                OutlinedButton(onClick = { typeExpanded = true }) { Text(type) }
                DropdownMenu(expanded = typeExpanded, onDismissRequest = { typeExpanded = false }) {
                    DEFAULT_CATEGORIES.forEach { cat ->
                        DropdownMenuItem(text = { Text(cat) }, onClick = { type = cat; typeExpanded = false })
                    }
                }
            }
        }
        OutlinedTextField(
            value = link,
            onValueChange = { link = it },
            placeholder = { Text("Link (optional)") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth().padding(top = 8.dp)
        )
        TextButton(
            onClick = { onAdd(title.trim(), type, link.trim()); title = ""; link = "" },
            enabled = title.isNotBlank(),
            modifier = Modifier.padding(top = 4.dp)
        ) {
            Icon(Icons.Filled.Add, contentDescription = null, modifier = Modifier.padding(end = 4.dp))
            Text("Add")
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ContentItemCard(
    item: MediaItem,
    onStatus: (String) -> Unit,
    onPlatform: (String) -> Unit,
    onDelete: () -> Unit
) {
    val uriHandler = LocalUriHandler.current
    Card(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Column(Modifier.padding(12.dp)) {
            Row(verticalAlignment = Alignment.Top) {
                Column(Modifier.weight(1f)) {
                    Text(item.title, style = MaterialTheme.typography.titleSmall)
                    Text(item.type, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    if (item.link.isNotBlank()) {
                        TextButton(onClick = { runCatching { uriHandler.openUri(item.link) } }, contentPadding = PaddingValues(0.dp)) {
                            Icon(Icons.Filled.OpenInNew, contentDescription = null, modifier = Modifier.padding(end = 4.dp))
                            Text("Open link", style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }
                IconButton(onClick = onDelete) { Icon(Icons.Filled.Delete, contentDescription = "Delete") }
            }
            Row(Modifier.padding(top = 6.dp).horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                MediaItemStatus.ALL.forEach { s ->
                    FilterChip(selected = item.status == s, onClick = { onStatus(s) }, label = { Text(s) })
                }
            }
            if (item.status == MediaItemStatus.UPLOADED) {
                Row(Modifier.padding(top = 6.dp).horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    MediaPlatform.ALL.forEach { p ->
                        FilterChip(selected = item.platform == p, onClick = { onPlatform(p) }, label = { Text(p) })
                    }
                }
            }
        }
    }
}
