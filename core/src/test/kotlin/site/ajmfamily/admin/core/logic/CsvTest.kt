package site.ajmfamily.admin.core.logic

import site.ajmfamily.admin.core.model.Registration
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class CsvTest {

    @Test
    fun `registrationsToCsv writes a header row plus one row per registration`() {
        val rows = listOf(
            Registration(timestamp = "2026-01-01T00:00:00.000Z", source = "Event Booking", name = "Asha", phone = "+91 99999 99999", email = "a@x.com", details = "", status = "Pending")
        )
        val csv = registrationsToCsv(rows)
        val lines = csv.split("\n")

        assertEquals("Timestamp,Source,Name,Phone,Email,Details,Status", lines[0])
        assertTrue(lines[1].contains("\"Asha\""))
        assertTrue(lines[1].contains("\"+91 99999 99999\""))
    }

    @Test
    fun `registrationsToCsv guards formula-like text but leaves phone numbers alone`() {
        val rows = listOf(Registration(name = "=cmd()", phone = "+919999999999"))
        val csv = registrationsToCsv(rows)

        assertTrue(csv.contains("\"'=cmd()\""), "name starting with = should get a leading apostrophe")
        assertTrue(csv.contains("\"+919999999999\""), "phone column must never be prefixed")
    }

    @Test
    fun `registrationsToCsv escapes embedded quotes`() {
        val rows = listOf(Registration(name = "Say \"hi\""))
        val csv = registrationsToCsv(rows)

        assertTrue(csv.contains("\"Say \"\"hi\"\"\""))
    }
}
