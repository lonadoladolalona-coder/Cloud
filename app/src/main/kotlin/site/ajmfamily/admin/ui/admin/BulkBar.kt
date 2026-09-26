package site.ajmfamily.admin.ui.admin

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Archive
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import site.ajmfamily.admin.ui.theme.Bad

/** Mirrors admin.html's fixed bottom "bulkbar" that appears once one or more rows are selected. */
@Composable
fun BulkBar(
    count: Int,
    onConfirm: () -> Unit,
    onContacted: () -> Unit,
    onPending: () -> Unit,
    onArchive: () -> Unit,
    onDelete: () -> Unit,
    onClear: () -> Unit
) {
    Surface(
        color = MaterialTheme.colorScheme.inverseSurface,
        contentColor = MaterialTheme.colorScheme.inverseOnSurface,
        shadowElevation = 8.dp
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState())
                .padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            Text("$count selected", modifier = Modifier.padding(end = 8.dp), style = MaterialTheme.typography.labelLarge)
            TextButton(onClick = onConfirm) {
                Icon(Icons.Filled.Check, contentDescription = null, modifier = Modifier.padding(end = 4.dp))
                Text("Confirm")
            }
            TextButton(onClick = onContacted) { Text("Contacted") }
            TextButton(onClick = onPending) { Text("Pending") }
            TextButton(onClick = onArchive) {
                Icon(Icons.Filled.Archive, contentDescription = null, modifier = Modifier.padding(end = 4.dp))
                Text("History")
            }
            TextButton(onClick = onDelete) {
                Icon(Icons.Filled.Delete, contentDescription = null, tint = Bad, modifier = Modifier.padding(end = 4.dp))
                Text("Delete", color = Bad)
            }
            IconButton(onClick = onClear) {
                Icon(Icons.Filled.Close, contentDescription = "Clear selection")
            }
        }
    }
}
