package site.ajmfamily.admin.core.logic

import site.ajmfamily.admin.core.model.MediaChart
import site.ajmfamily.admin.core.model.StockAdjustment
import kotlin.test.Test
import kotlin.test.assertEquals

class StockTest {

    @Test
    fun `summarizeStock combines opening stock with made and uploaded totals across months`() {
        val charts = listOf(
            MediaChart(month = "2026-01", data = mapOf("Reel" to "2.c"), uploaded = mapOf("Reel" to "1")),
            MediaChart(month = "2026-02", data = mapOf("Reel" to "1"), uploaded = mapOf("Reel" to "c"))
        )
        val stock = mapOf("Reel" to StockAdjustment(opening = 5, notNeeded = 1))

        val summary = summarizeStock(listOf("Reel"), charts, stock).first { it.type == "Reel" }

        assertEquals(5, summary.opening)
        assertEquals(4, summary.made) // (2+1) + 1
        assertEquals(2, summary.uploaded) // 1 + 1
        assertEquals(1, summary.notNeeded)
        assertEquals(6, summary.leftToUpload) // 5 + 4 - 2 - 1
    }

    @Test
    fun `summarizeStock includes a known category even with no activity yet`() {
        val summary = summarizeStock(listOf("Other Work"), emptyList(), emptyMap())

        assertEquals(1, summary.size)
        assertEquals(0, summary.first().leftToUpload)
    }

    @Test
    fun `summarizeByMonth sorts chronologically by month key`() {
        val charts = listOf(
            MediaChart(month = "2026-03", total = 3, uploadedTotal = 1),
            MediaChart(month = "2026-01", total = 1, uploadedTotal = 0)
        )
        val months = summarizeByMonth(charts)

        assertEquals(listOf("2026-01", "2026-03"), months.map { it.month })
    }
}
