package site.ajmfamily.admin.core.net

import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Records every URL it was asked to GET and replays canned responses in order. */
private class FakeHttpClient(private val responses: MutableList<String>) : HttpClient {
    val requestedUrls = mutableListOf<String>()
    override suspend fun get(url: String): String {
        requestedUrls += url
        return responses.removeAt(0)
    }
}

class AjmApiTest {

    @Test
    fun `listRegistrations parses a successful response`() = runBlocking {
        val fake = FakeHttpClient(mutableListOf("""{"ok":true,"data":[{"ID":"1","Name":"Asha","Phone":"999","Status":"Pending"}]}"""))
        val api = AjmApi(fake)

        val result = api.listRegistrations("https://script.google.com/exec", "secret")

        assertTrue(result is ApiOutcome.Success)
        assertEquals(1, (result as ApiOutcome.Success).data.size)
        assertEquals("Asha", result.data.first().name)
        assertTrue(fake.requestedUrls.single().contains("key=secret"))
    }

    @Test
    fun `listRegistrations surfaces the server's error message`() = runBlocking {
        val fake = FakeHttpClient(mutableListOf("""{"error":"unauthorized"}"""))
        val api = AjmApi(fake)

        val result = api.listRegistrations("https://script.google.com/exec", "wrong-key")

        assertEquals(ApiOutcome.Failure("unauthorized"), result)
    }

    @Test
    fun `a malformed response is reported as a failure, not a crash`() = runBlocking {
        val fake = FakeHttpClient(mutableListOf("not json at all"))
        val api = AjmApi(fake)

        val result = api.listRegistrations("https://script.google.com/exec", "k")

        assertTrue(result is ApiOutcome.Failure)
    }

    @Test
    fun `setStatus builds the expected query string`() = runBlocking {
        val fake = FakeHttpClient(mutableListOf("""{"ok":true}"""))
        val api = AjmApi(fake)

        api.setStatus("https://script.google.com/exec", "secret", "row-1", "Confirmed")

        val url = fake.requestedUrls.single()
        assertTrue(url.contains("action=setStatus"))
        assertTrue(url.contains("id=row-1"))
        assertTrue(url.contains("status=Confirmed"))
        assertTrue(url.contains("key=secret"))
    }

    @Test
    fun `bulk actions are split into chunks of BULK_MAX_IDS and the updated counts are summed`() = runBlocking {
        val ids = (1..130).map { "id$it" } // 3 chunks: 60 + 60 + 10
        val fake = FakeHttpClient(mutableListOf("""{"ok":true,"updated":60}""", """{"ok":true,"updated":60}""", """{"ok":true,"updated":10}"""))
        val api = AjmApi(fake)

        val result = api.bulkDelete("https://script.google.com/exec", "secret", ids)

        assertEquals(ApiOutcome.Success(130), result)
        assertEquals(3, fake.requestedUrls.size)
    }

    @Test
    fun `a bulk chunk failure stops further chunks and is returned as-is`() = runBlocking {
        val ids = (1..130).map { "id$it" }
        val fake = FakeHttpClient(mutableListOf("""{"ok":true,"updated":60}""", """{"error":"too many ids"}"""))
        val api = AjmApi(fake)

        val result = api.bulkDelete("https://script.google.com/exec", "secret", ids)

        assertEquals(ApiOutcome.Failure("too many ids"), result)
        assertEquals(2, fake.requestedUrls.size) // never attempted the third chunk
    }

    @Test
    fun `an empty id list never makes a network call`() = runBlocking {
        val fake = FakeHttpClient(mutableListOf())
        val api = AjmApi(fake)

        val result = api.bulkStatus("https://script.google.com/exec", "secret", emptyList(), "Confirmed")

        assertEquals(ApiOutcome.Success(0), result)
        assertTrue(fake.requestedUrls.isEmpty())
    }

    @Test
    fun `query parameters are URL-encoded`() = runBlocking {
        val fake = FakeHttpClient(mutableListOf("""{"ok":true,"meeting":{"id":"m1","name":"Women's Meet"}}"""))
        val api = AjmApi(fake)

        api.markMeeting("https://script.google.com/exec", "secret", meeting = "Women's Meet — 28 Sep", result = "sent")

        assertTrue(fake.requestedUrls.single().contains("Women%27s+Meet"))
    }
}
