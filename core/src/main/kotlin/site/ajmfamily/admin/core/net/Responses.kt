package site.ajmfamily.admin.core.net

import kotlinx.serialization.Serializable
import site.ajmfamily.admin.core.model.Meeting
import site.ajmfamily.admin.core.model.MediaChart
import site.ajmfamily.admin.core.model.MediaItem
import site.ajmfamily.admin.core.model.Registration
import site.ajmfamily.admin.core.model.StockAdjustment

@Serializable
data class SimpleResponse(val ok: Boolean = false, val error: String? = null)

@Serializable
data class RegistrationsResponse(
    val ok: Boolean = false,
    val data: List<Registration> = emptyList(),
    val error: String? = null
)

@Serializable
data class UpdatedResponse(
    val ok: Boolean = false,
    val updated: Int = 0,
    val at: String = "",
    val error: String? = null
)

@Serializable
data class MeetingsResponse(
    val ok: Boolean = false,
    val meetings: List<Meeting>? = null,
    val error: String? = null
)

@Serializable
data class MeetingMarkResponse(
    val ok: Boolean = false,
    val meeting: Meeting? = null,
    val error: String? = null
)

@Serializable
data class MediaLoginResponse(
    val ok: Boolean = false,
    val version: Int = 0,
    val now: String = "",
    val error: String? = null
)

@Serializable
data class MediaListResponse(
    val ok: Boolean = false,
    val charts: List<MediaChart> = emptyList(),
    val stock: Map<String, StockAdjustment> = emptyMap(),
    val error: String? = null
)

@Serializable
data class MediaChartResponse(
    val ok: Boolean = false,
    val chart: MediaChart? = null,
    val error: String? = null
)

@Serializable
data class MediaStockResponse(
    val ok: Boolean = false,
    val stock: Map<String, StockAdjustment> = emptyMap(),
    val error: String? = null
)

@Serializable
data class MediaItemsResponse(
    val ok: Boolean = false,
    val items: List<MediaItem> = emptyList(),
    val error: String? = null
)

@Serializable
data class MediaItemResponse(
    val ok: Boolean = false,
    val item: MediaItem? = null,
    val error: String? = null
)
