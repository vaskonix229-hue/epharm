package kz.epharm.merchtasks.service

import com.fasterxml.jackson.databind.ObjectMapper
import io.micrometer.core.instrument.Counter
import io.micrometer.core.instrument.MeterRegistry
import java.net.URI
import kz.epharm.merchtasks.dto.MerchTaskDeliveryResult
import kz.epharm.merchtasks.dto.MerchTaskDto
import kz.epharm.merchtasks.dto.MerchTaskEnvelope
import kz.epharm.merchtasks.dto.MerchTaskShownRequest
import kz.epharm.shared.error.AppException
import kz.epharm.shared.error.ErrorCode
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.http.client.SimpleClientHttpRequestFactory
import org.springframework.stereotype.Component
import org.springframework.web.client.RestClient
import org.springframework.web.client.RestClientResponseException

/**
 * Protected server-to-server gateway from ePharm to the merchandising service.
 * The integration credential stays on the backend and is never returned to POSM clients.
 */
@Component
class MerchTaskClient(
    private val objectMapper: ObjectMapper,
    @Value("\${app.merch-tasks.enabled:false}") private val enabled: Boolean,
    @Value("\${app.merch-tasks.base-url:}") private val baseUrl: String,
    @Value("\${app.merch-tasks.integration-key:}") private val integrationKey: String,
    @Value("\${app.merch-tasks.timeout-ms:7000}") timeoutMs: Int,
    @Value("\${app.public-base-url:https://epharm.inkar.kz}") publicBaseUrl: String,
    meterRegistry: MeterRegistry,
) {
    private val log = LoggerFactory.getLogger(javaClass)
    private val requestTimeoutMs = timeoutMs.coerceIn(MIN_TIMEOUT_MS, MAX_TIMEOUT_MS)
    private val configured get() = baseUrl.isNotBlank() && integrationKey.isNotBlank() && trustedTransport(baseUrl)
    private val trustedPortal = URI.create(publicBaseUrl.trimEnd('/') + "/merch/")
    private val counters = mutableMapOf<Pair<String, String>, Counter>()
    private val registry = meterRegistry

    private val rest: RestClient by lazy {
        val factory = SimpleClientHttpRequestFactory().apply {
            setConnectTimeout(requestTimeoutMs)
            setReadTimeout(requestTimeoutMs)
        }
        RestClient.builder()
            .baseUrl(baseUrl.trimEnd('/'))
            .requestFactory(factory)
            .defaultHeader(INTEGRATION_HEADER, integrationKey)
            .build()
    }

    fun activeTask(pharmacyId: String): MerchTaskEnvelope {
        val normalizedPharmacyId = pharmacyId.trim()
        if (normalizedPharmacyId.isEmpty() ||
            normalizedPharmacyId.length > 128 ||
            !normalizedPharmacyId.matches(SAFE_PHARMACY_ID)
        ) {
            throw AppException(
                ErrorCode.VALIDATION_FAILED,
                "Некорректный идентификатор аптеки",
                HttpStatus.BAD_REQUEST,
            )
        }
        if (!enabled) return MerchTaskEnvelope()
        if (!configured) return MerchTaskEnvelope(available = false)
        return upstream("active", MerchTaskEnvelope(available = false)) {
            rest.get().uri { builder ->
                builder.path("/api/integrations/pharmapay/tasks/active")
                    .queryParam("pharmacyId", normalizedPharmacyId)
                    .build()
            }.retrieve().body(MerchTaskEnvelope::class.java)
                ?.also { response -> response.task?.let(::validateTask) }
                ?: MerchTaskEnvelope()
        }
    }

    fun markShown(payload: MerchTaskShownRequest): MerchTaskDeliveryResult {
        if (!enabled) return MerchTaskDeliveryResult()
        if (!configured) return MerchTaskDeliveryResult(available = false)
        return upstream("shown", MerchTaskDeliveryResult(available = false)) {
            // The fallback merchandising service uses Python's BaseHTTPRequestHandler, which
            // consumes bodies by Content-Length and does not decode HTTP chunked bodies. An
            // explicit byte array keeps this contract deterministic on both deployment targets.
            val body = objectMapper.writeValueAsBytes(payload)
            rest.post()
                .uri("/api/integrations/pharmapay/tasks/shown")
                .contentType(MediaType.APPLICATION_JSON)
                .body(body)
                .retrieve()
                .body(MerchTaskDeliveryResult::class.java)
                ?: MerchTaskDeliveryResult()
        }
    }

    private fun validateTask(task: MerchTaskDto) {
        require(task.id.length in 1..128 && task.id.matches(SAFE_ID)) { "invalid task id" }
        require(task.deliveryToken.length in 1..2048 && task.deliveryToken.matches(SAFE_TOKEN)) {
            "invalid delivery token"
        }
        require(task.title.length <= 512) { "task title is too long" }
        require(task.priority == null || task.priority.length <= 32) { "task priority is too long" }

        val publicUrl = URI.create(task.publicUrl)
        require(
            publicUrl.scheme.equals(trustedPortal.scheme, ignoreCase = true) &&
                publicUrl.host.equals(trustedPortal.host, ignoreCase = true) &&
                effectivePort(publicUrl) == effectivePort(trustedPortal) &&
                publicUrl.path.startsWith(trustedPortal.path),
        ) { "untrusted task public URL" }
    }

    private fun <T> upstream(operation: String, fallback: T, call: () -> T): T = try {
        call().also { counter(operation, "success").increment() }
    } catch (e: Exception) {
        counter(operation, "failure").increment()
        log.warn("Merchandising operation={} failed-open: {}", operation, failureSummary(e))
        log.debug("Merchandising failure details for operation={}", operation, e)
        fallback
    }

    private fun failureSummary(error: Exception): String = when (error) {
        is RestClientResponseException -> "HTTP ${error.statusCode.value()}"
        is IllegalArgumentException -> "invalid upstream payload"
        else -> error.javaClass.simpleName
    }

    private fun counter(operation: String, outcome: String): Counter = synchronized(counters) {
        counters.getOrPut(operation to outcome) {
            Counter.builder("epharm.merch.tasks.requests")
                .description("Calls from ePharm to the optional merchandising task service")
                .tag("operation", operation)
                .tag("outcome", outcome)
                .register(registry)
        }
    }

    private companion object {
        const val INTEGRATION_HEADER = "X-Pharmapay-Key"
        const val MIN_TIMEOUT_MS = 250
        const val MAX_TIMEOUT_MS = 30_000
        val SAFE_PHARMACY_ID = Regex("[0-9A-Za-z._:+@/-]+")
        val SAFE_ID = Regex("[0-9A-Za-z._:+@/-]+")
        val SAFE_TOKEN = Regex("[0-9A-Za-z._~+/=-]+")

        /** A server credential must never cross the public Internet over plain HTTP. */
        fun trustedTransport(rawBaseUrl: String): Boolean {
            return try {
                val uri = URI.create(rawBaseUrl)
                val host = uri.host ?: return false
                if (uri.userInfo != null || uri.rawQuery != null || uri.rawFragment != null ||
                    (uri.rawPath != null && uri.rawPath !in setOf("", "/"))
                ) return false
                when (uri.scheme?.lowercase()) {
                    "https" -> true
                    "http" -> host.equals("localhost", ignoreCase = true) ||
                        host == "127.0.0.1" || host == "[::1]" ||
                        host.split('.').mapNotNull { it.toIntOrNull() }.let { octets ->
                            octets.size == 4 && octets.all { it in 0..255 } &&
                                (octets[0] == 10 ||
                                    octets[0] == 172 && octets[1] in 16..31 ||
                                    octets[0] == 192 && octets[1] == 168)
                        }
                    else -> false
                }
            } catch (_: IllegalArgumentException) {
                false
            }
        }

        fun effectivePort(uri: URI): Int = when {
            uri.port >= 0 -> uri.port
            uri.scheme.equals("https", ignoreCase = true) -> 443
            else -> 80
        }
    }
}
