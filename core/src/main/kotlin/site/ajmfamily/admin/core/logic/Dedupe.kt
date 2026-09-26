package site.ajmfamily.admin.core.logic

import site.ajmfamily.admin.core.model.Registration

/** Last 10 digits of a phone number, or "" if too short to be a real number (mirrors phoneKey_ in apps-script.gs). */
fun phoneKey(phone: String): String {
    val digits = phone.filter { it.isDigit() }
    return if (digits.length >= 8) digits.takeLast(10) else ""
}

data class DuplicateInfo(val key: String, val count: Int) {
    val isDuplicate: Boolean get() = key.isNotEmpty() && count > 1
}

/**
 * Flags rows that share a phone number with another *active* row, for display only —
 * nothing is merged or removed. A row already moved to History is never counted as a
 * duplicate of today's list.
 */
fun markDuplicates(registrations: List<Registration>): Map<Registration, DuplicateInfo> {
    val keyOf = registrations.associateWith { r -> if (r.isActive) phoneKey(r.phone) else "" }
    val counts = mutableMapOf<String, Int>()
    keyOf.values.filter { it.isNotEmpty() }.forEach { k -> counts[k] = (counts[k] ?: 0) + 1 }
    return registrations.associateWith { r ->
        val k = keyOf.getValue(r)
        DuplicateInfo(k, if (k.isEmpty()) 1 else counts.getValue(k))
    }
}

/**
 * Keeps only the most recent row per phone number. Timestamps are ISO-8601 UTC
 * strings, which sort correctly with plain string comparison, so no date parsing
 * is needed here.
 */
fun dedupeByPhone(rows: List<Registration>): List<Registration> {
    val map = LinkedHashMap<String, Registration>()
    var blankCounter = 0
    rows.forEach { r ->
        val key = phoneKey(r.phone).ifEmpty { "__blank${blankCounter++}" }
        val existing = map[key]
        if (existing == null || r.timestamp > existing.timestamp) map[key] = r
    }
    return map.values.toList()
}
