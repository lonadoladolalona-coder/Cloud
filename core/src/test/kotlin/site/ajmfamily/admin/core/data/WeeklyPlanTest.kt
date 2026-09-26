package site.ajmfamily.admin.core.data

import java.time.DayOfWeek
import java.time.LocalDate
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class WeeklyPlanTest {

    @Test
    fun `isoDowToJs maps Sunday to 0 and keeps Monday through Saturday as-is`() {
        assertEquals(0, isoDowToJs(DayOfWeek.SUNDAY))
        assertEquals(1, isoDowToJs(DayOfWeek.MONDAY))
        assertEquals(6, isoDowToJs(DayOfWeek.SATURDAY))
    }

    @Test
    fun `jsDayOfWeek matches a known date`() {
        // 2026-09-27 is a Sunday.
        assertEquals(0, jsDayOfWeek(LocalDate.of(2026, 9, 27)))
        // 2026-09-29 is a Tuesday.
        assertEquals(2, jsDayOfWeek(LocalDate.of(2026, 9, 29)))
    }

    @Test
    fun `chipsFor Tuesday includes the sermon reel and the songs row`() {
        val chips = WeeklyPlan.chipsFor(2)

        assertTrue(chips.any { (row, part) -> row.category == "Reels" && part.what == "Reel from Sermon" })
        assertTrue(chips.any { (row, _) -> row.category == "Songs" })
    }

    @Test
    fun `chipsFor never returns a part that is defined as a span`() {
        val chips = WeeklyPlan.chipsFor(3) // Wednesday, inside Promo Creative's Sun-Fri span

        assertTrue(chips.none { (row, _) -> row.category == "Promo Creative" })
    }

    @Test
    fun `spans returns Promo Creative running Sunday through Friday`() {
        val spans = WeeklyPlan.spans()
        val promo = spans.first { (row, _, _) -> row.category == "Promo Creative" }

        assertEquals(0 to 5, promo.third)
    }

    @Test
    fun `the upcoming event resolves to the expected date`() {
        assertEquals(LocalDate.of(2026, 10, 20), WeeklyPlan.event.date)
    }
}
