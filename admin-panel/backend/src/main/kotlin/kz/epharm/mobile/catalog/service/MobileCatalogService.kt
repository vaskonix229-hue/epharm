package kz.epharm.mobile.catalog.service

import kz.epharm.medusa.MedusaCatalogCache
import kz.epharm.medusa.MedusaCatalogSnapshotRepository
import kz.epharm.medusa.client.MedusaClient
import kz.epharm.medusa.dto.MedusaProduct
import kz.epharm.medusa.dto.MedusaRetailPriceSummary
import kz.epharm.medusa.dto.toRetailPriceSummary
import kz.epharm.mobile.catalog.dto.MobileCatalogDetailDto
import kz.epharm.mobile.catalog.dto.MobileCatalogMarketplaceLinkDto
import kz.epharm.mobile.catalog.dto.MobileCatalogPageDto
import kz.epharm.mobile.catalog.dto.MobileCatalogProductDto
import kz.epharm.mobile.catalog.dto.MobileCatalogQaDto
import kz.epharm.mobile.catalog.dto.MobileCategoryDto
import kz.epharm.mobile.catalog.dto.MobileRecommendationDto
import kz.epharm.mobile.catalog.dto.MobileRecommendationPoolsDto
import kz.epharm.mobile.catalog.dto.MobileRecommendationsDto
import kz.epharm.promo.entity.PromoStatus
import kz.epharm.promo.repository.PromoRepository
import kz.epharm.rules.entity.RuleEntity
import kz.epharm.rules.entity.RuleStatus
import kz.epharm.rules.entity.RuleType
import kz.epharm.rules.repository.RuleRepository
import kz.epharm.shared.error.AppException
import kz.epharm.shared.error.ErrorCode
import kz.epharm.shared.validation.BarcodeNormalizer
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import java.util.concurrent.CompletableFuture
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.math.roundToInt

/**
 * Каталог для мобильного приложения: тянет товары из Medusa-витрины через [MedusaClient],
 * нормализует в наши DTO и кеширует ([MedusaCatalogCache]).
 *
 * Главная сложность — РЕАЛЬНЫЕ данные неполные: цена/фото/категории часто пусты,
 * но есть богатый `metadata`. Маппинг построен на цепочках fallback (бренд из metadata,
 * категория из metadata, штрихкод из варианта или metadata) — чтобы карточка всегда
 * выглядела осмысленно по мере наполнения PIM.
 */
@Service
class MobileCatalogService(
    private val medusa: MedusaClient,
    private val cache: MedusaCatalogCache,
    private val promoRepository: PromoRepository,
    private val ruleRepository: RuleRepository,
    private val snapshot: MedusaCatalogSnapshotRepository? = null,
) {
    private val retailPriceExecutor = Executors.newFixedThreadPool(RETAIL_PRICE_WORKERS) { runnable ->
        Thread(runnable, "medusa-retail-price").apply { isDaemon = true }
    }

    fun search(
        q: String?,
        category: String?,
        limit: Int,
        offset: Int,
        includeRetailFallbackPrices: Boolean = false,
    ): MobileCatalogPageDto {
        val safeLimit = limit.coerceIn(1, MAX_LIMIT)
        val safeOffset = offset.coerceAtLeast(0)
        val key = "list|q=${q?.trim()?.lowercase().orEmpty()}|cat=${category.orEmpty()}|l=$safeLimit|o=$safeOffset|retail=$includeRetailFallbackPrices"
        return cache.get(key) {
            // Search/list is served from a complete PostgreSQL snapshot whenever one
            // exists.  This avoids Medusa's slow remote `q` path and keeps the picker
            // available during storefront outages.  Before the first successful crawl
            // we retain the direct call so a fresh installation still works immediately.
            // Category ids are stored in the snapshot as well, so every list/search
            // variant remains available during a complete storefront outage.
            val local = snapshot?.takeIf { it.hasCompleteSnapshot() }
                ?.search(q = q, categoryId = category, limit = safeLimit, offset = safeOffset)
            val products: List<MedusaProduct>
            val total: Int
            if (local != null) {
                products = local.products
                total = local.total
            } else {
                val remote = medusa.listProducts(
                    q = q,
                    categoryId = category,
                    ids = null,
                    limit = safeLimit,
                    offset = safeOffset,
                )
                products = remote.products
                total = remote.count
            }
            MobileCatalogPageDto(
                items = cards(products, includeRetailFallbackPrices),
                total = total,
                limit = safeLimit,
                offset = safeOffset,
            )
        }
    }

    /**
     * Карточка товара. Поля Medusa мемоизируются в кеше; КАМПАНИЙНЫЕ поля
     * (hasActiveCampaign/promoId/campaignTitle/bonus) вычисляются ВНЕ cache.get — иначе
     * смена статуса кампании «залипла» бы в кеше до истечения TTL.
     *
     * [includeIncentive]=false (аноним) → bonus скрыт (коммерческая тайна), но
     * hasActiveCampaign/promoId/campaignTitle корректны для всех.
     */
    fun detail(
        id: String,
        includeIncentive: Boolean = false,
        includeRetailFallbackPrices: Boolean = false,
    ): MobileCatalogDetailDto {
        val base = cache.get("detail|$id|retail=$includeRetailFallbackPrices") {
            // A complete snapshot is the authoritative read model.  Falling back
            // to the live storefront only before the first successful crawl keeps
            // product details available while Medusa is down.
            val local = snapshot?.takeIf { it.hasCompleteSnapshot() }
            val p = (if (local != null) local.findById(id) else medusa.getProduct(id))
                ?: throw AppException(ErrorCode.NOT_FOUND, "Товар не найден", HttpStatus.NOT_FOUND)
            val detail = withRetailPriceFallback(
                detailOf(p),
                if (includeRetailFallbackPrices) retailPriceOf(p.id) else null,
            )
            applyPromoOverride(id, detail)
        }
        return applyCampaign(id, base, includeIncentive)
    }

    /**
     * Накладывает поля активной кампании товара (вне кеша). Активная = PromoEntity со
     * статусом active на этом medusaProductId. bonus отдаём только авторизованному
     * фармацевту ([includeIncentive]) — анониму null. Нет активной → всё null/false.
     */
    private fun applyCampaign(
        medusaProductId: String,
        base: MobileCatalogDetailDto,
        includeIncentive: Boolean,
    ): MobileCatalogDetailDto {
        val promo = promoRepository.findAllByMedusaProductId(medusaProductId)
            .firstOrNull { it.status == PromoStatus.active }
            ?: return base
        return base.copy(
            hasActiveCampaign = true,
            promoId = promo.id,
            campaignTitle = promo.title,
            bonus = if (includeIncentive) promo.pharmacistBonus.toInt().takeIf { it > 0 } else null,
        )
    }

    /**
     * Накладывает ручные override-поля кампании (T1): если на этот товар есть акция с
     * override-фото/описанием — показываем их вместо данных Medusa. «Заменить на своё
     * в крайнем случае», когда PIM-данные не устраивают.
     */
    private fun applyPromoOverride(medusaProductId: String, base: MobileCatalogDetailDto): MobileCatalogDetailDto {
        val promo = promoRepository.findAllByMedusaProductId(medusaProductId)
            .firstOrNull {
                it.overrideImage != null || it.overrideDescription != null ||
                    it.overrideCharacteristics != null
            }
            ?: return base
        // Свои характеристики (по строке) заменяют keyFacts из Medusa, если заданы.
        val keyFacts = promo.overrideCharacteristics
            ?.lines()?.map { it.trim() }?.filter { it.isNotEmpty() }
            ?.takeIf { it.isNotEmpty() }
            ?: base.keyFacts
        return base.copy(
            imageUrl = promo.overrideImage ?: base.imageUrl,
            images = promo.overrideImage?.let { listOf(it) } ?: base.images,
            description = promo.overrideDescription ?: base.description,
            keyFacts = keyFacts,
        )
    }

    fun categories(): List<MobileCategoryDto> = cache.get("categories") {
        val local = snapshot?.takeIf { it.hasCompleteSnapshot() }
        val categories = if (local != null) local.categories() else medusa.listCategories().productCategories
        categories.map {
            MobileCategoryDto(id = it.id, name = it.name, handle = it.handle, parentId = it.parentCategoryId)
        }
    }

    /**
     * Карточки витрины по списку Medusa-id (для джойна промо-лента ↔ каталог).
     * Возвращает map id→карточка; отсутствующие/недоступные id в map не попадают.
     * Переиспользует [card] (включая фильтр плейсхолдеров «-») и кеш.
     */
    fun cardsByIds(ids: List<String>): Map<String, MobileCatalogProductDto> {
        val clean = ids.mapNotNull { it.trim().takeIf { s -> s.isNotBlank() } }.distinct()
        if (clean.isEmpty()) return emptyMap()
        return cache.get("cards|" + clean.sorted().joinToString(",")) {
            val local = snapshot?.takeIf { it.hasCompleteSnapshot() }
            val products = if (local != null) {
                local.findByIds(clean)
            } else {
                // Medusa отдаёт максимум `limit` товаров — при >MAX_LIMIT id бьём на чанки и
                // сливаем, иначе часть привязанных к промо товаров потерялась бы из выдачи.
                clean.chunked(MAX_LIMIT)
                    .flatMap { chunk -> medusa.listProducts(ids = chunk, limit = chunk.size).products }
            }
            products
                .associate { it.id to card(it) }
        }
    }

    // ── Рекомендации к товару (ДОП.3b) ────────────────────────────────────────

    /**
     * «Альтернативы» (замены) и «Дополнения» (кросс-селл) для товара карточки — из тех же активных
     * правил активных кампаний, что и у POSM-кассы. Матчинг ДВУНАПРАВЛЕННЫЙ: связь видна и когда
     * товар — триггер правила (→ показываем продвигаемый recommend, с бонусом/кликом), и когда товар
     * сам ПРОДВИГАЕМЫЙ recommend (→ показываем товар(ы)-триггер как инфо-карточки). Иначе карточка
     * самой акции (продвигаемый товар) не показывала бы свои замены/кросс-селл.
     * Партнёры резолвятся к карточкам витрины ([cardsByIds]); недоступные пропускаем.
     * Пусто (нет правил) → обе секции пустые, мобилка их не рисует.
     */
    fun recommendations(productId: String, includeIncentive: Boolean): MobileRecommendationsDto {
        val active = activeRules()
        // Собираем партнёров товара по ОБОИМ направлениям правила:
        //  1) этот товар = ТРИГГЕР  → партнёр = recommend (продвигаемый): бонус/клик доступны;
        //  2) этот товар = RECOMMEND (сам продвигаемый) → партнёр(ы) = триггер(ы): инфо-карточка.
        // Иначе связь видна ТОЛЬКО на исходном товаре, а на самой карточке акции (продвигаемый
        // товар = recommend) разделов нет — что и ломало ожидание. Теперь видно с обеих сторон.
        val subPartners = LinkedHashMap<String, Partner>()
        val crossPartners = LinkedHashMap<String, Partner>()
        for (r in active) {
            val map = when (r.type) {
                RuleType.substitution -> subPartners
                RuleType.crosssell -> crossPartners
                else -> continue
            }
            if (r.recommend != productId && triggerMatches(r, productId)) {
                map.putIfAbsent(r.recommend, Partner(r.recommend, r, promoted = true))
            }
            if (r.recommend == productId) {
                for (tp in triggerProductIds(r)) {
                    if (tp != productId) map.putIfAbsent(tp, Partner(tp, r, promoted = false))
                }
            }
        }
        // Дедуп: товар уже в «Альтернативы» (замена) → не дублируем в «Допродать» (замена приоритетнее).
        crossPartners.keys.removeAll(subPartners.keys)
        val ids = (subPartners.keys + crossPartners.keys).toList()
        if (ids.isEmpty()) return MobileRecommendationsDto(emptyList(), emptyList())
        val cards = cardsByIds(ids)
        // Какие из товаров-компаньонов имеют СВОЮ активную кампанию (для группировки кросс-селла).
        val activeIds = activeCampaignProductIds()
        return MobileRecommendationsDto(
            alternatives = toRecommendations(subPartners.values, cards, includeIncentive, activeIds),
            crosssells = toRecommendations(crossPartners.values, cards, includeIncentive, activeIds),
        )
    }

    /** Партнёр товара в правиле + само правило (для бонуса/скрипта) и сторона (промо или нет). */
    private data class Partner(val productId: String, val rule: RuleEntity, val promoted: Boolean)

    /** Товар(ы)-триггер(ы) правила: product → [value]; product_any → список; mnn/прочее → пусто. */
    private fun triggerProductIds(rule: RuleEntity): List<String> = when (rule.trigger.kind) {
        "product" -> listOfNotNull(rule.trigger.value as? String)
        "product_any" -> (rule.trigger.value as? List<*>)?.mapNotNull { it as? String } ?: emptyList()
        else -> emptyList()
    }

    /**
     * Medusa-id товаров, на которых есть активная кампания (PromoEntity со статусом active).
     * Используется для группировки рекомендаций: компаньон кросс-селла без своей кампании
     * показывается, но мобилка делает его некликабельным.
     */
    private fun activeCampaignProductIds(): Set<String> =
        promoRepository.findAllByStatusRawAndMedusaProductIdIsNotNullOrderByUpdatedAtDesc(PromoStatus.active.name)
            .mapNotNull { it.medusaProductId }
            .toSet()

    /**
     * Глобальные пулы для ленты каталога (пилюли «Альтернативы»/«Дополнения»): весь
     * ассортимент продвигаемых замен и допов, не привязанный к товару карточки.
     *  - alternatives — distinct recommend активных substitution-правил;
     *  - crosssells   — distinct recommend активных crosssell-правил.
     * Резолвятся к карточкам витрины ([cardsByIds]); недоступные id пропускаем. Порядок —
     * как у правил (свежие кампании раньше: findAllByStatusRaw…OrderByUpdatedAtDesc).
     */
    fun recommendationPools(): MobileRecommendationPoolsDto {
        val active = activeRules()
        val altIds = active.filter { it.type == RuleType.substitution }.map { it.recommend }.distinct()
        val crossIds = active.filter { it.type == RuleType.crosssell }.map { it.recommend }.distinct()
        if (altIds.isEmpty() && crossIds.isEmpty()) {
            return MobileRecommendationPoolsDto(emptyList(), emptyList())
        }
        val cards = cardsByIds(altIds + crossIds)
        return MobileRecommendationPoolsDto(
            alternatives = altIds.mapNotNull { cards[it] },
            crosssells = crossIds.mapNotNull { cards[it] },
        )
    }

    /**
     * Активные правила, гейтнутые статусом кампании (мастер-выключатель) — копия логики
     * RulesEngineService: правило из неактивной кампании не показываем, legacy без promoId проходят.
     */
    private fun activeRules(): List<RuleEntity> {
        val activeRules = ruleRepository.findAllByStatusRawOrderByUpdatedAtDesc(RuleStatus.active.name)
        val promoIds = activeRules.mapNotNull { it.promoId }.toSet()
        val activePromoIds =
            if (promoIds.isEmpty()) emptySet()
            else promoRepository.findAllById(promoIds)
                .filter { it.status == PromoStatus.active }
                .map { it.id }
                .toSet()
        return activeRules.filter { it.promoId == null || it.promoId in activePromoIds }
    }

    /** Триггер правила указывает на этот товар? (mnn-триггеры пропускаем — нужен mnn товара, редкий legacy.) */
    private fun triggerMatches(rule: RuleEntity, productId: String): Boolean = when (rule.trigger.kind) {
        "product" -> (rule.trigger.value as? String) == productId
        "product_any" -> (rule.trigger.value as? List<*>)?.any { it == productId } == true
        else -> false
    }

    /**
     * Правила → рекомендации: сортировка по бонусу (выше — раньше), дедуп по товару, резолв карточки.
     * [includeIncentive]=false (аноним) → bonus/note скрыты (видны только товары-рекомендации).
     *
     * Группировка (п.1/п.7): substitution → group="alternative", hasActiveCampaign=false (продвигаемый
     * товар — это сам recommend кампании-триггера, отдельная кампания у него не требуется). crosssell →
     * hasActiveCampaign = recommend ∈ [activeCampaignIds]; group = "crosssell_with_campaign" /
     * "crosssell_no_campaign". Компаньон без своей кампании остаётся в выдаче (мобилка его не кликает).
     */
    private fun toRecommendations(
        partners: Collection<Partner>,
        cards: Map<String, MobileCatalogProductDto>,
        includeIncentive: Boolean,
        activeCampaignIds: Set<String>,
    ): List<MobileRecommendationDto> =
        partners.sortedByDescending { it.rule.bonus }
            .mapNotNull { partner ->
                val card = cards[partner.productId] ?: return@mapNotNull null
                val r = partner.rule
                val isCross = r.type == RuleType.crosssell
                // Бонус/скрипт — только когда партнёр это ПРОДВИГАЕМЫЙ recommend (его продажа даёт
                // бонус). Для обратной стороны (партнёр = триггер) это инфо-карточка без бонуса.
                val showIncentive = includeIncentive && partner.promoted
                val hasActiveCampaign = isCross && partner.productId in activeCampaignIds
                MobileRecommendationDto(
                    product = card,
                    note = if (showIncentive) r.script.trim().takeIf { it.isNotBlank() } else null,
                    bonus = if (showIncentive) r.bonus.takeIf { it > 0 } else null,
                    hasActiveCampaign = hasActiveCampaign,
                    group = when {
                        !isCross -> "alternative"
                        hasActiveCampaign -> "crosssell_with_campaign"
                        else -> "crosssell_no_campaign"
                    },
                )
    }

    // ── маппинг Medusa → mobile ───────────────────────────────────────────────

    private fun cards(products: List<MedusaProduct>, includeRetailFallbackPrices: Boolean): List<MobileCatalogProductDto> {
        val base = products.map { card(it) }
        if (!includeRetailFallbackPrices || base.none { it.price == null }) return base

        val missingIds = base.asSequence()
            .filter { it.price == null }
            .map { it.id }
            .distinct()
            .take(MAX_RETAIL_PRICE_FALLBACKS)
            .toList()
        if (missingIds.isEmpty()) return base

        val futures = missingIds.associateWith { id ->
            CompletableFuture
                .supplyAsync({ retailPriceOf(id) }, retailPriceExecutor)
                .orTimeout(RETAIL_PRICE_TIMEOUT_MS, TimeUnit.MILLISECONDS)
        }
        try {
            CompletableFuture.allOf(*futures.values.toTypedArray())
                .get(RETAIL_PRICE_TIMEOUT_MS + 750L, TimeUnit.MILLISECONDS)
        } catch (_: Exception) {
            // Частичная деградация допустима: каталог не должен падать из-за ценового fallback.
        }

        val byId = futures.mapNotNull { (id, future) ->
            if (!future.isDone || future.isCompletedExceptionally) null
            else future.getNow(null)?.let { id to it }
        }.toMap()
        return base.map { withRetailPriceFallback(it, byId[it.id]) }
    }

    private fun card(p: MedusaProduct) = MobileCatalogProductDto(
        id = p.id,
        name = nameOf(p),
        brand = brandOf(p),
        mnn = metaStr(p, "mnn"),
        rxOtc = metaStr(p, "rx_otc"),
        price = priceOf(p),
        currency = currencyOf(p),
        imageUrl = imageOf(p),
        barcode = barcodeOf(p),
        category = categoryOf(p),
        categories = categoriesOf(p),
    )

    private fun detailOf(p: MedusaProduct) = MobileCatalogDetailDto(
        id = p.id,
        name = nameOf(p),
        brand = brandOf(p),
        mnn = metaStr(p, "mnn"),
        atc = metaStr(p, "atc"),
        rxOtc = metaStr(p, "rx_otc"),
        price = priceOf(p),
        currency = currencyOf(p),
        imageUrl = imageOf(p),
        images = siteImages(p),
        barcode = barcodeOf(p),
        category = categoryOf(p),
        country = metaStr(p, "country_official") ?: metaStr(p, "country"),
        manufacturer = metaStr(p, "manufacturer_official") ?: metaStr(p, "manufacturer"),
        description = p.description?.trim()?.takeIf { it.isNotBlank() }
            ?: p.subtitle?.trim()?.takeIf { it.isNotBlank() },
        keyFacts = metaStrList(p, "key_facts"),
        marketplaceLinks = marketplaceLinks(p),
        qa = faqList(p),
    )

    private fun retailPriceOf(productId: String): MedusaRetailPriceSummary? =
        medusa.getProductPharmacies(productId)?.toRetailPriceSummary()

    private fun withRetailPriceFallback(
        card: MobileCatalogProductDto,
        retail: MedusaRetailPriceSummary?,
    ): MobileCatalogProductDto {
        if (retail == null || card.price != null) return card
        return card.copy(
            price = retail.price,
            currency = retail.currency,
            priceMin = retail.min,
            priceMax = retail.max,
            pharmacyPriceCount = retail.pharmacyCount.takeIf { it > 0 },
        )
    }

    private fun withRetailPriceFallback(
        detail: MobileCatalogDetailDto,
        retail: MedusaRetailPriceSummary?,
    ): MobileCatalogDetailDto {
        if (retail == null || detail.price != null) return detail
        return detail.copy(
            price = retail.price,
            currency = retail.currency,
            priceMin = retail.min,
            priceMax = retail.max,
            pharmacyPriceCount = retail.pharmacyCount.takeIf { it > 0 },
        )
    }

    private fun nameOf(p: MedusaProduct): String =
        p.title?.trim()?.takeIf { it.isNotBlank() }
            ?: metaStr(p, "full_title")
            ?: "Без названия"

    /** Цепочка из STOREFRONT.md: brand_name ?? brand_raw ?? corporation ?? manufacturer. */
    private fun brandOf(p: MedusaProduct): String? =
        metaStr(p, "brand_name")
            ?: metaStr(p, "brand_raw")
            ?: metaStr(p, "corporation")
            ?: metaStr(p, "manufacturer")

    private fun categoryOf(p: MedusaProduct): String? =
        p.categories.firstOrNull { it.name.isNotBlank() }?.name
            ?: metaStr(p, "category")

    /**
     * Все категории товара (имена) — для клиентского фильтра в ленте каталога.
     * Возвращаем как есть (включая структурную «Сайт»); фильтрацию шумовых категорий
     * делает UI. distinct — у товара бывают дубли-предки.
     */
    private fun categoriesOf(p: MedusaProduct): List<String> =
        p.categories
            .mapNotNull { it.name.trim().takeIf { n -> n.isNotBlank() } }
            .distinct()

    private fun priceOf(p: MedusaProduct): Int? =
        p.variants.firstNotNullOfOrNull { it.calculatedPrice?.calculatedAmount }?.roundToInt()

    private fun currencyOf(p: MedusaProduct): String =
        p.variants.firstNotNullOfOrNull { it.calculatedPrice?.currencyCode }?.uppercase() ?: "KZT"

    private fun barcodeOf(p: MedusaProduct): String? =
        p.variants.firstNotNullOfOrNull { BarcodeNormalizer.first(it.barcode) }
            ?: BarcodeNormalizer.first(metaStr(p, "barcode"))

    private fun imageOf(p: MedusaProduct): String? =
        p.thumbnail?.trim()?.takeIf { it.isNotBlank() }
            ?: siteImages(p).firstOrNull()

    /** Картинки витрины (исключаем gallery=marketplace — это фото для маркетплейсов). */
    private fun siteImages(p: MedusaProduct): List<String> =
        p.images
            .filter { (it.metadata?.get("gallery") as? String) != "marketplace" }
            .mapNotNull { it.url?.trim()?.takeIf { u -> u.isNotBlank() } }

    /** Строка из metadata, отбрасывая плейсхолдеры «поле не заполнено» (см. [META_PLACEHOLDERS]). */
    private fun metaStr(p: MedusaProduct, key: String): String? {
        val s = (p.metadata?.get(key) as? String)?.trim() ?: return null
        return s.takeUnless { it.isBlank() || it.lowercase() in META_PLACEHOLDERS }
    }

    private fun metaStrList(p: MedusaProduct, key: String): List<String> =
        (p.metadata?.get(key) as? List<*>)
            ?.mapNotNull { it?.toString()?.trim()?.takeIf { s -> s.isNotBlank() } }
            ?: emptyList()

    private fun marketplaceLinks(p: MedusaProduct): List<MobileCatalogMarketplaceLinkDto> =
        (p.metadata?.get("marketplace_links") as? List<*>)
            ?.mapNotNull { it as? Map<*, *> }
            ?.mapNotNull { m ->
                val platform = (m["platform"] as? String)?.trim()?.takeIf { it.isNotBlank() } ?: return@mapNotNull null
                MobileCatalogMarketplaceLinkDto(
                    platform = platform,
                    url = (m["url"] as? String)?.trim()?.takeIf { it.isNotBlank() },
                    price = (m["price"] as? Number)?.toInt(),
                )
            }
            ?: emptyList()

    /**
     * Вопрос-ответ для карточки. Сначала пробуем реальный metadata.faq ({q,a}); если его нет —
     * собираем fallback из РЕАЛЬНЫХ полей товара ([generatedFaq]), чтобы выдвижная Q&A-секция
     * не исчезала на товарах без своего FAQ (у Medusa-товаров его нет).
     */
    private fun faqList(p: MedusaProduct): List<MobileCatalogQaDto> {
        val real = (p.metadata?.get("faq") as? List<*>)
            ?.mapNotNull { it as? Map<*, *> }
            ?.mapNotNull { m ->
                val q = (m["q"] as? String)?.trim()?.takeIf { it.isNotBlank() } ?: return@mapNotNull null
                val a = (m["a"] as? String)?.trim()?.takeIf { it.isNotBlank() } ?: return@mapNotNull null
                MobileCatalogQaDto(q = q, a = a)
            }
            ?: emptyList()
        return real.ifEmpty { generatedFaq(p) }
    }

    /**
     * Fallback-Q&A из заполненных полей товара — БЕЗ выдуманных мед.утверждений: только
     * рецептурность, действующее вещество (+АТХ) и производитель (+страна). Пустые поля пропускаем.
     */
    private fun generatedFaq(p: MedusaProduct): List<MobileCatalogQaDto> {
        val out = mutableListOf<MobileCatalogQaDto>()
        metaStr(p, "rx_otc")?.let { rx ->
            val low = rx.lowercase()
            val prescription = low.contains("rx") || (low.contains("рецепт") && !low.contains("без"))
            out += MobileCatalogQaDto(
                q = "Отпускается по рецепту?",
                a = if (prescription) "Да, рецептурный препарат — отпускается по назначению врача."
                else "Нет, безрецептурный препарат (OTC).",
            )
        }
        metaStr(p, "mnn")?.let { mnn ->
            val atc = metaStr(p, "atc")
            out += MobileCatalogQaDto(
                q = "Какое действующее вещество?",
                a = if (atc != null) "Действующее вещество — $mnn (АТХ: $atc)." else "Действующее вещество — $mnn.",
            )
        }
        val manuf = metaStr(p, "manufacturer_official") ?: metaStr(p, "manufacturer")
        val country = metaStr(p, "country_official") ?: metaStr(p, "country")
        if (manuf != null || country != null) {
            out += MobileCatalogQaDto(q = "Кто производитель?", a = listOfNotNull(manuf, country).joinToString(", "))
        }
        return out
    }

    companion object {
        // Канал «Сайт» сейчас ~77 товаров — лента грузит весь каталог за 1-2 запроса.
        const val MAX_LIMIT = 100
        private const val MAX_RETAIL_PRICE_FALLBACKS = 50
        private const val RETAIL_PRICE_WORKERS = 8
        private const val RETAIL_PRICE_TIMEOUT_MS = 2_500L

        // Плейсхолдеры «поле не заполнено» из 1С-выгрузки витрины (товар есть, значения нет):
        // прочерки разных видов, "_", "none", "н/д". Сравнение по lowercase + trim.
        // Без этого фильтра "-" утекал в бренд/АТС/категорию у ~62% товаров (≈470 полей).
        private val META_PLACEHOLDERS = setOf("_", "-", "—", "–", "none", "n/a", "н/д")
    }
}
