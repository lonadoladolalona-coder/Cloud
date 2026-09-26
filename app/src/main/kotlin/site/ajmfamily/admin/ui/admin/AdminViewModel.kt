package site.ajmfamily.admin.ui.admin

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import site.ajmfamily.admin.core.logic.DuplicateInfo
import site.ajmfamily.admin.core.logic.dedupeByPhone
import site.ajmfamily.admin.core.logic.markDuplicates
import site.ajmfamily.admin.core.model.Meeting
import site.ajmfamily.admin.core.model.MeetingResult
import site.ajmfamily.admin.core.model.Registration
import site.ajmfamily.admin.core.model.RegistrationSource
import site.ajmfamily.admin.core.model.RegistrationStatus
import site.ajmfamily.admin.core.net.AjmApi
import site.ajmfamily.admin.core.net.ApiOutcome
import site.ajmfamily.admin.data.AppSession

const val FILTER_ALL = "all"
const val FILTER_DUPLICATES = "__duplicates"

enum class MeetingsState { UNKNOWN, OK, UNSUPPORTED, ERROR }

data class RegistrationStats(
    val totalActive: Int,
    val pending: Int,
    val contacted: Int,
    val confirmed: Int,
    val bySource: Map<String, Int>,
    val duplicates: Int
)

data class AdminUiState(
    val loading: Boolean = true,
    val error: String? = null,
    val rows: List<Registration> = emptyList(),
    val duplicateInfo: Map<Registration, DuplicateInfo> = emptyMap(),
    val filter: String = FILTER_ALL,
    val search: String = "",
    val sortField: String = "Timestamp",
    val sortDesc: Boolean = true,
    val selected: Set<String> = emptySet(),
    val meetings: List<Meeting> = emptyList(),
    val meetingsState: MeetingsState = MeetingsState.UNKNOWN,
    val busyIds: Set<String> = emptySet(),
    val toast: String? = null
) {
    val activeRows: List<Registration> get() = rows.filter { it.isActive }

    /** Rows already moved to History, grouped by the past-event name they were archived under. */
    val archivedGroups: Map<String, List<Registration>>
        get() = rows.filterNot { it.isActive }.groupBy { it.archive }

    val stats: RegistrationStats
        get() {
            val active = activeRows
            return RegistrationStats(
                totalActive = active.size,
                pending = active.count { it.status == RegistrationStatus.PENDING },
                contacted = active.count { it.status == RegistrationStatus.CONTACTED },
                confirmed = active.count { it.status == RegistrationStatus.CONFIRMED },
                bySource = RegistrationSource.ALL.associateWith { src -> active.count { it.source == src } },
                duplicates = duplicateInfo.values.count { it.isDuplicate }
            )
        }

    val visibleRows: List<Registration>
        get() {
            val q = search.trim().lowercase()
            var base = activeRows
            base = when (filter) {
                FILTER_ALL -> base
                FILTER_DUPLICATES -> base.filter { duplicateInfo[it]?.isDuplicate == true }
                else -> base.filter { it.source == filter }
            }
            if (q.isNotEmpty()) {
                base = base.filter { r ->
                    listOf(r.name, r.phone, r.email, r.details).any { it.lowercase().contains(q) }
                }
            }
            val sorted = base.sortedWith(compareBy { field(it, sortField) })
            return if (sortDesc) sorted.reversed() else sorted
        }

    private fun field(r: Registration, name: String): String = when (name) {
        "Name" -> r.name
        "Status" -> r.status
        "Source" -> r.source
        else -> r.timestamp
    }
}

class AdminViewModel(
    private val api: AjmApi,
    private val session: AppSession
) : ViewModel() {

    private val _state = MutableStateFlow(AdminUiState())
    val state: StateFlow<AdminUiState> = _state.asStateFlow()

    init {
        refresh()
    }

    private fun currentAuth(): Pair<String, String>? {
        val url = session.webAppUrl.value
        val key = session.adminKey.value
        return if (url.isNotBlank() && !key.isNullOrBlank()) url to key else null
    }

    fun refresh() {
        viewModelScope.launch {
            _state.value = _state.value.copy(loading = true, error = null)
            val auth = currentAuth()
            if (auth == null) {
                _state.value = _state.value.copy(loading = false, error = "Not signed in.")
                return@launch
            }
            val (url, key) = auth
            when (val result = api.listRegistrations(url, key)) {
                is ApiOutcome.Success -> {
                    val dupes = markDuplicates(result.data)
                    _state.value = _state.value.copy(loading = false, rows = result.data, duplicateInfo = dupes)
                }
                is ApiOutcome.Failure -> _state.value = _state.value.copy(loading = false, error = result.message)
            }
            loadMeetings()
        }
    }

    fun loadMeetings() {
        viewModelScope.launch {
            val auth = currentAuth() ?: return@launch
            val (url, key) = auth
            when (val result = api.listMeetings(url, key)) {
                is ApiOutcome.Success -> _state.value = _state.value.copy(meetings = result.data, meetingsState = MeetingsState.OK)
                is ApiOutcome.Failure -> {
                    val newState = if (result.message == "unsupported") MeetingsState.UNSUPPORTED else MeetingsState.ERROR
                    _state.value = _state.value.copy(meetingsState = newState)
                }
            }
        }
    }

    fun setFilter(filter: String) {
        _state.value = _state.value.copy(filter = filter, selected = emptySet())
    }

    fun setSearch(q: String) {
        _state.value = _state.value.copy(search = q)
    }

    fun setSort(field: String, desc: Boolean) {
        _state.value = _state.value.copy(sortField = field, sortDesc = desc)
    }

    fun toggleSelected(id: String) {
        val cur = _state.value.selected
        _state.value = _state.value.copy(selected = if (id in cur) cur - id else cur + id)
    }

    fun selectAllVisible() {
        _state.value = _state.value.copy(selected = _state.value.visibleRows.mapNotNull { it.id.ifBlank { null } }.toSet())
    }

    fun clearSelection() {
        _state.value = _state.value.copy(selected = emptySet())
    }

    fun setStatus(id: String, status: String) {
        viewModelScope.launch {
            val auth = currentAuth() ?: return@launch
            val (url, key) = auth
            _state.value = _state.value.copy(busyIds = _state.value.busyIds + id)
            when (val result = api.setStatus(url, key, id, status)) {
                is ApiOutcome.Success -> {
                    val updated = _state.value.rows.map { if (it.id == id) it.copy(status = status) else it }
                    _state.value = _state.value.copy(rows = updated, busyIds = _state.value.busyIds - id)
                }
                is ApiOutcome.Failure -> _state.value = _state.value.copy(
                    busyIds = _state.value.busyIds - id,
                    toast = "Could not update status: ${result.message}"
                )
            }
        }
    }

    fun deleteOne(id: String) {
        viewModelScope.launch {
            val auth = currentAuth() ?: return@launch
            val (url, key) = auth
            _state.value = _state.value.copy(busyIds = _state.value.busyIds + id)
            when (val result = api.deleteRegistration(url, key, id)) {
                is ApiOutcome.Success -> {
                    val updated = _state.value.rows.filterNot { it.id == id }
                    _state.value = _state.value.copy(rows = updated, busyIds = _state.value.busyIds - id, selected = _state.value.selected - id)
                }
                is ApiOutcome.Failure -> _state.value = _state.value.copy(
                    busyIds = _state.value.busyIds - id,
                    toast = "Could not delete: ${result.message}"
                )
            }
        }
    }

    fun bulkStatus(status: String) = runBulk({ url, key, ids -> api.bulkStatus(url, key, ids, status) }) { ids ->
        _state.value = _state.value.copy(rows = _state.value.rows.map { if (it.id in ids) it.copy(status = status) else it })
    }

    fun bulkDelete() = runBulk({ url, key, ids -> api.bulkDelete(url, key, ids) }) { ids ->
        _state.value = _state.value.copy(rows = _state.value.rows.filterNot { it.id in ids })
    }

    fun archiveSelected(eventName: String) = runBulk({ url, key, ids -> api.archive(url, key, ids, eventName) }) { ids ->
        _state.value = _state.value.copy(rows = _state.value.rows.map { if (it.id in ids) it.copy(archive = eventName) else it })
    }

    fun unarchiveSelected() = runBulk({ url, key, ids -> api.unarchive(url, key, ids) }) { ids ->
        _state.value = _state.value.copy(rows = _state.value.rows.map { if (it.id in ids) it.copy(archive = "") else it })
    }

    /** Restores a whole History group at once, independent of the current row-selection set. */
    fun unarchiveGroup(ids: List<String>) {
        viewModelScope.launch {
            val auth = currentAuth() ?: return@launch
            val (url, key) = auth
            when (val result = api.unarchive(url, key, ids)) {
                is ApiOutcome.Success -> _state.value = _state.value.copy(
                    rows = _state.value.rows.map { if (it.id in ids) it.copy(archive = "") else it },
                    toast = "Restored ${result.data} to the main list"
                )
                is ApiOutcome.Failure -> _state.value = _state.value.copy(toast = "Could not restore: ${result.message}")
            }
        }
    }

    private fun runBulk(
        call: suspend (String, String, List<String>) -> ApiOutcome<Int>,
        onSuccess: (Set<String>) -> Unit
    ) {
        viewModelScope.launch {
            val auth = currentAuth() ?: return@launch
            val (url, key) = auth
            val ids = _state.value.selected
            if (ids.isEmpty()) return@launch
            when (val result = call(url, key, ids.toList())) {
                is ApiOutcome.Success -> {
                    onSuccess(ids)
                    _state.value = _state.value.copy(selected = emptySet(), toast = "Updated ${result.data} of ${ids.size}")
                }
                is ApiOutcome.Failure -> _state.value = _state.value.copy(toast = "Bulk action failed: ${result.message}")
            }
        }
    }

    suspend fun markMeeting(meeting: String, result: String, person: Registration, message: String?): Meeting? {
        val auth = currentAuth() ?: return null
        val (url, key) = auth
        return when (val r = api.markMeeting(url, key, meeting, result, person.id, person.name, person.phone, message)) {
            is ApiOutcome.Success -> {
                val list = _state.value.meetings.toMutableList()
                val idx = list.indexOfFirst { it.id == r.data.id }
                if (idx >= 0) list[idx] = r.data else list.add(r.data)
                _state.value = _state.value.copy(meetings = list)
                r.data
            }
            is ApiOutcome.Failure -> null
        }
    }

    fun consumeToast() {
        _state.value = _state.value.copy(toast = null)
    }

    fun dedupedConfirmed(rows: List<Registration>): List<Registration> =
        dedupeByPhone(rows.filter { it.status == RegistrationStatus.CONFIRMED })
}
