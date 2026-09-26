package site.ajmfamily.admin.ui.media

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import site.ajmfamily.admin.core.logic.MonthTotals
import site.ajmfamily.admin.core.logic.TypeStockSummary
import site.ajmfamily.admin.core.logic.applyCellChanges
import site.ajmfamily.admin.core.logic.summarizeByMonth
import site.ajmfamily.admin.core.logic.summarizeStock
import site.ajmfamily.admin.core.model.DEFAULT_CATEGORIES
import site.ajmfamily.admin.core.model.MediaChart
import site.ajmfamily.admin.core.model.MediaItem
import site.ajmfamily.admin.core.model.MediaItemStatus
import site.ajmfamily.admin.core.model.StockAdjustment
import site.ajmfamily.admin.core.net.AjmApi
import site.ajmfamily.admin.core.net.ApiOutcome
import site.ajmfamily.admin.data.AppSession
import java.time.LocalDate

const val CHART_VIEW_MADE = "made"
const val CHART_VIEW_UPLOADED = "up"

data class MediaUiState(
    val loading: Boolean = true,
    val error: String? = null,
    val charts: List<MediaChart> = emptyList(),
    val stock: Map<String, StockAdjustment> = emptyMap(),

    val items: List<MediaItem> = emptyList(),
    val itemsLoading: Boolean = true,
    val itemsError: String? = null,

    val year: Int = LocalDate.now().year,
    val month: Int = LocalDate.now().monthValue,
    val view: String = CHART_VIEW_MADE,

    val note: String = "",
    val noteDirty: Boolean = false,
    val pendingMade: Map<String, Map<Int, String>> = emptyMap(),
    val pendingUploaded: Map<String, Map<Int, String>> = emptyMap(),
    val saving: Boolean = false,
    val saveError: String? = null,

    val toast: String? = null
) {
    val monthKey: String get() = "%04d-%02d".format(year, month)

    val currentChart: MediaChart? get() = charts.find { it.month == monthKey }

    val categories: List<String>
        get() {
            val extra = (currentChart?.data?.keys.orEmpty() + currentChart?.uploaded?.keys.orEmpty())
                .filterNot { it in DEFAULT_CATEGORIES }
                .distinct()
            return DEFAULT_CATEGORIES + extra
        }

    val hasPending: Boolean get() = pendingMade.isNotEmpty() || pendingUploaded.isNotEmpty() || noteDirty

    /** The made/uploaded data for the active view, with any not-yet-saved edits layered on top. */
    fun displayedData(view: String = this.view): Map<String, String> {
        val base = if (view == CHART_VIEW_MADE) currentChart?.data.orEmpty() else currentChart?.uploaded.orEmpty()
        val pending = if (view == CHART_VIEW_MADE) pendingMade else pendingUploaded
        return applyCellChanges(base, pending)
    }

    val stockSummary: List<TypeStockSummary> get() = summarizeStock(DEFAULT_CATEGORIES, charts, stock)
    val monthTotals: List<MonthTotals> get() = summarizeByMonth(charts)
}

class MediaViewModel(
    private val api: AjmApi,
    private val session: AppSession
) : ViewModel() {

    private val _state = MutableStateFlow(MediaUiState())
    val state: StateFlow<MediaUiState> = _state.asStateFlow()

    init {
        refreshAll()
        loadItems()
    }

    private fun currentAuth(): Pair<String, String>? {
        val url = session.webAppUrl.value
        val key = session.mediaKey.value
        return if (url.isNotBlank() && !key.isNullOrBlank()) url to key else null
    }

    fun refreshAll() {
        viewModelScope.launch {
            _state.value = _state.value.copy(loading = true, error = null)
            val auth = currentAuth()
            if (auth == null) {
                _state.value = _state.value.copy(loading = false, error = "Not signed in.")
                return@launch
            }
            val (url, key) = auth
            when (val result = api.mediaList(url, key)) {
                is ApiOutcome.Success -> {
                    val (charts, stock) = result.data
                    _state.value = _state.value.copy(loading = false, charts = charts, stock = stock)
                }
                is ApiOutcome.Failure -> _state.value = _state.value.copy(loading = false, error = result.message)
            }
        }
    }

    /** Re-fetches only the open month, used for background polling — never clobbers unsaved edits. */
    fun refreshCurrentMonthSilently() {
        if (_state.value.hasPending) return
        viewModelScope.launch {
            val auth = currentAuth() ?: return@launch
            val (url, key) = auth
            val month = _state.value.monthKey
            when (val result = api.mediaGet(url, key, month)) {
                is ApiOutcome.Success -> {
                    val chart = result.data ?: return@launch
                    val others = _state.value.charts.filterNot { it.month == month }
                    _state.value = _state.value.copy(charts = others + chart, note = chart.note)
                }
                is ApiOutcome.Failure -> Unit
            }
        }
    }

    fun selectMonth(year: Int, month: Int) {
        _state.value = _state.value.copy(
            year = year, month = month,
            pendingMade = emptyMap(), pendingUploaded = emptyMap(),
            note = _state.value.charts.find { it.month == "%04d-%02d".format(year, month) }?.note.orEmpty(),
            noteDirty = false
        )
    }

    fun setView(view: String) {
        _state.value = _state.value.copy(view = view)
    }

    fun setCell(category: String, day: Int, token: String) {
        val cur = _state.value
        val target = if (cur.view == CHART_VIEW_MADE) cur.pendingMade else cur.pendingUploaded
        val updatedCategory = (target[category].orEmpty()) + (day to token)
        val updatedTarget = target + (category to updatedCategory)
        _state.value = if (cur.view == CHART_VIEW_MADE) cur.copy(pendingMade = updatedTarget) else cur.copy(pendingUploaded = updatedTarget)
    }

    fun setNote(note: String) {
        _state.value = _state.value.copy(note = note, noteDirty = true)
    }

    fun save(submit: Boolean? = null) {
        viewModelScope.launch {
            val auth = currentAuth() ?: return@launch
            val (url, key) = auth
            val cur = _state.value
            _state.value = cur.copy(saving = true, saveError = null)
            val changesJson = if (cur.pendingMade.isNotEmpty()) encodeChanges(cur.pendingMade) else null
            val upChangesJson = if (cur.pendingUploaded.isNotEmpty()) encodeChanges(cur.pendingUploaded) else null
            val noteArg = if (cur.noteDirty) cur.note else null
            when (val result = api.mediaSave(url, key, cur.monthKey, changesJson, upChangesJson, noteArg, submit)) {
                is ApiOutcome.Success -> {
                    val others = cur.charts.filterNot { it.month == cur.monthKey }
                    _state.value = _state.value.copy(
                        charts = others + result.data,
                        pendingMade = emptyMap(), pendingUploaded = emptyMap(),
                        noteDirty = false, saving = false
                    )
                }
                is ApiOutcome.Failure -> _state.value = _state.value.copy(saving = false, saveError = result.message)
            }
        }
    }

    private fun encodeChanges(changes: Map<String, Map<Int, String>>): String {
        val obj = buildJsonObject {
            changes.forEach { (cat, days) ->
                put(cat, JsonObject(days.entries.associate { (d, v) -> d.toString() to JsonPrimitive(v) }))
            }
        }
        return Json.encodeToString(JsonObject.serializer(), obj)
    }

    fun setStock(type: String, field: String, value: Int) {
        viewModelScope.launch {
            val auth = currentAuth() ?: return@launch
            val (url, key) = auth
            when (val result = api.mediaStockSet(url, key, type, field, value)) {
                is ApiOutcome.Success -> _state.value = _state.value.copy(stock = result.data)
                is ApiOutcome.Failure -> _state.value = _state.value.copy(toast = "Could not save: ${result.message}")
            }
        }
    }

    fun loadItems() {
        viewModelScope.launch {
            _state.value = _state.value.copy(itemsLoading = true, itemsError = null)
            val auth = currentAuth()
            if (auth == null) {
                _state.value = _state.value.copy(itemsLoading = false, itemsError = "Not signed in.")
                return@launch
            }
            val (url, key) = auth
            when (val result = api.mediaItems(url, key)) {
                is ApiOutcome.Success -> _state.value = _state.value.copy(itemsLoading = false, items = result.data)
                is ApiOutcome.Failure -> _state.value = _state.value.copy(itemsLoading = false, itemsError = result.message)
            }
        }
    }

    fun addItem(title: String, type: String, link: String) {
        viewModelScope.launch {
            val auth = currentAuth() ?: return@launch
            val (url, key) = auth
            when (val result = api.mediaItemSave(url, key, title = title, type = type, link = link)) {
                is ApiOutcome.Success -> _state.value = _state.value.copy(items = listOf(result.data) + _state.value.items)
                is ApiOutcome.Failure -> _state.value = _state.value.copy(toast = "Could not add: ${result.message}")
            }
        }
    }

    fun setItemStatus(item: MediaItem, status: String) {
        viewModelScope.launch {
            val auth = currentAuth() ?: return@launch
            val (url, key) = auth
            val platform = if (status != MediaItemStatus.UPLOADED) "" else item.platform
            when (val result = api.mediaItemSave(url, key, id = item.id, status = status, platform = platform)) {
                is ApiOutcome.Success -> replaceItem(result.data)
                is ApiOutcome.Failure -> _state.value = _state.value.copy(toast = "Could not update: ${result.message}")
            }
        }
    }

    fun setItemPlatform(item: MediaItem, platform: String) {
        viewModelScope.launch {
            val auth = currentAuth() ?: return@launch
            val (url, key) = auth
            when (val result = api.mediaItemSave(url, key, id = item.id, platform = platform)) {
                is ApiOutcome.Success -> replaceItem(result.data)
                is ApiOutcome.Failure -> _state.value = _state.value.copy(toast = "Could not update: ${result.message}")
            }
        }
    }

    fun deleteItem(id: String) {
        viewModelScope.launch {
            val auth = currentAuth() ?: return@launch
            val (url, key) = auth
            when (val result = api.mediaItemDelete(url, key, id)) {
                is ApiOutcome.Success -> _state.value = _state.value.copy(items = _state.value.items.filterNot { it.id == id })
                is ApiOutcome.Failure -> _state.value = _state.value.copy(toast = "Could not delete: ${result.message}")
            }
        }
    }

    private fun replaceItem(item: MediaItem) {
        _state.value = _state.value.copy(items = _state.value.items.map { if (it.id == item.id) item else it })
    }

    fun consumeToast() {
        _state.value = _state.value.copy(toast = null)
    }
}
