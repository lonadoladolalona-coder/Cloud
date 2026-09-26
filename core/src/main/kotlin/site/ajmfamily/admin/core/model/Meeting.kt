package site.ajmfamily.admin.core.model

import kotlinx.serialization.Serializable

object MeetingResult {
    const val SENT = "sent"
    const val SKIPPED = "skipped"
}

@Serializable
data class MeetingRecipient(
    val id: String = "",
    val name: String = "",
    val phone: String = "",
    val result: String = MeetingResult.SKIPPED,
    val at: String = ""
)

@Serializable
data class Meeting(
    val id: String = "",
    val name: String = "",
    val createdAt: String = "",
    val updatedAt: String = "",
    val message: String = "",
    val recipients: List<MeetingRecipient> = emptyList(),
    val sent: Int = 0,
    val skipped: Int = 0
)
