package kz.epharm.medusa

import kz.epharm.auth.domain.AdminRole
import kz.epharm.auth.domain.AdminUserStatus
import kz.epharm.auth.entity.AdminUserEntity
import kz.epharm.auth.repository.AdminUserRepository
import kz.epharm.auth.service.JwtService
import kz.epharm.medusa.dto.MedusaCategory
import kz.epharm.medusa.dto.MedusaProduct
import kz.epharm.medusa.dto.MedusaVariant
import kz.epharm.pharmacists.entity.PharmacistEntity
import kz.epharm.pharmacists.entity.PharmacistStatus
import kz.epharm.pharmacists.repository.PharmacistRepository
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.security.crypto.password.PasswordEncoder
import org.springframework.test.context.ActiveProfiles
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import org.springframework.transaction.annotation.Transactional
import java.util.UUID
import org.testcontainers.containers.PostgreSQLContainer
import org.testcontainers.junit.jupiter.Container
import org.testcontainers.junit.jupiter.Testcontainers

/**
 * Витрина каталога в админке (`/api/admin/storefront/products`). Только под admin-JWT.
 * В тест-профиле Medusa выключен → пустая страница (деградация без 5xx). Доступ
 * фармацевта запрещён (admin-only).
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Testcontainers
@Transactional
class AdminStorefrontIntegrationTest {

    companion object {
        @Container
        @JvmStatic
        val postgres: PostgreSQLContainer<*> = PostgreSQLContainer("postgres:16-alpine")
            .withDatabaseName("epharm_test").withUsername("epharm").withPassword("epharm_test")
            .apply { start() }

        @JvmStatic
        @DynamicPropertySource
        fun props(reg: DynamicPropertyRegistry) {
            reg.add("spring.datasource.url") { postgres.jdbcUrl }
            reg.add("spring.datasource.username") { postgres.username }
            reg.add("spring.datasource.password") { postgres.password }
        }
    }

    @Autowired private lateinit var mockMvc: MockMvc
    @Autowired private lateinit var jwtService: JwtService
    @Autowired private lateinit var adminUserRepository: AdminUserRepository
    @Autowired private lateinit var pharmacistRepository: PharmacistRepository
    @Autowired private lateinit var passwordEncoder: PasswordEncoder
    @Autowired private lateinit var snapshot: MedusaCatalogSnapshotRepository

    private lateinit var adminToken: String
    private lateinit var pharmacistToken: String

    @BeforeEach
    fun seed() {
        adminUserRepository.deleteAll()
        pharmacistRepository.deleteAll()

        val admin = adminUserRepository.save(
            AdminUserEntity(email = "hq@inkar.kz", passwordHash = passwordEncoder.encode("x"),
                name = "HQ", company = "Inkar")
                .also { it.role = AdminRole.HQ_HEAD; it.status = AdminUserStatus.ACTIVE },
        )
        adminToken = "Bearer " + jwtService.issueAccessToken(admin)

        val rx = pharmacistRepository.save(
            PharmacistEntity(id = "u_rx", name = "Фарм", iin = "850615400016", phone = "+77005556677")
                .also { it.status = PharmacistStatus.active },
        )
        pharmacistToken = "Bearer " + jwtService.issuePharmacistToken(rx.id, rx.name, rx.phone)
    }

    @Test
    fun `админ видит витрину — 200 и пустая страница при выключенном Medusa`() {
        mockMvc.perform(get("/api/admin/storefront/products").header("Authorization", adminToken))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.total").value(0))
            .andExpect(jsonPath("$.items.length()").value(0))
    }

    @Test
    fun `поиск каталога и промо-пикера обслуживается из локального снимка без Medusa`() {
        val syncId = UUID.randomUUID()
        snapshot.beginSync()
        snapshot.upsertPage(
            listOf(
                MedusaProduct(
                    id = "prod_ibufen",
                    title = "Ибуфен суспензия для детей",
                    metadata = mapOf("brand_name" to "Polpharma", "mnn" to "Ибупрофен"),
                    categories = listOf(MedusaCategory(id = "pcat_cold", name = "Простуда")),
                    variants = listOf(MedusaVariant(id = "var_1", barcode = "5903060613907")),
                ),
                MedusaProduct(
                    id = "prod_vitamin",
                    title = "Витамин C 1000 мг",
                    metadata = mapOf("brand_name" to "Now Foods"),
                ),
            ),
            offset = 0,
            syncId = syncId,
        )
        snapshot.completeSync(syncId, expectedCount = 2)

        mockMvc.perform(
            get("/api/admin/storefront/products")
                .header("Authorization", adminToken)
                .param("q", "ибуфен")
                .param("limit", "50"),
        )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.total").value(1))
            .andExpect(jsonPath("$.items.length()").value(1))
            .andExpect(jsonPath("$.items[0].id").value("prod_ibufen"))
            .andExpect(jsonPath("$.items[0].brand").value("Polpharma"))

        // Тот же endpoint используется в PromoProductPicker; ищутся также МНН и EAN.
        mockMvc.perform(
            get("/api/admin/storefront/products")
                .header("Authorization", adminToken)
                .param("q", "5903060613907"),
        )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.total").value(1))
            .andExpect(jsonPath("$.items[0].name").value("Ибуфен суспензия для детей"))

        // Mobile category browsing, category directory and product detail must use
        // the same durable snapshot instead of requiring a live Medusa request.
        mockMvc.perform(
            get("/api/mobile/catalog/products")
                .param("category", "pcat_cold"),
        )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.total").value(1))
            .andExpect(jsonPath("$.items[0].id").value("prod_ibufen"))

        mockMvc.perform(get("/api/mobile/catalog/categories"))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$[0].id").value("pcat_cold"))
            .andExpect(jsonPath("$[0].name").value("Простуда"))

        mockMvc.perform(get("/api/mobile/catalog/products/prod_ibufen"))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.id").value("prod_ibufen"))
            .andExpect(jsonPath("$.name").value("Ибуфен суспензия для детей"))

        mockMvc.perform(get("/api/mobile/catalog/recommendation-pools"))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.alternatives.length()").value(0))
            .andExpect(jsonPath("$.crosssells.length()").value(0))
    }

    @Test
    fun `витрина без токена → 401`() {
        mockMvc.perform(get("/api/admin/storefront/products")).andExpect(status().isUnauthorized)
    }

    @Test
    fun `витрина по токену фармацевта → 403 (admin-only)`() {
        // Аутентифицирован, но роль PHARMACIST не имеет доступа к /api/admin/** →
        // 403 Forbidden (а не 401 — это не «не залогинен»). Закрывает эскалацию привилегий.
        mockMvc.perform(get("/api/admin/storefront/products").header("Authorization", pharmacistToken))
            .andExpect(status().isForbidden)
    }
}
