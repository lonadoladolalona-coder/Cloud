package site.ajmfamily.admin.core.model

import kotlinx.serialization.Serializable

object MediaItemStatus {
    const val READY = "Ready"
    const val UPLOADED = "Uploaded"
    const val NOT_NEEDED = "Not needed"
    val ALL = listOf(READY, UPLOADED, NOT_NEEDED)
}

object MediaPlatform {
    val ALL = listOf("YouTube", "Instagram", "Facebook", "WhatsApp", "Other")
}

/** Work types tracked on the Content Log grid, in display order. */
val DEFAULT_CATEGORIES = listOf(
    "Reel", "Long Content", "Sunday Flyer", "Monday Flyer",
    "Video Promo", "T-Shirt Work", "Other Work"
)

val CATEGORY_COLORS: Map<String, String> = mapOf(
    "Reel" to "#7c5cff",
    "Long Content" to "#2f6df6",
    "Sunday Flyer" to "#e8a33d",
    "Monday Flyer" to "#f0733c",
    "Video Promo" to "#e0567a",
    "T-Shirt Work" to "#1ba39c",
    "Other Work" to "#69758c"
)

@Serializable
data class MediaItem(
    val id: String = "",
    val title: String = "",
    val type: String = "",
    val link: String = "",
    val status: String = MediaItemStatus.READY,
    val platform: String = "",
    val addedAt: String = "",
    val updatedAt: String = ""
)

/**
 * One month's shared content chart. [data] and [uploaded] map a category name to
 * a "." joined string of up to 31 per-day tokens (a count, or c/p/r/o) — the same
 * shape the Apps Script stores in the sheet's Data/Uploaded columns.
 */
@Serializable
data class MediaChart(
    val month: String = "",
    val total: Int = 0,
    val submittedAt: String = "",
    val updatedAt: String = "",
    val note: String = "",
    val data: Map<String, String> = emptyMap(),
    val uploaded: Map<String, String> = emptyMap(),
    val uploadedTotal: Int = 0
)

@Serializable
data class StockAdjustment(
    val opening: Int = 0,
    val notNeeded: Int = 0
)
