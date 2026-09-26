package site.ajmfamily.admin.core.data

import java.time.DayOfWeek
import java.time.LocalDate

/**
 * One thing the media team makes on a repeating weekly schedule.
 * [days] and [span] use JS `Date.getDay()` convention: 0 = Sunday … 6 = Saturday
 * (see [isoDowToJs]), matching how this was defined in media.html's PLAN_ROWS.
 */
data class PlanPart(
    val what: String,
    val qty: String,
    val sub: String,
    val days: List<Int> = emptyList(),
    /** Inclusive day-of-week range, e.g. Sunday..Friday = 0 to 5. */
    val span: Pair<Int, Int>? = null,
    /** Overrides the row's icon for this part only (e.g. "Live Reel" inside the Reels row). */
    val icon: String? = null
)

data class PlanRow(
    val n: Int,
    val category: String,
    val colorHex: String,
    val icon: String,
    val parts: List<PlanPart>
)

data class PlanEvent(val year: Int, val month: Int, val day: Int, val name: String, val theme: String, val quote: String) {
    val date: LocalDate get() = LocalDate.of(year, month, day)
}

/**
 * The AJM media team's real weekly plan, carried over from PLAN_ROWS in media.html.
 * To change the plan, edit the values below — there is no server-side copy.
 */
object WeeklyPlan {
    val rows: List<PlanRow> = listOf(
        PlanRow(
            n = 1, category = "Reels", colorHex = "#7c5cff", icon = "reel",
            parts = listOf(
                PlanPart("Reel from Sermon", "2 Reels from Sermon / Week", "Reels · 2 a week", days = listOf(2, 4)),
                PlanPart("Live Reel", "1 Live Reel / Week", "Reels · 1 a week", days = listOf(6), icon = "live")
            )
        ),
        PlanRow(
            n = 2, category = "Long Content", colorHex = "#2f6df6", icon = "long",
            parts = listOf(PlanPart("Long Content", "3 Long Content / Week", "3 a week", days = listOf(1, 3, 5)))
        ),
        PlanRow(
            n = 3, category = "Short Story Video", colorHex = "#f0733c", icon = "story",
            parts = listOf(PlanPart("Short Story Video", "1 Video / Week", "1 a week", days = listOf(4)))
        ),
        PlanRow(
            n = 4, category = "Promo Creative", colorHex = "#e8a33d", icon = "promo",
            parts = listOf(PlanPart("Promo Creative", "1 Promo Creative", "Sunday → Friday", span = 0 to 5))
        ),
        PlanRow(
            n = 5, category = "Promo with Pic & Video", colorHex = "#e0567a", icon = "promovid",
            parts = listOf(PlanPart("Promo with Picture & Video", "Promo with Picture & Video", "Promo", days = listOf(2, 3)))
        ),
        PlanRow(
            n = 6, category = "Songs", colorHex = "#1ba39c", icon = "song",
            parts = listOf(PlanPart("Live Worship Video / Practice Time", "Live Worship Video / Practice Time", "Songs", days = listOf(2)))
        )
    )

    val people: List<String> = listOf("Lucky", "Babu")

    val event = PlanEvent(2026, 10, 20, "One Day Youth Meet", "Zen Z / Gen Z", "Zen for Jesus")

    /** Every (row, part) made on a single day (not a [PlanPart.span]) for the given JS-style day-of-week. */
    fun chipsFor(jsDayOfWeek: Int): List<Pair<PlanRow, PlanPart>> =
        rows.flatMap { row -> row.parts.filter { it.days.contains(jsDayOfWeek) }.map { row to it } }

    /** Every (row, part) made over a stretch of days rather than a single day. */
    fun spans(): List<Triple<PlanRow, PlanPart, Pair<Int, Int>>> =
        rows.flatMap { row -> row.parts.mapNotNull { p -> p.span?.let { Triple(row, p, it) } } }
}

/** ISO-8601 day-of-week (Monday=1..Sunday=7) to the JS convention (Sunday=0..Saturday=6). */
fun isoDowToJs(iso: DayOfWeek): Int = if (iso == DayOfWeek.SUNDAY) 0 else iso.value

fun jsDayOfWeek(date: LocalDate): Int = isoDowToJs(date.dayOfWeek)
