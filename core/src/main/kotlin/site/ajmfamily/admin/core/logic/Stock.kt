package site.ajmfamily.admin.core.logic

import site.ajmfamily.admin.core.model.MediaChart
import site.ajmfamily.admin.core.model.StockAdjustment

data class TypeStockSummary(
    val type: String,
    val opening: Int,
    val made: Int,
    val uploaded: Int,
    val notNeeded: Int
) {
    /** opening + made - uploaded - notNeeded, i.e. what's still waiting to be posted. */
    val leftToUpload: Int get() = opening + made - uploaded - notNeeded
}

data class MonthTotals(val month: String, val made: Int, val uploaded: Int)

/** Aggregates every month's chart into one made/uploaded/left-to-upload row per content type. */
fun summarizeStock(
    knownCategories: List<String>,
    charts: List<MediaChart>,
    stock: Map<String, StockAdjustment>
): List<TypeStockSummary> {
    val made = mutableMapOf<String, Int>()
    val uploaded = mutableMapOf<String, Int>()
    charts.forEach { chart ->
        chart.data.forEach { (cat, cells) -> made[cat] = (made[cat] ?: 0) + cellsTotal(cells) }
        chart.uploaded.forEach { (cat, cells) -> uploaded[cat] = (uploaded[cat] ?: 0) + cellsTotal(cells) }
    }
    val allTypes = (knownCategories + made.keys + uploaded.keys + stock.keys).distinct()
    return allTypes.map { type ->
        val adj = stock[type] ?: StockAdjustment()
        TypeStockSummary(type = type, opening = adj.opening, made = made[type] ?: 0, uploaded = uploaded[type] ?: 0, notNeeded = adj.notNeeded)
    }
}

fun summarizeByMonth(charts: List<MediaChart>): List<MonthTotals> =
    charts.map { MonthTotals(it.month, it.total, it.uploadedTotal) }.sortedBy { it.month }
