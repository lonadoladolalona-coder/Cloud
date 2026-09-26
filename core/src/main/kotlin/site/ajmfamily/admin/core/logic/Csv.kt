package site.ajmfamily.admin.core.logic

import site.ajmfamily.admin.core.model.MediaItem
import site.ajmfamily.admin.core.model.Registration

private val FORMULA_PREFIX = Regex("""^[=+\-@]""")

/** Quotes a CSV cell and, for non-phone columns, guards against spreadsheet formula injection. */
private fun csvCell(column: String, value: String): String {
    var s = value
    if (column != "Phone" && FORMULA_PREFIX.containsMatchIn(s)) s = "'$s"
    return "\"${s.replace("\"", "\"\"")}\""
}

private fun csvLine(columns: List<String>, values: List<String>): String =
    columns.zip(values).joinToString(",") { (c, v) -> csvCell(c, v) }

fun registrationsToCsv(rows: List<Registration>): String {
    val cols = listOf("Timestamp", "Source", "Name", "Phone", "Email", "Details", "Status")
    val lines = mutableListOf(cols.joinToString(","))
    rows.forEach { r -> lines.add(csvLine(cols, listOf(r.timestamp, r.source, r.name, r.phone, r.email, r.details, r.status))) }
    return lines.joinToString("\n")
}

fun mediaItemsToCsv(rows: List<MediaItem>): String {
    val cols = listOf("Title", "Type", "Status", "Platform", "Link", "AddedAt", "UpdatedAt")
    val lines = mutableListOf(cols.joinToString(","))
    rows.forEach { r -> lines.add(csvLine(cols, listOf(r.title, r.type, r.status, r.platform, r.link, r.addedAt, r.updatedAt))) }
    return lines.joinToString("\n")
}
