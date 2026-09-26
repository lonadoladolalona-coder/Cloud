package site.ajmfamily.admin.core.logic

import site.ajmfamily.admin.core.model.Registration
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class DedupeTest {

    @Test
    fun `phoneKey ignores formatting and keeps last 10 digits`() {
        assertEquals("9999999999", phoneKey("+91 99999 99999"))
        assertEquals("9999999999", phoneKey("(099999) 99999"))
    }

    @Test
    fun `phoneKey rejects numbers shorter than 8 digits`() {
        assertEquals("", phoneKey("12345"))
        assertEquals("", phoneKey(""))
    }

    @Test
    fun `markDuplicates flags rows sharing a phone number`() {
        val a = Registration(id = "1", name = "Asha", phone = "+91 99999 99999")
        val b = Registration(id = "2", name = "Asha K", phone = "9999999999")
        val c = Registration(id = "3", name = "Other", phone = "8888888888")
        val flags = markDuplicates(listOf(a, b, c))

        assertTrue(flags.getValue(a).isDuplicate)
        assertTrue(flags.getValue(b).isDuplicate)
        assertFalse(flags.getValue(c).isDuplicate)
    }

    @Test
    fun `markDuplicates never counts an archived row against active rows`() {
        val active = Registration(id = "1", name = "Asha", phone = "9999999999", archive = "")
        val archived = Registration(id = "2", name = "Asha (past event)", phone = "9999999999", archive = "Past Meet")
        val flags = markDuplicates(listOf(active, archived))

        assertFalse(flags.getValue(active).isDuplicate)
        assertFalse(flags.getValue(archived).isDuplicate)
    }

    @Test
    fun `dedupeByPhone keeps only the newest row per phone number`() {
        val older = Registration(id = "1", name = "Old", phone = "9999999999", timestamp = "2026-01-01T00:00:00.000Z")
        val newer = Registration(id = "2", name = "New", phone = "9999999999", timestamp = "2026-02-01T00:00:00.000Z")
        val result = dedupeByPhone(listOf(older, newer))

        assertEquals(1, result.size)
        assertEquals("New", result.first().name)
    }

    @Test
    fun `dedupeByPhone keeps every row with no usable phone number`() {
        val a = Registration(id = "1", name = "A", phone = "")
        val b = Registration(id = "2", name = "B", phone = "123")
        val result = dedupeByPhone(listOf(a, b))

        assertEquals(2, result.size)
    }
}
