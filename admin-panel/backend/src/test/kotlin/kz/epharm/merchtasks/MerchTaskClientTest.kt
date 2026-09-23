package kz.epharm.merchtasks

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import com.sun.net.httpserver.HttpServer
import io.micrometer.core.instrument.simple.SimpleMeterRegistry
import java.net.InetSocketAddress
import java.util.concurrent.atomic.AtomicReference
import kz.epharm.merchtasks.dto.MerchTaskShownRequest
import kz.epharm.merchtasks.service.MerchTaskClient
import kz.epharm.shared.error.AppException
import kz.epharm.shared.error.ErrorCode
import org.assertj.core.api.Assertions.assertThat
import org.assertj.core.api.Assertions.assertThatThrownBy
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Test

class MerchTaskClientTest {
    private var server: HttpServer? = null

    @AfterEach
    fun stopServer() {
        server?.stop(0)
    }

    @Test
    fun `gateway keeps integration key server-side and preserves the upstream contract`() {
        val seenMethod = AtomicReference<String>()
        val seenPath = AtomicReference<String>()
        val seenKey = AtomicReference<String>()
        val seenBody = AtomicReference<String>()
        val seenContentLength = AtomicReference<String>()
        val seenTransferEncoding = AtomicReference<String?>()
        server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0).apply {
            createContext("/") { exchange ->
                seenMethod.set(exchange.requestMethod)
                seenPath.set(exchange.requestURI.toString())
                seenKey.set(exchange.requestHeaders.getFirst("X-Pharmapay-Key"))
                seenContentLength.set(exchange.requestHeaders.getFirst("Content-Length"))
                seenTransferEncoding.set(exchange.requestHeaders.getFirst("Transfer-Encoding"))
                seenBody.set(exchange.requestBody.bufferedReader().readText())
                val body = if (exchange.requestMethod == "GET") {
                    """{"task":{"id":"dispatch-1","publicUrl":"https://epharm.inkar.kz/merch/staff","deliveryToken":"delivery-token"}}"""
                } else {
                    """{"accepted":true}"""
                }.toByteArray()
                exchange.responseHeaders.add("Content-Type", "application/json")
                exchange.sendResponseHeaders(200, body.size.toLong())
                exchange.responseBody.use { it.write(body) }
            }
            start()
        }
        val client = client(enabled = true, integrationKey = "server-secret")

        val active = client.activeTask(" pharmacy-7 ")

        assertThat(active.available).isTrue()
        assertThat(active.task?.id).isEqualTo("dispatch-1")
        assertThat(seenMethod.get()).isEqualTo("GET")
        assertThat(seenPath.get()).isEqualTo(
            "/api/integrations/pharmapay/tasks/active?pharmacyId=pharmacy-7",
        )
        assertThat(seenKey.get()).isEqualTo("server-secret")

        val shown = client.markShown(
            MerchTaskShownRequest(
                dispatchId = "dispatch-1",
                pharmacyId = "pharmacy-7",
                deviceId = "POS-02",
                deliveryToken = "delivery-token",
            ),
        )

        assertThat(shown.accepted).isTrue()
        assertThat(shown.available).isTrue()
        assertThat(seenMethod.get()).isEqualTo("POST")
        assertThat(seenPath.get()).isEqualTo("/api/integrations/pharmapay/tasks/shown")
        assertThat(seenKey.get()).isEqualTo("server-secret")
        assertThat(seenContentLength.get().toLong()).isGreaterThan(0)
        assertThat(seenTransferEncoding.get()).isNull()
        assertThat(seenBody.get()).contains(
            "\"dispatchId\":\"dispatch-1\"",
            "\"pharmacyId\":\"pharmacy-7\"",
            "\"deviceId\":\"POS-02\"",
            "\"deliveryToken\":\"delivery-token\"",
        )
    }

    @Test
    fun `disabled gateway stays quiet while incomplete configuration reports unavailable`() {
        val disabled = clientWithoutServer(enabled = false, baseUrl = "", integrationKey = "")
        val missingKey = clientWithoutServer(
            enabled = true,
            baseUrl = "http://127.0.0.1:1",
            integrationKey = "",
        )
        val receipt = MerchTaskShownRequest("dispatch-1", "pharmacy-7", "POS-02", "delivery-token")

        assertThat(disabled.activeTask("pharmacy-7").available).isTrue()
        assertThat(disabled.activeTask("pharmacy-7").task).isNull()
        assertThat(disabled.markShown(receipt).accepted).isFalse()
        assertThat(disabled.markShown(receipt).available).isTrue()
        assertThat(missingKey.activeTask("pharmacy-7").available).isFalse()
    }

    @Test
    fun `public HTTP upstream fails closed before sending the server key`() {
        val publicHttp = clientWithoutServer(
            enabled = true,
            baseUrl = "http://203.0.113.10:8080",
            integrationKey = "server-secret",
        )
        val receipt = MerchTaskShownRequest("dispatch-1", "pharmacy-7", "POS-02", "delivery-token")

        assertThat(publicHttp.activeTask("pharmacy-7").available).isFalse()
        assertThat(publicHttp.markShown(receipt).available).isFalse()
    }

    @Test
    fun `invalid pharmacy identifier is rejected before contacting upstream`() {
        val client = clientWithoutServer(enabled = false, baseUrl = "", integrationKey = "")

        assertThatThrownBy { client.activeTask("pharmacy\nspoof") }
            .isInstanceOf(AppException::class.java)
            .extracting("code")
            .isEqualTo(ErrorCode.VALIDATION_FAILED)
    }

    @Test
    fun `upstream failures fail open without returning a gateway error to POSM`() {
        server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0).apply {
            createContext("/") { exchange ->
                exchange.sendResponseHeaders(503, -1)
                exchange.close()
            }
            start()
        }
        val client = client(enabled = true, integrationKey = "server-secret")

        val result = client.activeTask("pharmacy-7")

        assertThat(result.available).isFalse()
        assertThat(result.task).isNull()
    }

    @Test
    fun `untrusted public task link is rejected without exposing an upstream failure`() {
        server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0).apply {
            createContext("/") { exchange ->
                val body = """{"task":{"id":"dispatch-1","publicUrl":"https://evil.example/merch/staff","deliveryToken":"token-1"}}"""
                    .toByteArray()
                exchange.responseHeaders.add("Content-Type", "application/json")
                exchange.sendResponseHeaders(200, body.size.toLong())
                exchange.responseBody.use { it.write(body) }
            }
            start()
        }

        val result = client(enabled = true, integrationKey = "server-secret").activeTask("pharmacy-7")

        assertThat(result.available).isFalse()
        assertThat(result.task).isNull()
    }

    private fun client(enabled: Boolean, integrationKey: String): MerchTaskClient {
        val port = requireNotNull(server).address.port
        return MerchTaskClient(
            objectMapper = jacksonObjectMapper(),
            enabled = enabled,
            baseUrl = "http://127.0.0.1:$port",
            integrationKey = integrationKey,
            timeoutMs = 1_000,
            publicBaseUrl = "https://epharm.inkar.kz",
            meterRegistry = SimpleMeterRegistry(),
        )
    }

    private fun clientWithoutServer(
        enabled: Boolean,
        baseUrl: String,
        integrationKey: String,
    ) = MerchTaskClient(
        objectMapper = jacksonObjectMapper(),
        enabled = enabled,
        baseUrl = baseUrl,
        integrationKey = integrationKey,
        timeoutMs = 1_000,
        publicBaseUrl = "https://epharm.inkar.kz",
        meterRegistry = SimpleMeterRegistry(),
    )
}
