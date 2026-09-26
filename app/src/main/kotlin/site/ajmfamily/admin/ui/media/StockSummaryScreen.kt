package site.ajmfamily.admin.ui.media

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.weight
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Card
import androidx.compose.material3.IconButton
import androidx.compose.material3.Icon
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import site.ajmfamily.admin.core.logic.TypeStockSummary

@Composable
fun StockSummaryScreen(viewModel: MediaViewModel) {
    val state by viewModel.state.collectAsState()
    val summary = state.stockSummary
    val months = state.monthTotals

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text("Stock Summary", style = MaterialTheme.typography.titleMedium)
            IconButton(onClick = viewModel::refreshAll) { Icon(Icons.Filled.Refresh, contentDescription = "Refresh") }
        }

        LazyColumn(Modifier.weight(1f).padding(top = 8.dp)) {
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
                    TotalTile("Made", "${summary.sumOf { it.made }}", Modifier.weight(1f))
                    TotalTile("Uploaded", "${summary.sumOf { it.uploaded }}", Modifier.weight(1f))
                    TotalTile("Left to upload", "${summary.sumOf { it.leftToUpload }}", Modifier.weight(1f))
                }
            }
            item { Text("By type", style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(top = 16.dp, bottom = 4.dp)) }
            items(summary, key = { it.type }) { row ->
                TypeStockCard(
                    summary = row,
                    onOpening = { viewModel.setStock(row.type, "opening", it) },
                    onNotNeeded = { viewModel.setStock(row.type, "notNeeded", it) }
                )
            }
            item { Text("By month", style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(top = 16.dp, bottom = 4.dp)) }
            if (months.isEmpty()) {
                item { Text("Nothing filled in yet.", style = MaterialTheme.typography.bodySmall) }
            }
            items(months, key = { it.month }) { m ->
                Card(Modifier.fillMaxWidth().padding(vertical = 3.dp)) {
                    Row(Modifier.padding(12.dp).fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text(m.month, style = MaterialTheme.typography.bodyMedium)
                        Text("${m.made} made · ${m.uploaded} uploaded", style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }
        }
    }
}

@Composable
private fun TotalTile(label: String, value: String, modifier: Modifier = Modifier) {
    Card(modifier) {
        Column(Modifier.padding(14.dp)) {
            Text(label.uppercase(), style = MaterialTheme.typography.labelSmall)
            Text(value, style = MaterialTheme.typography.headlineSmall)
        }
    }
}

@Composable
private fun TypeStockCard(summary: TypeStockSummary, onOpening: (Int) -> Unit, onNotNeeded: (Int) -> Unit) {
    Card(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Column(Modifier.padding(12.dp)) {
            Text(summary.type, style = MaterialTheme.typography.titleSmall)
            Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                StatMini("Made", "${summary.made}")
                StatMini("Uploaded", "${summary.uploaded}")
                StatMini("Left", "${summary.leftToUpload}")
            }
            Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                EditableNumberField("Opening", summary.opening, onOpening, Modifier.weight(1f))
                EditableNumberField("Not needed", summary.notNeeded, onNotNeeded, Modifier.weight(1f))
            }
        }
    }
}

@Composable
private fun StatMini(label: String, value: String) {
    Column {
        Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, style = MaterialTheme.typography.titleMedium)
    }
}

@Composable
private fun EditableNumberField(label: String, value: Int, onCommit: (Int) -> Unit, modifier: Modifier = Modifier) {
    var text by remember(value) { mutableStateOf(value.toString()) }
    OutlinedTextField(
        value = text,
        onValueChange = { new ->
            val digits = new.filter { it.isDigit() }.take(5)
            text = digits
            val parsed = digits.toIntOrNull()
            if (parsed != null && parsed != value) onCommit(parsed)
        },
        label = { Text(label) },
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
        modifier = modifier
    )
}
