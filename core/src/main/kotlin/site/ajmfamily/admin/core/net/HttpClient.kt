package site.ajmfamily.admin.core.net

/**
 * Minimal transport abstraction so [AjmApi] has no dependency on any particular
 * HTTP library (and no Android dependency), which keeps this module plain-JVM
 * and unit-testable. The real implementation (OkHttp) lives in the app module.
 */
fun interface HttpClient {
    /** Performs a GET request and returns the response body. Throws on any transport error. */
    suspend fun get(url: String): String
}
