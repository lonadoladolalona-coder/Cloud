package site.ajmfamily.admin.core.logic

import kotlin.test.Test
import kotlin.test.assertEquals

class MediaChartMathTest {

    @Test
    fun `cleanToken accepts numbers and status letters, rejects everything else`() {
        assertEquals("2", cleanToken("2"))
        assertEquals("c", cleanToken("C"))
        assertEquals("p", cleanToken(" p "))
        assertEquals("", cleanToken("x"))
        assertEquals("", cleanToken("1000"))
    }

    @Test
    fun `splitCells always returns 31 slots`() {
        assertEquals(31, splitCells("").size)
        assertEquals(31, splitCells("2..1.c").size)
        assertEquals(listOf("2", "", "1", "c"), splitCells("2..1.c").take(4))
    }

    @Test
    fun `joinCells trims trailing empty days`() {
        val cells = splitCells("2..1.c")
        assertEquals("2..1.c", joinCells(cells))
    }

    @Test
    fun `cellsTotal counts numbers plus one per completed piece`() {
        assertEquals(0, cellsTotal(""))
        assertEquals(3, cellsTotal("2..1"))
        assertEquals(1, cellsTotal("c"))
        assertEquals(3, cellsTotal("2.c"))
        assertEquals(0, cellsTotal("p.r.o"))
    }

    @Test
    fun `applyCellChanges sets a cell and recomputes the joined string`() {
        val data = mapOf("Reel" to "1..1")
        val updated = applyCellChanges(data, mapOf("Reel" to mapOf(2 to "3")))

        assertEquals("1.3.1", updated.getValue("Reel"))
    }

    @Test
    fun `applyCellChanges drops a category once every cell is cleared`() {
        val data = mapOf("Reel" to "5")
        val updated = applyCellChanges(data, mapOf("Reel" to mapOf(1 to "")))

        assertEquals(false, updated.containsKey("Reel"))
    }

    @Test
    fun `applyCellChanges ignores out-of-range days`() {
        val updated = applyCellChanges(emptyMap(), mapOf("Reel" to mapOf(0 to "2", 32 to "2", 5 to "1")))

        assertEquals("....1", updated.getValue("Reel"))
    }
}
