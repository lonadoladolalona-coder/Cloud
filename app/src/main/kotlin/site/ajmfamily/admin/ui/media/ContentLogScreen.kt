package site.ajmfamily.admin.ui.media

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.weight
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.KeyboardArrowLeft
import androidx.compose.material.icons.filled.KeyboardArrowRight
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import site.ajmfamily.admin.core.logic.cellsTotal
import site.ajmfamily.admin.core.logic.splitCells
import site.ajmfamily.admin.ui.common.ErrorBox
import site.ajmfamily.admin.ui.common.LoadingBox
import site.ajmfamily.admin.ui.theme.OkSoft
import site.ajmfamily.admin.ui.theme.WarnSoft

private val MONTH_NAMES = listOf(
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ContentLogScreen(viewModel: MediaViewModel) {
    val state by viewModel.state.collectAsState()
    var cellDialog by remember { mutableStateOf<Pair<String, Int>?>(null) }

    LaunchedEffect(Unit) {
        while (isActive) {
            delay(15_000)
            viewModel.refreshCurrentMonthSilently()
        }
    }

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        MonthSelector(state.year, state.month, onChange = viewModel::selectMonth)

        Row(Modifier.padding(top = 8.dp, bottom = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(selected = state.view == CHART_VIEW_MADE, onClick = { viewModel.setView(CHART_VIEW_MADE) }, label = { Text("Made") })
            FilterChip(selected = state.view == CHART_VIEW_UPLOADED, onClick = { viewModel.setView(CHART_VIEW_UPLOADED) }, label = { Text("Uploaded") })
        }

        when {
            state.loading -> LoadingBox(Modifier.weight(1f))
            state.error != null -> ErrorBox(state.error!!, onRetry = viewModel::refreshAll, modifier = Modifier.weight(1f))
            else -> {
                val displayed = state.displayedData()
                LazyColumn(Modifier.weight(1f)) {
                    items(state.categories, key = { it }) { category ->
                        CategoryLogRow(
                            category = category,
                            cellsJoined = displayed[category].orEmpty(),
                            onCellTap = { day -> cellDialog = category to day }
                        )
                    }
                    item {
                        OutlinedTextField(
                            value = state.note,
                            onValueChange = viewModel::setNote,
                            label = { Text("Notes (optional)") },
                            minLines = 2,
                            modifier = Modifier.fillMaxWidth().padding(top = 12.dp)
                        )
                    }
                }
                SaveBar(saving = state.saving, hasPending = state.hasPending, error = state.saveError, onSave = { viewModel.save() })
            }
        }
    }

    cellDialog?.let { (category, day) ->
        val current = splitCells(state.displayedData()[category].orEmpty())[day - 1]
        CellEditDialog(
            category = category,
            day = day,
            current = current,
            onSet = { token -> viewModel.setCell(category, day, token); cellDialog = null },
            onDismiss = { cellDialog = null }
        )
    }
}

@Composable
private fun MonthSelector(year: Int, month: Int, onChange: (Int, Int) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
        IconButton(onClick = { if (month == 1) onChange(year - 1, 12) else onChange(year, month - 1) }) {
            Icon(Icons.Filled.KeyboardArrowLeft, contentDescription = "Previous month")
        }
        Text(
            "${MONTH_NAMES[month - 1]} $year",
            style = MaterialTheme.typography.titleMedium,
            textAlign = TextAlign.Center,
            modifier = Modifier.weight(1f)
        )
        IconButton(onClick = { if (month == 12) onChange(year + 1, 1) else onChange(year, month + 1) }) {
            Icon(Icons.Filled.KeyboardArrowRight, contentDescription = "Next month")
        }
    }
}

@Composable
private fun CategoryLogRow(category: String, cellsJoined: String, onCellTap: (Int) -> Unit) {
    val cells = remember(cellsJoined) { splitCells(cellsJoined) }
    val total = remember(cellsJoined) { cellsTotal(cellsJoined) }
    Card(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Column(Modifier.padding(12.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(category, style = MaterialTheme.typography.titleSmall)
                Text("$total", style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary)
            }
            Row(Modifier.horizontalScroll(rememberScrollState()).padding(top = 8.dp)) {
                cells.forEachIndexed { index, token ->
                    DayCell(day = index + 1, token = token, onClick = { onCellTap(index + 1) })
                }
            }
        }
    }
}

@Composable
private fun DayCell(day: Int, token: String, onClick: () -> Unit) {
    val bg = when (token) {
        "c" -> OkSoft
        "p" -> WarnSoft
        "r" -> MaterialTheme.colorScheme.tertiaryContainer
        "o" -> MaterialTheme.colorScheme.surfaceVariant
        else -> if (token.isNotBlank()) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface
    }
    Column(
        Modifier.width(30.dp).padding(2.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text("$day", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Box(
            Modifier
                .fillMaxWidth()
                .height(28.dp)
                .clickable(onClick = onClick)
                .background(bg, RoundedCornerShape(6.dp)),
            contentAlignment = Alignment.Center
        ) {
            Text(token.ifBlank { "·" }, style = MaterialTheme.typography.labelSmall)
        }
    }
}

@Composable
private fun CellEditDialog(category: String, day: Int, current: String, onSet: (String) -> Unit, onDismiss: () -> Unit) {
    var text by remember(current) { mutableStateOf(if (current.all { it.isDigit() }) current else "") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("$category — Day $day") },
        text = {
            Column {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    listOf("c" to "✓", "p" to "P", "r" to "R", "o" to "O").forEach { (token, label) ->
                        OutlinedButton(onClick = { onSet(token) }) { Text(label) }
                    }
                }
                OutlinedTextField(
                    value = text,
                    onValueChange = { text = it.filter(Char::isDigit).take(3) },
                    label = { Text("Number made") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    modifier = Modifier.fillMaxWidth().padding(top = 12.dp)
                )
            }
        },
        confirmButton = {
            Row {
                TextButton(onClick = { onSet("") }) { Text("Clear") }
                TextButton(onClick = { onSet(text) }, enabled = text.isNotBlank()) { Text("Set") }
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } }
    )
}

@Composable
private fun SaveBar(saving: Boolean, hasPending: Boolean, error: String?, onSave: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(top = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(
            when {
                error != null -> "Could not save: $error"
                saving -> "Saving…"
                hasPending -> "Unsaved changes"
                else -> "All changes saved"
            },
            style = MaterialTheme.typography.bodySmall,
            color = if (error != null) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.weight(1f)
        )
        Button(onClick = onSave, enabled = hasPending && !saving) { Text("Save") }
    }
}
