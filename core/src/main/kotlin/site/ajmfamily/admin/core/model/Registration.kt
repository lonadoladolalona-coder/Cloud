package site.ajmfamily.admin.core.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * One row of the "Registrations" sheet. Field names match the sheet's own
 * headers (see HEADERS in apps-script.gs) so the JSON from the Apps Script
 * Web App decodes without any remapping.
 */
@Serializable
data class Registration(
    @SerialName("Timestamp") val timestamp: String = "",
    @SerialName("Source") val source: String = "",
    @SerialName("Name") val name: String = "",
    @SerialName("Phone") val phone: String = "",
    @SerialName("Email") val email: String = "",
    @SerialName("Details") val details: String = "",
    @SerialName("ID") val id: String = "",
    @SerialName("Status") val status: String = RegistrationStatus.PENDING,
    @SerialName("Archive") val archive: String = "",
    @SerialName("ArchivedAt") val archivedAt: String = ""
) {
    val isActive: Boolean get() = archive.isBlank()
}

object RegistrationStatus {
    const val PENDING = "Pending"
    const val CONTACTED = "Contacted"
    const val CONFIRMED = "Confirmed"
    val ALL = listOf(PENDING, CONTACTED, CONFIRMED)
}

object RegistrationSource {
    const val WOMENS_MEET = "Women's Meet"
    const val EVENT_BOOKING = "Event Booking"
    const val SPEAKING_INVITATION = "Speaking Invitation"
    val ALL = listOf(WOMENS_MEET, EVENT_BOOKING, SPEAKING_INVITATION)
}
