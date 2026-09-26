package site.ajmfamily.admin.util

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

private val formatter = DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM).withZone(ZoneId.systemDefault())

/** Formats an ISO-8601 UTC timestamp (as returned by Apps Script) for display, or returns it unchanged if unparseable. */
fun formatIsoTimestamp(iso: String): String =
    if (iso.isBlank()) "" else runCatching { formatter.format(Instant.parse(iso)) }.getOrDefault(iso)
