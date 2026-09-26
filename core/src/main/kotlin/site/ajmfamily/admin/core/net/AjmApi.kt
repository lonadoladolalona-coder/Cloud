package site.ajmfamily.admin.core.net

import kotlinx.serialization.json.Json
import site.ajmfamily.admin.core.model.Meeting
import site.ajmfamily.admin.core.model.MediaChart
import site.ajmfamily.admin.core.model.MediaItem
import site.ajmfamily.admin.core.model.Registration
import site.ajmfamily.admin.core.model.StockAdjustment
import java.net.URLEncoder

sealed class ApiOutcome<out T> {
    data class Success<T>(val data: T) : ApiOutcome<T>()
    data class Failure(val message: String) : ApiOutcome<Nothing>()
}

inline fun <T, R> ApiOutcome<T>.map(transform: (T) -> R): ApiOutcome<R> = when (this) {
    is ApiOutcome.Success -> ApiOutcome.Success(transform(data))
    is ApiOutcome.Failure -> this
}

/**
 * Client for the AJM Family Apps Script Web App — the same backend
 * admin.html and media.html talk to. One method per `action`, matching
 * apps-script.gs exactly so this stays a drop-in replacement, not a
 * reinterpretation of the API.
 */
class AjmApi(
    private val http: HttpClient,
    private val json: Json = Json { ignoreUnknownKeys = true; isLenient = true }
) {
    companion object {
        /** Mirrors BULK_MAX_IDS in apps-script.gs — larger selections are sent in chunks. */
        const val BULK_MAX_IDS = 60
    }

    private fun enc(v: String) = URLEncoder.encode(v, "UTF-8")

    private fun buildUrl(baseUrl: String, params: Map<String, String>): String {
        val query = params.entries.joinToString("&") { (k, v) -> "${enc(k)}=${enc(v)}" }
        val sep = if (baseUrl.contains("?")) "&" else "?"
        return "$baseUrl$sep$query"
    }

    private suspend fun rawGet(baseUrl: String, params: Map<String, String>): String =
        http.get(buildUrl(baseUrl, params))

    // ---------------- Registrations (admin) ----------------

    suspend fun listRegistrations(baseUrl: String, adminKey: String): ApiOutcome<List<Registration>> =
        runCatching { rawGet(baseUrl, mapOf("key" to adminKey)) }
            .mapCatching { json.decodeFromString(RegistrationsResponse.serializer(), it) }
            .fold(
                onSuccess = { if (it.ok) ApiOutcome.Success(it.data) else ApiOutcome.Failure(it.error ?: "unauthorized") },
                onFailure = { ApiOutcome.Failure(it.message ?: "network error") }
            )

    suspend fun setStatus(baseUrl: String, adminKey: String, id: String, status: String): ApiOutcome<Unit> =
        simpleCall(baseUrl, mapOf("action" to "setStatus", "id" to id, "status" to status, "key" to adminKey))

    suspend fun deleteRegistration(baseUrl: String, adminKey: String, id: String): ApiOutcome<Unit> =
        simpleCall(baseUrl, mapOf("action" to "delete", "id" to id, "key" to adminKey))

    private suspend fun simpleCall(baseUrl: String, params: Map<String, String>): ApiOutcome<Unit> =
        runCatching { rawGet(baseUrl, params) }
            .mapCatching { json.decodeFromString(SimpleResponse.serializer(), it) }
            .fold(
                onSuccess = { if (it.ok) ApiOutcome.Success(Unit) else ApiOutcome.Failure(it.error ?: "request failed") },
                onFailure = { ApiOutcome.Failure(it.message ?: "network error") }
            )

    private suspend fun bulkOnce(
        baseUrl: String, adminKey: String, action: String, ids: List<String>, extra: Map<String, String>
    ): ApiOutcome<Int> {
        val params = mutableMapOf("action" to action, "ids" to ids.joinToString(","), "key" to adminKey)
        params.putAll(extra)
        return runCatching { rawGet(baseUrl, params) }
            .mapCatching { json.decodeFromString(UpdatedResponse.serializer(), it) }
            .fold(
                onSuccess = { if (it.ok) ApiOutcome.Success(it.updated) else ApiOutcome.Failure(it.error ?: "bulk action failed") },
                onFailure = { ApiOutcome.Failure(it.message ?: "network error") }
            )
    }

    /** Runs a bulk action in chunks of [BULK_MAX_IDS], summing how many rows were changed. */
    private suspend fun bulkChunked(
        baseUrl: String, adminKey: String, action: String, ids: List<String>, extra: Map<String, String> = emptyMap()
    ): ApiOutcome<Int> {
        if (ids.isEmpty()) return ApiOutcome.Success(0)
        var total = 0
        for (chunk in ids.chunked(BULK_MAX_IDS)) {
            when (val result = bulkOnce(baseUrl, adminKey, action, chunk, extra)) {
                is ApiOutcome.Success -> total += result.data
                is ApiOutcome.Failure -> return result
            }
        }
        return ApiOutcome.Success(total)
    }

    suspend fun bulkStatus(baseUrl: String, adminKey: String, ids: List<String>, status: String): ApiOutcome<Int> =
        bulkChunked(baseUrl, adminKey, "bulkStatus", ids, mapOf("status" to status))

    suspend fun bulkDelete(baseUrl: String, adminKey: String, ids: List<String>): ApiOutcome<Int> =
        bulkChunked(baseUrl, adminKey, "bulkDelete", ids)

    suspend fun archive(baseUrl: String, adminKey: String, ids: List<String>, eventName: String): ApiOutcome<Int> =
        bulkChunked(baseUrl, adminKey, "archive", ids, mapOf("name" to eventName))

    suspend fun unarchive(baseUrl: String, adminKey: String, ids: List<String>): ApiOutcome<Int> =
        bulkChunked(baseUrl, adminKey, "unarchive", ids)

    // ---------------- Meetings (Zoom-link send history) ----------------

    suspend fun listMeetings(baseUrl: String, adminKey: String): ApiOutcome<List<Meeting>> =
        runCatching { rawGet(baseUrl, mapOf("action" to "meetings", "key" to adminKey)) }
            .mapCatching { json.decodeFromString(MeetingsResponse.serializer(), it) }
            .fold(
                onSuccess = {
                    when {
                        it.error != null -> ApiOutcome.Failure(it.error)
                        it.meetings != null -> ApiOutcome.Success(it.meetings)
                        else -> ApiOutcome.Failure("unsupported")
                    }
                },
                onFailure = { ApiOutcome.Failure(it.message ?: "network error") }
            )

    suspend fun markMeeting(
        baseUrl: String,
        adminKey: String,
        meeting: String,
        result: String,
        id: String = "",
        name: String = "",
        phone: String = "",
        message: String? = null
    ): ApiOutcome<Meeting> {
        val params = mutableMapOf(
            "action" to "meetingMark", "key" to adminKey, "meeting" to meeting,
            "result" to result, "id" to id, "name" to name, "phone" to phone
        )
        if (message != null) params["message"] = message
        return runCatching { rawGet(baseUrl, params) }
            .mapCatching { json.decodeFromString(MeetingMarkResponse.serializer(), it) }
            .fold(
                onSuccess = { r -> if (r.ok && r.meeting != null) ApiOutcome.Success(r.meeting) else ApiOutcome.Failure(r.error ?: "not saved") },
                onFailure = { ApiOutcome.Failure(it.message ?: "network error") }
            )
    }

    // ---------------- Media office ----------------

    suspend fun mediaLogin(baseUrl: String, mediaKey: String): ApiOutcome<Int> =
        runCatching { rawGet(baseUrl, mapOf("action" to "mediaLogin", "key" to mediaKey)) }
            .mapCatching { json.decodeFromString(MediaLoginResponse.serializer(), it) }
            .fold(
                onSuccess = { if (it.ok) ApiOutcome.Success(it.version) else ApiOutcome.Failure(it.error ?: "unauthorized") },
                onFailure = { ApiOutcome.Failure(it.message ?: "network error") }
            )

    suspend fun mediaList(baseUrl: String, mediaKey: String): ApiOutcome<Pair<List<MediaChart>, Map<String, StockAdjustment>>> =
        runCatching { rawGet(baseUrl, mapOf("action" to "mediaList", "key" to mediaKey)) }
            .mapCatching { json.decodeFromString(MediaListResponse.serializer(), it) }
            .fold(
                onSuccess = { if (it.ok) ApiOutcome.Success(it.charts to it.stock) else ApiOutcome.Failure(it.error ?: "unauthorized") },
                onFailure = { ApiOutcome.Failure(it.message ?: "network error") }
            )

    suspend fun mediaGet(baseUrl: String, mediaKey: String, month: String): ApiOutcome<MediaChart?> =
        runCatching { rawGet(baseUrl, mapOf("action" to "mediaGet", "key" to mediaKey, "month" to month)) }
            .mapCatching { json.decodeFromString(MediaChartResponse.serializer(), it) }
            .fold(
                onSuccess = { if (it.ok) ApiOutcome.Success(it.chart) else ApiOutcome.Failure(it.error ?: "invalid month") },
                onFailure = { ApiOutcome.Failure(it.message ?: "network error") }
            )

    suspend fun mediaSave(
        baseUrl: String,
        mediaKey: String,
        month: String,
        changesJson: String? = null,
        upChangesJson: String? = null,
        note: String? = null,
        submit: Boolean? = null
    ): ApiOutcome<MediaChart> {
        val params = mutableMapOf("action" to "mediaSave", "key" to mediaKey, "month" to month)
        if (changesJson != null) params["changes"] = changesJson
        if (upChangesJson != null) params["upChanges"] = upChangesJson
        if (note != null) params["note"] = note
        if (submit != null) params["submit"] = if (submit) "1" else "0"
        return runCatching { rawGet(baseUrl, params) }
            .mapCatching { json.decodeFromString(MediaChartResponse.serializer(), it) }
            .fold(
                onSuccess = { if (it.ok && it.chart != null) ApiOutcome.Success(it.chart) else ApiOutcome.Failure(it.error ?: "save failed") },
                onFailure = { ApiOutcome.Failure(it.message ?: "network error") }
            )
    }

    suspend fun mediaStockSet(
        baseUrl: String, mediaKey: String, type: String, field: String, value: Int
    ): ApiOutcome<Map<String, StockAdjustment>> =
        runCatching {
            rawGet(baseUrl, mapOf("action" to "mediaStockSet", "key" to mediaKey, "type" to type, "field" to field, "value" to value.toString()))
        }
            .mapCatching { json.decodeFromString(MediaStockResponse.serializer(), it) }
            .fold(
                onSuccess = { if (it.ok) ApiOutcome.Success(it.stock) else ApiOutcome.Failure(it.error ?: "invalid stock value") },
                onFailure = { ApiOutcome.Failure(it.message ?: "network error") }
            )

    suspend fun mediaItems(baseUrl: String, mediaKey: String): ApiOutcome<List<MediaItem>> =
        runCatching { rawGet(baseUrl, mapOf("action" to "mediaItems", "key" to mediaKey)) }
            .mapCatching { json.decodeFromString(MediaItemsResponse.serializer(), it) }
            .fold(
                onSuccess = { if (it.ok) ApiOutcome.Success(it.items) else ApiOutcome.Failure(it.error ?: "unauthorized") },
                onFailure = { ApiOutcome.Failure(it.message ?: "network error") }
            )

    suspend fun mediaItemSave(
        baseUrl: String,
        mediaKey: String,
        id: String? = null,
        title: String? = null,
        type: String? = null,
        link: String? = null,
        status: String? = null,
        platform: String? = null
    ): ApiOutcome<MediaItem> {
        val params = mutableMapOf("action" to "mediaItemSave", "key" to mediaKey)
        if (id != null) params["id"] = id
        if (title != null) params["title"] = title
        if (type != null) params["type"] = type
        if (link != null) params["link"] = link
        if (status != null) params["status"] = status
        if (platform != null) params["platform"] = platform
        return runCatching { rawGet(baseUrl, params) }
            .mapCatching { json.decodeFromString(MediaItemResponse.serializer(), it) }
            .fold(
                onSuccess = { if (it.ok && it.item != null) ApiOutcome.Success(it.item) else ApiOutcome.Failure(it.error ?: "save failed") },
                onFailure = { ApiOutcome.Failure(it.message ?: "network error") }
            )
    }

    suspend fun mediaItemDelete(baseUrl: String, mediaKey: String, id: String): ApiOutcome<Unit> =
        simpleCall(baseUrl, mapOf("action" to "mediaItemDelete", "key" to mediaKey, "id" to id))
}
