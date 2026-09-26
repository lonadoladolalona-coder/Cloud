package site.ajmfamily.admin.ui.media

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import site.ajmfamily.admin.core.data.PlanEvent
import site.ajmfamily.admin.core.data.PlanPart
import site.ajmfamily.admin.core.data.PlanRow
import site.ajmfamily.admin.core.data.WeeklyPlan
import site.ajmfamily.admin.core.data.jsDayOfWeek
import java.time.LocalDate
import java.time.format.TextStyle
import java.time.temporal.ChronoUnit
import java.util.Locale

private data class PlanChip(val colorHex: String, val title: String, val sub: String)

private fun chipsForDate(date: LocalDate): List<PlanChip> {
    val dow = jsDayOfWeek(date)
    val single = WeeklyPlan.chipsFor(dow).map { (row, part) -> PlanChip(row.colorHex, part.what, part.sub) }
    val spans = WeeklyPlan.spans()
        .filter { (_, _, range) -> dow in range.first..range.second }
        .map { (row, part, _) -> PlanChip(row.colorHex, part.what, part.sub) }
    val event = WeeklyPlan.event
    val eventChip = if (date == event.date) listOf(PlanChip("#E8A33D", event.name, "Youth Meet day")) else emptyList()
    return eventChip + single + spans
}

private fun parseHexColor(hex: String): Color = runCatching { Color(android.graphics.Color.parseColor(hex)) }.getOrDefault(Color.Gray)

@Composable
fun WeeklyPlanScreen() {
    val today = remember { LocalDate.now() }
    val startOfWeek = remember(today) { today.minusDays(jsDayOfWeek(today).toLong()) }
    val weekDates = remember(startOfWeek) { (0..6).map { startOfWeek.plusDays(it.toLong()) } }
    val daysUntilEvent = remember { ChronoUnit.DAYS.between(today, WeeklyPlan.event.date) }

    LazyColumn(Modifier.fillMaxSize().padding(16.dp)) {
        item { EventCard(WeeklyPlan.event, daysUntilEvent) }
        item { Text("Today & tomorrow", style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(top = 16.dp, bottom = 6.dp)) }
        item { DayChipsCard("Today", today) }
        item { DayChipsCard("Tomorrow", today.plusDays(1), modifier = Modifier.padding(top = 6.dp)) }

        item { Text("This week", style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(top = 16.dp, bottom = 6.dp)) }
        items(weekDates) { date -> DayChipsCard(date.dayOfWeek.getDisplayName(TextStyle.FULL, Locale.getDefault()), date, modifier = Modifier.padding(bottom = 6.dp)) }

        item { Text("The plan, type by type", style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(top = 16.dp, bottom = 6.dp)) }
        items(WeeklyPlan.rows, key = { it.n }) { row -> PlanRowCard(row) }
        item {
            Text(
                "Content selection: ${WeeklyPlan.people.joinToString(", ")}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 8.dp, bottom = 24.dp)
            )
        }
    }
}

@Composable
private fun EventCard(event: PlanEvent, daysUntil: Long) {
    Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer)) {
        Column(Modifier.padding(18.dp)) {
            Text("COMING UP", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onPrimaryContainer)
            Text(event.name, style = MaterialTheme.typography.headlineSmall, color = MaterialTheme.colorScheme.onPrimaryContainer)
            Text("Theme · ${event.theme}", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onPrimaryContainer)
            Text(
                "“${event.quote}”",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onPrimaryContainer,
                modifier = Modifier.padding(top = 8.dp)
            )
            Text(
                when {
                    daysUntil == 0L -> "Today!"
                    daysUntil == 1L -> "Tomorrow"
                    daysUntil > 0 -> "In $daysUntil days"
                    else -> "This has passed"
                },
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onPrimaryContainer,
                modifier = Modifier.padding(top = 8.dp)
            )
        }
    }
}

@Composable
private fun DayChipsCard(label: String, date: LocalDate, modifier: Modifier = Modifier) {
    val chips = remember(date) { chipsForDate(date) }
    Card(modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp)) {
            Text(label, style = MaterialTheme.typography.titleSmall)
            if (chips.isEmpty()) {
                Text("Nothing scheduled", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp))
            } else {
                chips.forEach { chip ->
                    Row(Modifier.padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(
                            Modifier
                                .size(8.dp)
                                .background(parseHexColor(chip.colorHex), CircleShape)
                        ) {}
                        Column(Modifier.padding(start = 8.dp)) {
                            Text(chip.title, style = MaterialTheme.typography.bodyMedium)
                            Text(chip.sub, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun PlanRowCard(row: PlanRow) {
    Card(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Column(Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.size(10.dp).background(parseHexColor(row.colorHex), CircleShape)) {}
                Text(row.category, style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(start = 8.dp))
            }
            row.parts.forEach { part -> PlanPartLine(part) }
        }
    }
}

@Composable
private fun PlanPartLine(part: PlanPart) {
    Column(Modifier.padding(top = 8.dp)) {
        Text(part.what, style = MaterialTheme.typography.bodyMedium)
        Text(part.qty, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
