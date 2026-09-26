package site.ajmfamily.admin.core.logic

private val NUMBER_TOKEN = Regex("^\\d{1,3}$")
private val STATUS_TOKEN = Regex("^[cpro]$")
private val WHOLE_NUMBER = Regex("^\\d+$")

/** One day's cell value: a whole number (up to 3 digits), c/p/r/o, or "" to clear it. */
fun cleanToken(raw: String): String {
    val t = raw.trim().lowercase()
    return when {
        NUMBER_TOKEN.matches(t) -> t.toInt().toString()
        STATUS_TOKEN.matches(t) -> t
        else -> ""
    }
}

/** Splits a "." joined cell string into exactly 31 day slots (missing days are ""). */
fun splitCells(cellsJoined: String): MutableList<String> {
    val parts = cellsJoined.split(".").take(31).toMutableList()
    while (parts.size < 31) parts.add("")
    return parts
}

/** Inverse of [splitCells]; trailing empty days are dropped so the string stays short. */
fun joinCells(cells: List<String>): String = cells.joinToString(".").trimEnd('.')

/** A number token counts as itself; "c" (one finished piece) counts as 1; p/r/o count as 0. */
fun cellsTotal(cellsJoined: String): Int {
    if (cellsJoined.isBlank()) return 0
    var total = 0
    cellsJoined.split(".").forEach { tok ->
        when {
            WHOLE_NUMBER.matches(tok) -> total += tok.toInt()
            tok == "c" -> total += 1
        }
    }
    return total
}

fun chartTotal(data: Map<String, String>): Int = data.values.sumOf { cellsTotal(it) }

/**
 * Applies `{category -> {day(1..31) -> newToken}}` onto [data] and returns the
 * updated map. A category whose cells become entirely empty is dropped rather
 * than kept as a dead key — mirrors applyCellChanges_ in apps-script.gs, including
 * its 20-category-per-save and 40-character-name limits.
 */
fun applyCellChanges(data: Map<String, String>, changes: Map<String, Map<Int, String>>): Map<String, String> {
    val result = data.toMutableMap()
    changes.entries.take(20).forEach { (category, dayChanges) ->
        val name = category.trim().take(40)
        if (name.isEmpty()) return@forEach
        val cells = splitCells(result[name] ?: "")
        dayChanges.forEach { (day, token) ->
            if (day in 1..31) cells[day - 1] = cleanToken(token)
        }
        val joined = joinCells(cells)
        if (joined.isNotEmpty()) result[name] = joined else result.remove(name)
    }
    return result
}
