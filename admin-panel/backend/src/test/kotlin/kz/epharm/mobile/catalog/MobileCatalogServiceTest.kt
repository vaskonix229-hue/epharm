package kz.epharm.mobile.catalog

import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import kz.epharm.medusa.MedusaCatalogCache
import kz.epharm.medusa.MedusaCatalogSnapshotRepository
import kz.epharm.medusa.client.MedusaClient
import kz.epharm.medusa.dto.MedusaCategory
import kz.epharm.medusa.dto.MedusaProduct
import kz.epharm.medusa.dto.MedusaProductListResponse
import kz.epharm.mobile.catalog.service.MobileCatalogService
import kz.epharm.promo.entity.PromoEntity
import kz.epharm.promo.entity.PromoStatus
import kz.epharm.promo.entity.PromoTier
import kz.epharm.promo.repository.PromoRepository
import kz.epharm.rules.entity.RuleEntity
import kz.epharm.rules.entity.RuleStatus
import kz.epharm.rules.entity.RuleTrigger
import kz.epharm.rules.entity.RuleType
import kz.epharm.rules.repository.RuleRepository
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * Юнит-тест контракта рекомендаций/бонусов мобильного каталога (п.1/п.2/п.7):
 *  - группировка рекомендаций (alternative / crosssell_with_campaign / crosssell_no_campaign);
 *  - поля активной кампании в карточке товара (hasActiveCampaign/promoId/campaignTitle/bonus)
 *    с гейтом bonus по includeIncentive.
 * Клиент/репозитории замоканы (mockk), кэш выключен (ttl=0) — ни сети, ни БД.
 *
 * Базовый маппинг Medusa→DTO и ИБ-гейт bonus/script в рекомендациях покрыты в
 * kz.epharm.medusa.MobileCatalogServiceTest — здесь только новый контракт групп/кампаний.
 */
class MobileCatalogServiceTest {

    private val medusa = mockk<MedusaClient>()
    private val promoRepo = mockk<PromoRepository>(relaxed = true).also {
        every { it.findAllByMedusaProductId(any()) } returns emptyList()
        every { it.findAllByStatusRawAndMedusaProductIdIsNotNullOrderByUpdatedAtDesc(any()) } returns emptyList()
    }
    private val ruleRepo = mockk<RuleRepository>(relaxed = true).also {
        every { it.findAllByStatusRawOrderByUpdatedAtDesc(any()) } returns emptyList()
    }
    private val snapshot = mockk<MedusaCatalogSnapshotRepository>(relaxed = true).also {
        every { it.hasCompleteSnapshot() } returns false
    }
    private val service = MobileCatalogService(medusa, MedusaCatalogCache(0), promoRepo, ruleRepo, snapshot)

    private fun stubList(vararg products: MedusaProduct) {
        every { medusa.listProducts(any(), any(), any(), any(), any()) } returns
            MedusaProductListResponse(products = products.toList(), count = products.size, limit = 24, offset = 0)
    }

    private fun rule(id: String, recommend: String, type: RuleType, bonus: Int, trigger: String) =
        RuleEntity(
            id = id, recommend = recommend, bonus = bonus, script = "pitch",
            trigger = RuleTrigger(kind = "product", value = trigger),
        ).also { it.type = type; it.status = RuleStatus.active }

    private fun activePromo(id: String, productId: String, bonus: Long) =
        PromoEntity(id = id, title = "Акция $id", productName = "Снимок").also {
            it.status = PromoStatus.active
            it.medusaProductId = productId
            it.tiers = listOf(PromoTier(1, 500, 0), PromoTier(10, 600, bonus))
        }

    // ── Полная деградация Medusa на PostgreSQL-снимок ───────────────────────

    @Test
    fun `category search uses complete snapshot without Medusa`() {
        every { snapshot.hasCompleteSnapshot() } returns true
        every { snapshot.search(null, "pcat_cold", 24, 0) } returns
            MedusaCatalogSnapshotRepository.Page(
                products = listOf(MedusaProduct(id = "P", title = "Ибуфен")),
                total = 1,
            )

        val page = service.search(q = null, category = "pcat_cold", limit = 24, offset = 0)

        assertEquals(1, page.total)
        assertEquals("P", page.items.single().id)
        verify(exactly = 0) { medusa.listProducts(any(), any(), any(), any(), any()) }
    }

    @Test
    fun `detail uses complete snapshot without Medusa`() {
        every { snapshot.hasCompleteSnapshot() } returns true
        every { snapshot.findById("prod_snapshot") } returns
            MedusaProduct(id = "prod_snapshot", title = "Карточка из снимка")

        val detail = service.detail("prod_snapshot")

        assertEquals("Карточка из снимка", detail.name)
        verify(exactly = 0) { medusa.getProduct(any()) }
    }

    @Test
    fun `categories use complete snapshot without Medusa`() {
        every { snapshot.hasCompleteSnapshot() } returns true
        every { snapshot.categories() } returns listOf(
            MedusaCategory(id = "pcat_cold", name = "Простуда", handle = "cold"),
        )

        val categories = service.categories()

        assertEquals(1, categories.size)
        assertEquals("pcat_cold", categories.single().id)
        verify(exactly = 0) { medusa.listCategories() }
    }

    @Test
    fun `recommendations resolve cards from complete snapshot without Medusa`() {
        every { ruleRepo.findAllByStatusRawOrderByUpdatedAtDesc(RuleStatus.active.name) } returns
            listOf(rule("c_snapshot", recommend = "B", type = RuleType.crosssell, bonus = 80, trigger = "X"))
        every { snapshot.hasCompleteSnapshot() } returns true
        every { snapshot.findByIds(listOf("B")) } returns
            listOf(MedusaProduct(id = "B", title = "Товар B"))

        val recommendations = service.recommendations("X", includeIncentive = true)

        assertEquals("B", recommendations.crosssells.single().product.id)
        verify(exactly = 0) { medusa.listProducts(any(), any(), any(), any(), any()) }
    }

    // ── Группировка рекомендаций (п.1/п.7) ───────────────────────────────────

    @Test
    fun `crosssell с активной кампанией компаньона → group crosssell_with_campaign + hasActiveCampaign true`() {
        // Триггер X → кросс-селл компаньона B; у B есть СВОЯ активная кампания.
        every { ruleRepo.findAllByStatusRawOrderByUpdatedAtDesc(RuleStatus.active.name) } returns
            listOf(rule("c1", recommend = "B", type = RuleType.crosssell, bonus = 80, trigger = "X"))
        every { promoRepo.findAllByStatusRawAndMedusaProductIdIsNotNullOrderByUpdatedAtDesc(PromoStatus.active.name) } returns
            listOf(activePromo("pr_b", productId = "B", bonus = 900))
        stubList(MedusaProduct(id = "B", title = "Товар B", variants = emptyList()))

        val rec = service.recommendations("X", includeIncentive = true)
        assertEquals(1, rec.crosssells.size)
        val c = rec.crosssells[0]
        assertEquals("B", c.product.id)
        assertTrue(c.hasActiveCampaign)
        assertEquals("crosssell_with_campaign", c.group)
        assertTrue(rec.alternatives.isEmpty())
    }

    @Test
    fun `crosssell без кампании компаньона → group crosssell_no_campaign + hasActiveCampaign false (товар всё равно показан)`() {
        // Триггер X → кросс-селл компаньона C; у C НЕТ своей кампании (пустой список активных).
        every { ruleRepo.findAllByStatusRawOrderByUpdatedAtDesc(RuleStatus.active.name) } returns
            listOf(rule("c1", recommend = "C", type = RuleType.crosssell, bonus = 80, trigger = "X"))
        // promoRepo.findAllByStatusRaw…  → emptyList() (дефолт мока)
        stubList(MedusaProduct(id = "C", title = "Товар C", variants = emptyList()))

        val rec = service.recommendations("X", includeIncentive = true)
        assertEquals(1, rec.crosssells.size) // показан, несмотря на отсутствие кампании
        val c = rec.crosssells[0]
        assertEquals("C", c.product.id)
        assertFalse(c.hasActiveCampaign)
        assertEquals("crosssell_no_campaign", c.group)
    }

    @Test
    fun `substitution → group alternative + hasActiveCampaign false (даже если у товара есть кампания)`() {
        // Триггер X → замена Y; даже если Y значится в активных кампаниях, для замены group=alternative.
        every { ruleRepo.findAllByStatusRawOrderByUpdatedAtDesc(RuleStatus.active.name) } returns
            listOf(rule("s1", recommend = "Y", type = RuleType.substitution, bonus = 500, trigger = "X"))
        every { promoRepo.findAllByStatusRawAndMedusaProductIdIsNotNullOrderByUpdatedAtDesc(PromoStatus.active.name) } returns
            listOf(activePromo("pr_y", productId = "Y", bonus = 700))
        stubList(MedusaProduct(id = "Y", title = "Товар Y", variants = emptyList()))

        val rec = service.recommendations("X", includeIncentive = true)
        assertEquals(1, rec.alternatives.size)
        val a = rec.alternatives[0]
        assertEquals("Y", a.product.id)
        assertFalse(a.hasActiveCampaign) // замены не зависят от кампании компаньона
        assertEquals("alternative", a.group)
        assertTrue(rec.crosssells.isEmpty())
    }

    @Test
    fun `товар-рекомендация в substitution И crosssell → только в alternatives (дедуп, замена приоритетнее)`() {
        // Ревью-баг #4: триггер X рекомендует один и тот же товар D и как замену, и как
        // кросс-селл → раньше D висел в ОБЕИХ секциях. Теперь замена приоритетнее (как
        // RulesEngineService.survivors у POSM), в «Допродать» D не дублируется.
        every { ruleRepo.findAllByStatusRawOrderByUpdatedAtDesc(RuleStatus.active.name) } returns listOf(
            rule("s1", recommend = "D", type = RuleType.substitution, bonus = 500, trigger = "X"),
            rule("c1", recommend = "D", type = RuleType.crosssell, bonus = 80, trigger = "X"),
        )
        stubList(MedusaProduct(id = "D", title = "Товар D", variants = emptyList()))

        val rec = service.recommendations("X", includeIncentive = true)
        assertEquals(1, rec.alternatives.size)
        assertEquals("D", rec.alternatives[0].product.id)
        assertTrue(rec.crosssells.isEmpty()) // дедуп: не дублируется в допродаже
    }

    @Test
    fun `обратное направление — карточка ПРОДВИГАЕМОГО товара показывает товар-триггер как замену и кросс-селл`() {
        // Кампания продвигает Y: правило замены (выбрали X → рекомендуем Y) и кросс-селл (выбрали A → Y).
        // Открыли САМ продвигаемый Y → должны увидеть X в «Аналоги» и A в «Сопутствующие» —
        // инфо-карточки без бонуса (бонус только когда продают сам продвигаемый Y, а это уже его карточка).
        // Раньше recommendations("Y") был пуст (Y нигде не триггер) — отсюда «акция без разделов».
        every { ruleRepo.findAllByStatusRawOrderByUpdatedAtDesc(RuleStatus.active.name) } returns listOf(
            rule("s1", recommend = "Y", type = RuleType.substitution, bonus = 500, trigger = "X"),
            rule("c1", recommend = "Y", type = RuleType.crosssell, bonus = 80, trigger = "A"),
        )
        stubList(
            MedusaProduct(id = "X", title = "Товар X", variants = emptyList()),
            MedusaProduct(id = "A", title = "Товар A", variants = emptyList()),
        )

        val rec = service.recommendations("Y", includeIncentive = true)
        assertEquals(1, rec.alternatives.size)
        assertEquals("X", rec.alternatives[0].product.id)
        assertEquals("alternative", rec.alternatives[0].group)
        assertNull(rec.alternatives[0].bonus) // обратная сторона → без бонуса

        assertEquals(1, rec.crosssells.size)
        assertEquals("A", rec.crosssells[0].product.id)
        assertEquals("crosssell_no_campaign", rec.crosssells[0].group)
        assertNull(rec.crosssells[0].bonus)
    }

    // ── Поля активной кампании в карточке (п.2) ──────────────────────────────

    @Test
    fun `detail с активной кампанией и includeIncentive=true → bonus и поля кампании заполнены`() {
        every { medusa.getProduct("prod_lifta") } returns
            MedusaProduct(id = "prod_lifta", title = "Лифта 10мг", variants = emptyList())
        every { promoRepo.findAllByMedusaProductId("prod_lifta") } returns
            listOf(activePromo("pr_lifta", productId = "prod_lifta", bonus = 900))

        val d = service.detail("prod_lifta", includeIncentive = true)
        assertTrue(d.hasActiveCampaign)
        assertEquals("pr_lifta", d.promoId)
        assertEquals("Акция pr_lifta", d.campaignTitle)
        assertEquals(900, d.bonus) // pharmacistBonus = maxOf{tiers.bonus}
    }

    @Test
    fun `detail с активной кампанией и includeIncentive=false → bonus скрыт, hasActiveCampaign корректен`() {
        every { medusa.getProduct("prod_lifta") } returns
            MedusaProduct(id = "prod_lifta", title = "Лифта 10мг", variants = emptyList())
        every { promoRepo.findAllByMedusaProductId("prod_lifta") } returns
            listOf(activePromo("pr_lifta", productId = "prod_lifta", bonus = 900))

        val d = service.detail("prod_lifta", includeIncentive = false)
        assertTrue(d.hasActiveCampaign)      // флаг/id/title видны всем
        assertEquals("pr_lifta", d.promoId)
        assertEquals("Акция pr_lifta", d.campaignTitle)
        assertNull(d.bonus)                  // bonus — только авторизованному
    }

    @Test
    fun `detail без активной кампании → флаги пустые, bonus null даже фармацевту`() {
        every { medusa.getProduct("prod_plain") } returns
            MedusaProduct(id = "prod_plain", title = "Без акции", variants = emptyList())
        // promoRepo.findAllByMedusaProductId → emptyList() (дефолт мока)

        val d = service.detail("prod_plain", includeIncentive = true)
        assertFalse(d.hasActiveCampaign)
        assertNull(d.promoId)
        assertNull(d.campaignTitle)
        assertNull(d.bonus)
    }

    @Test
    fun `detail с неактивной (paused) кампанией → не считается активной`() {
        every { medusa.getProduct("prod_paused") } returns
            MedusaProduct(id = "prod_paused", title = "Пауза", variants = emptyList())
        val paused = activePromo("pr_paused", productId = "prod_paused", bonus = 900)
            .also { it.status = PromoStatus.paused }
        every { promoRepo.findAllByMedusaProductId("prod_paused") } returns listOf(paused)

        val d = service.detail("prod_paused", includeIncentive = true)
        assertFalse(d.hasActiveCampaign)
        assertNull(d.promoId)
        assertNull(d.bonus)
    }

    @Test
    fun `detail без faq в metadata → fallback Q&A из полей товара (рецептурность, МНН, производитель)`() {
        // У Medusa-товаров нет metadata.faq → раньше qa=[] и выдвижная Q&A-секция в мобилке пропадала.
        // Теперь fallback из реальных полей: рецептурность + действующее вещество + производитель.
        every { medusa.getProduct("prod_q") } returns MedusaProduct(
            id = "prod_q", title = "Цетрин 10мг", variants = emptyList(),
            metadata = mapOf(
                "rx_otc" to "OTC", "mnn" to "Цетиризин", "atc" to "R06AE07",
                "manufacturer" to "Dr.Reddy`s", "country" to "Индия",
            ),
        )

        val d = service.detail("prod_q", includeIncentive = false)
        assertEquals(3, d.qa.size)
        assertTrue(d.qa.any { it.q.contains("рецепт", ignoreCase = true) && it.a.contains("безрецептурный") })
        assertTrue(d.qa.any { it.a.contains("Цетиризин") && it.a.contains("R06AE07") })
        assertTrue(d.qa.any { it.a.contains("Dr.Reddy`s") && it.a.contains("Индия") })
    }
}
