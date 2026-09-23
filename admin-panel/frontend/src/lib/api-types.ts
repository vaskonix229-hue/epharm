// Типы API — соответствуют DTO бэкенда (kz.epharm.auth.dto.*).
// Когда обновляем бэкенд DTO — синхронизируем здесь.

export type AdminRole =
  | 'SYSTEM_ADMIN'
  | 'HQ_HEAD'
  | 'TRAINING_MANAGER'
  | 'REGIONAL_MANAGER'
  | 'TRAINER'
  | 'CATEGORY_LEAD'
  | 'BRAND_MANAGER'
  | 'FINANCE_REVIEWER'

export interface UserDto {
  id: string
  email: string
  name: string
  role: AdminRole
  company: string
}

export interface AuthTokens {
  /** JWT access token, передаётся в Authorization: Bearer <...>. */
  accessToken: string
  /** ISO-8601 timestamp expire access-токена. */
  accessTokenExpiresAt: string
  /** Raw refresh token, нужен для /api/admin/auth/refresh. */
  refreshToken: string
  refreshTokenExpiresAt: string
}

export interface LoginRequest {
  email: string
  password: string
}

export interface LoginResponse {
  tokens: AuthTokens
  user: UserDto
}

export interface RefreshRequest {
  refreshToken: string
}

export interface RefreshResponse {
  tokens: AuthTokens
}

export type ApiErrorCode =
  | 'INVALID_CREDENTIALS'
  | 'INVALID_REFRESH_TOKEN'
  | 'USER_NOT_FOUND'
  | 'USER_NOT_ACTIVE'
  | 'VALIDATION_FAILED'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INTERNAL'

export interface ApiErrorResponse {
  code: ApiErrorCode
  message: string
  timestamp: string
  fields?: Record<string, string>
}

// ─── Catalog (Этап 3.2) ──────────────────────────────────────────────────
// Зеркало kz.epharm.catalog.dto.*

export interface ProductDto {
  id: string
  name: string
  brand: string
  vendor: string
  mnn: string
  price: number
}

// Зеркало kz.epharm.catalog.dto.CreateProductRequest — id задаёт клиент
// (на него ссылаются правила), формат [a-z0-9_]{2,64}.
export interface CreateProductRequest {
  id: string
  name: string
  brand: string
  vendor: string
  mnn: string
  price: number
}

// Зеркало UpdateProductRequest — partial PATCH (id неизменяем).
export interface UpdateProductRequest {
  name?: string
  brand?: string
  vendor?: string
  mnn?: string
  price?: number
}

export interface BrandDto {
  brand: string
  vendor: string
  productCount: number
}

export interface MnnGroupDto {
  mnn: string
  productCount: number
}

// ─── Rules (Этап 3.2) ────────────────────────────────────────────────────
// Зеркало kz.epharm.rules.dto.* + kz.epharm.rules.entity.RuleTrigger/RuleAbTest.

export type RuleType = 'substitution' | 'crosssell'
export type RuleStatus = 'active' | 'paused' | 'draft' | 'archived'

export type TriggerKind = 'product' | 'mnn' | 'product_any'

export interface RuleTriggerDto {
  kind: TriggerKind
  /**
   * Полиморфно:
   *   kind='product'     → string (productId)
   *   kind='mnn'         → string (MNN name; опц. exclude:string[])
   *   kind='product_any' → string[] (productIds)
   */
  value: string | string[]
  exclude?: string[]
}

export interface RuleAbTestDto {
  variant: string
  share: number
}

// ─── Богатая карточка рекомендации (Фаза 2) — зеркало kz.epharm.rules.entity.RuleCard ───
export interface RuleComparisonRowDto {
  label: string
  triggerValue: string
  recommendValue: string
  recommendHighlight: boolean
}

export interface RuleCardDto {
  partnerLabel: string | null
  comparison: RuleComparisonRowDto[]
  goalLabel: string | null
  goalTarget: number | null
  goalBonus: number | null
}

export interface RuleDto {
  id: string
  type: RuleType
  status: RuleStatus
  trigger: RuleTriggerDto
  recommend: string
  bonus: number
  script: string
  advantages: string[]
  abTest: RuleAbTestDto | null
  /** Богатая карточка (Фаза 2): сравнение, партнёр, цель. null — нет богатой карточки. */
  card: RuleCardDto | null
  pharmacies: number
  impressions: number
  accepts: number
  convRate: number
  revenue: number
  payout: number
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface CreateRuleRequest {
  type: RuleType
  status?: RuleStatus
  trigger: RuleTriggerDto
  recommend: string
  bonus?: number
  script?: string
  advantages?: string[]
  abTest?: RuleAbTestDto | null
  card?: RuleCardDto | null
}

// ─── Finance / Payouts (Этап 3.5) ────────────────────────────────────────

export type PayoutBatchStatus = 'pending' | 'approved'

export interface PayoutBatchDto {
  id: string
  period: string
  status: PayoutBatchStatus
  pharmacists: number
  amount: number
  items: number
  reviewerId: string | null
  reviewerName: string | null
  approvedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface PayoutItemDto {
  id: string
  batchId: string
  pharmacistId: string
  pharmacistName: string
  pharmacy: string
  city: string
  receipts: number
  rules: number
  amount: number
  flag: string | null
}

// ─── Pharmacies + Pharmacists (Этап 3.4) ─────────────────────────────────

export type PharmacyGroup = 'pilot' | 'control' | 'rolled'

export interface ChainDto {
  id: string
  name: string
  color: string
  points: number
  group: PharmacyGroup
}

// Зеркало kz.epharm.pharmacies.dto.CreateChainRequest — id slug [a-z0-9_],
// color hex #RRGGBB (на сеть ссылаются аптеки через chainId).
export interface CreateChainRequest {
  id: string
  name: string
  color: string
  points?: number
  group: PharmacyGroup
}

export interface UpdateChainRequest {
  name?: string
  color?: string
  points?: number
  group?: PharmacyGroup
}

export interface PharmacyDto {
  id: string
  name: string
  chainId: string
  chainName: string
  city: string
  district: string
  addr: string
  group: PharmacyGroup
  pharmacists: number
  receipts30d: number
  gmv30d: number
  liftPct: number
  rulesAccepted: number
  active: boolean
  createdAt: string
  updatedAt: string
}

export interface CreatePharmacyRequest {
  name: string
  chainId: string
  city: string
  district?: string
  addr?: string
  group: PharmacyGroup
  active?: boolean
}

export interface UpdatePharmacyRequest {
  name?: string
  city?: string
  district?: string
  addr?: string
  group?: PharmacyGroup
  active?: boolean
  receipts30d?: number
  gmv30d?: number
  rulesAccepted?: number
}

export type PharmacistTier = 'Silver' | 'Gold' | 'Platinum'
export type PharmacistStatus = 'active' | 'pending' | 'blocked'

export interface PharmacistDto {
  id: string
  name: string
  iin: string
  phone: string
  pharmacyId: string
  pharmacyName: string
  city: string
  tier: PharmacistTier
  receipts30d: number
  rulesAccepted30d: number
  earned30d: number
  balance: number
  coursesDone: number
  coursesTotal: number
  status: PharmacistStatus
  joinedAt: string
  createdAt: string
  updatedAt: string
}

export interface CreatePharmacistRequest {
  name: string
  iin: string
  phone: string
  pharmacyId: string
  tier?: PharmacistTier
  status?: PharmacistStatus
}

export interface UpdatePharmacistRequest {
  name?: string
  phone?: string
  tier?: PharmacistTier
  balance?: number
  coursesDone?: number
  coursesTotal?: number
}

export interface ActivatePharmacistRequest {
  pharmacyId: string
}

export interface PosmPharmacistMappingDto {
  id: string
  pharmacyId: string
  pharmacyName: string
  externalUserId: string
  externalUserName: string | null
  pharmacistId: string
  pharmacistName: string
  active: boolean
  createdAt: string
  updatedAt: string
  revokedAt: string | null
}

export interface UnmappedPosmSellerDto {
  pharmacyId: string
  pharmacyName: string
  externalUserId: string
  externalUserName: string | null
  salesCount: number
  lastSeenAt: string
}

export interface UpsertPosmPharmacistMappingRequest {
  pharmacyId: string
  externalUserId: string
  externalUserName?: string | null
  pharmacistId: string
}

// ─── Promo (Этап 3.3) ────────────────────────────────────────────────────
// Зеркало kz.epharm.promo.dto.* + PromoStatus.

export type PromoStatus = 'active' | 'draft' | 'paused' | 'archived'

/** Ценовой порог акции: «от minQty шт → price ₸» (+ разовый bonus ₸ за порог). */
export interface PromoTierDto {
  minQty: number
  price: number
  bonus: number
}

export interface PromoDto {
  id: string
  title: string
  status: PromoStatus
  brand: string
  period: string
  pharmacies: number
  budget: number
  spent: number
  kpi: string
  cover: string
  // Товарная акция (V022): линк на товар Medusa + снимок + даты.
  medusaProductId: string | null
  productName: string
  productImage: string | null
  /** EAN-13 продвигаемого товара (из Medusa variant.barcode) — ключ матчинга на кассе. */
  barcode: string | null
  /** iPartID продвигаемого товара в кассе Стандарт-Н — ручной ключ матчинга. */
  ipartId: string | null
  /** Ручной override фото товара (поверх PIM/Medusa). null — берётся productImage. */
  overrideImage: string | null
  /** Ручной override описания товара (поверх PIM/Medusa). null — нет переопределения. */
  overrideDescription: string | null
  /** Ручной override характеристик (по строке; поверх keyFacts Medusa). null — нет. */
  overrideCharacteristics: string | null
  /** Цена товара из Medusa (read-only, обновляется каждый час — НЕ редактируется в админке). */
  price: number
  /** Единый бонус фармацевту за продажу (заменил многоуровневые пороги). */
  pharmacistBonus: number
  dateStart: string | null
  dateEnd: string | null
  /** Всегда один авто-собранный порог (legacy-поле; редактора порогов в кампании нет). */
  tiers: PromoTierDto[]
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface CreatePromoRequest {
  title: string
  status?: PromoStatus
  brand?: string
  period?: string
  budget?: number
  kpi?: string
  cover?: string
  medusaProductId?: string | null
  productName?: string
  productImage?: string | null
  /** EAN-13 продвигаемого товара (из Medusa) — ключ матчинга на кассе. */
  barcode?: string | null
  /** iPartID продвигаемого товара в кассе Стандарт-Н — ручной ключ матчинга. */
  ipartId?: string | null
  overrideImage?: string | null
  overrideDescription?: string | null
  overrideCharacteristics?: string | null
  pharmacistBonus?: number
  dateStart?: string | null
  dateEnd?: string | null
}

export interface UpdatePromoRequest {
  status?: PromoStatus
  title?: string
  brand?: string
  period?: string
  budget?: number
  kpi?: string
  cover?: string
  medusaProductId?: string | null
  productName?: string
  productImage?: string | null
  /** EAN-13 продвигаемого товара (из Medusa) — ключ матчинга на кассе. */
  barcode?: string | null
  /** iPartID продвигаемого товара в кассе Стандарт-Н — ручной ключ матчинга. */
  ipartId?: string | null
  overrideImage?: string | null
  overrideDescription?: string | null
  overrideCharacteristics?: string | null
  pharmacistBonus?: number
  dateStart?: string | null
  dateEnd?: string | null
}

// ─── Campaign rules (T2) — авторинг правил замены/кросс-селла из кампании ──────
// Зеркало backend PromoRulesViewDto / PromoRulesConfigDto / PromoRuleProductRef.

/** Дополнительный препарат в multi-offer списке POSM. */
export interface PromoOfferProductRef {
  medusaProductId: string
  name: string
  brand?: string | null
  mnn?: string | null
  volume?: string | null
  price?: number | null
  barcode?: string | null
  ipartId?: string | null
}

/** Ссылка на товар витрины внутри правила кампании (снимок имени/бренда/цены). */
export interface PromoRuleProductRef {
  medusaProductId: string
  name: string
  brand?: string | null
  mnn?: string | null
  volume?: string | null
  price?: number | null
  /** EAN-13 (из Medusa variant.barcode) — ключ матчинга этой пары на кассе. */
  barcode?: string | null
  /** iPartID Стандарт-Н — ручной ключ матчинга этой пары на кассе. */
  ipartId?: string | null
  // ── Поля, которые видны в блоке рекомендации на кассе (per-pair) ──────────
  /** Скрипт ЭТОЙ пары: что сказать фармацевту и почему. */
  script?: string
  /** Преимущества (по строке). */
  advantages?: string[]
  /** Метка партнёра. */
  partnerLabel?: string | null
  /** Таблица-сравнение «было/стало». */
  comparison?: RuleComparisonRowDto[]
  /** До четырёх альтернатив к основному товару кампании — итого максимум пять. */
  additionalRecommendations?: PromoOfferProductRef[]
  /** Статус ЭТОЙ пары: true=«Активно», false=«Черновик». */
  active?: boolean
}

export interface PromoRulesConfigDto {
  /** Товары, которые ЗАМЕНЯЕТ продвигаемый товар (substitution). */
  replacements: PromoRuleProductRef[]
  /** Товары, ВМЕСТЕ с которыми продаётся продвигаемый товар (cross-sell). */
  crossSells: PromoRuleProductRef[]
  script: string
  advantages: string[]
  partnerLabel: string | null
  comparison: RuleComparisonRowDto[]
  /** Цель кампании (одна на всю кампанию): «N/target <label>» + бонус за цель. */
  goalLabel: string | null
  goalTarget: number | null
  goalBonus: number | null
}

export interface PromoRulesViewDto {
  promoId: string
  config: PromoRulesConfigDto
  ruleCount: number
  activeCount: number
}

export interface UpdateRuleRequest {
  status?: RuleStatus
  trigger?: RuleTriggerDto
  recommend?: string
  bonus?: number
  script?: string
  advantages?: string[]
  abTest?: RuleAbTestDto | null
  /** Поставить true чтобы явно снять abTest (т.к. undefined = «не трогать»). */
  clearAbTest?: boolean
  card?: RuleCardDto | null
  /** Поставить true чтобы явно убрать богатую карточку. */
  clearCard?: boolean
}

// ─── Dashboard (Этап 3.6) — read-only сводка KPI ───
export interface TopRuleDto {
  id: string
  label: string
  convRate: number
  accepts: number
}

export interface TopPharmacyDto {
  id: string
  name: string
  city: string
  rulesAccepted: number
}

export interface TopProductDto {
  id: string
  name: string
  revenue: number
}

export interface DashboardSummaryDto {
  impressions: number
  accepts: number
  convRate: number
  activeRules: number
  totalRules: number
  paidOut: number
  pendingPayout: number
  pilotPharmacies: number
  avgLiftPct: number
  topRules: TopRuleDto[]
  topPharmacies: TopPharmacyDto[]
  topProducts: TopProductDto[]
}

// ─── Аналитика «Показано рекомендаций» (V032) — конверсия показ→продажа + время до продажи ───
export interface TimeBucketDto {
  label: string
  count: number
}

/** Строка журнала: показ рекомендации ИЛИ продажа (из двух наших таблиц). */
export interface LogEntryDto {
  id: string
  type: string // "show" | "sale" (одна строка = одна позиция чека)
  at: string // точное время события (ISO/UTC)
  title: string // что РЕКОМЕНДОВАЛИ (показ) / товар-позиция чека (продажа)
  triggerName: string | null // что ВЫБРАЛ покупатель — товар-триггер (только показ)
  pharmacyId: string
  pharmacyName: string
  pharmacistId: string
  pharmacistName: string
  amount: number // показ: ожидаемая сумма; продажа: сумма ЭТОЙ позиции
  converted: boolean // показ: продан ли рекомендованный товар
  secondsToSale: number | null // показ/позиция: через сколько секунд после показа продан
  units: number | null // продажа: количество единиц ЭТОЙ позиции; null для показа
  saleId: string | null // id чека — связь позиций одного чека (для проверки чека); null для показов
  pharmacistSource?:
    | 'legacy'
    | 'posm_internal'
    | 'standardn_explicit_mapping'
    | 'standardn_name_match'
    | 'standardn_unmapped'
    | 'unresolved'
    | null
}

export interface RecommendationAnalyticsDto {
  windowDays: number
  shown: number
  converted: number
  convRate: number
  convertedUnder2m: number
  avgSecondsToSale: number | null
  medianSecondsToSale: number | null
  attributedRevenue: number
  buckets: TimeBucketDto[]
  log: LogEntryDto[]
  page: number // 0-based
  pageSize: number
  totalElements: number
  totalPages: number
}

// ─── Lift (Этап 3.6) — pilot vs control аналитика ───
export interface LiftSegmentDto {
  name: string
  liftPct: number
  pharmacies: number
}

export interface LiftSummaryDto {
  networkLiftPct: number
  pValue: number | null
  /** true → нет показов в pilot и/или control: lift/pValue недостоверны. */
  insufficientData: boolean
  pilotCount: number
  controlCount: number
  rolledCount: number
  pilotReceipts30d: number
  controlReceipts30d: number
  segments: LiftSegmentDto[]
}

// ─── LMS (Этап 3.6) — обучающие курсы ───
export type CourseStatus = 'published' | 'draft' | 'archived'
export type CourseLessonKind =
  | 'text'
  | 'video'
  | 'pdf'
  | 'presentation'
  | 'image'
  | 'audio'
  | 'link'
  | 'interactive'
  | 'quiz'
  | 'test'
  | 'practice'
  | 'assignment'

export interface CourseLessonAttachmentDto {
  id: string
  title: string
  fileName: string
  contentType: string
  mediaUrl: string
  sizeBytes: number
  createdAt: string
  kind: 'image' | 'video' | 'audio' | 'document'
}

export interface CourseLessonDto {
  id: string
  title: string
  description: string
  content: string
  kind: CourseLessonKind
  videoUrl: string | null
  externalUrl: string | null
  required: boolean
  minimumWatchPct: number | null
  attachments: CourseLessonAttachmentDto[]
  durationMin: number
  order: number
  createdAt: string
  updatedAt: string
}

export interface CourseDto {
  id: string
  title: string
  description: string
  status: CourseStatus
  category: string
  lessons: number
  durationMin: number
  enrolled: number
  completed: number
  bonus: number
  lessonItems: CourseLessonDto[]
  createdAt: string
  updatedAt: string
}

export interface CreateCourseRequest {
  title: string
  status?: CourseStatus
  category?: string
  description?: string
  lessons?: number
  durationMin?: number
  bonus?: number
}

export interface UpdateCourseRequest {
  title?: string
  status?: CourseStatus
  category?: string
  description?: string
  lessons?: number
  durationMin?: number
  bonus?: number
}

export interface CreateCourseLessonRequest {
  title: string
  description?: string
  content?: string
  kind?: CourseLessonKind
  externalUrl?: string
  required?: boolean
  minimumWatchPct?: number
  durationMin?: number
}

export interface UpdateCourseLessonRequest {
  title?: string
  description?: string
  content?: string
  kind?: CourseLessonKind
  externalUrl?: string
  required?: boolean
  minimumWatchPct?: number
  clearMinimumWatchPct?: boolean
  durationMin?: number
  clearVideo?: boolean
}

// ─── Screens (Этап 3.6) — indoor-DOOH плейлисты + слайды (read-only; редактор в Этапе 5) ───
export type PlaylistStatus = 'active' | 'draft' | 'archived'
export type SlideKind = 'video' | 'image'

export interface PlaylistDto {
  id: string
  name: string
  status: PlaylistStatus
  slidesCount: number
  durationSec: number
  pharmacies: number
  /** Назначение (V016): null = все экраны (глобальный), иначе id конкретной аптеки/экрана. */
  pharmacyId: string | null
  createdAt: string
  updatedAt: string
}

export interface SlideDto {
  id: string
  title: string
  kind: SlideKind
  durationSec: number
  mediaUrl: string
  playlistId: string | null
  position: number
}

/** Один ролик упорядоченного эфира (до 12 позиций). */
export interface ActiveSlideDto {
  id: string
  url: string
  kind: SlideKind
  durationSec: number
  title: string
  /** Нулевая позиция; в UI отображается как слот 1..12. */
  position: number
  /** Для дочернего профиля: ролик взят из общего плейлиста. */
  inherited?: boolean
}
export interface ActivePlaylistDto {
  playlistId: string | null
  name: string
  slides: ActiveSlideDto[]
}

export interface BroadcastProfileSummaryDto {
  id: string
  name: string
  defaultProfile: boolean
  assignedPharmacies: number
}

export interface BroadcastProfileDto {
  id: string
  name: string
  defaultProfile: boolean
  assignedPharmacyIds: string[]
  /** Эффективные слоты: собственные ролики плюс наследуемые из общего профиля. */
  slides: ActiveSlideDto[]
}

// Зеркало kz.epharm.screens.dto.* (управление экранами, ТЗ §3.3)
export interface CreatePlaylistRequest {
  name: string
  status?: PlaylistStatus
}

export interface UpdatePlaylistRequest {
  name?: string
  status?: PlaylistStatus
  /** Применить назначение (V016). true → задать targetPharmacyId (в т.ч. null = все экраны). */
  setTarget?: boolean
  /** Целевая аптека/экран; null = все экраны. Действует только при setTarget=true. */
  targetPharmacyId?: string | null
}

export interface AssignSlideRequest {
  playlistId: string | null
  position?: number
}

// ─── Connected registers (T4) — heartbeat подключённых касс (POSM-плеер) ──────
export interface ConnectedDeviceDto {
  deviceId: string
  pharmacyId: string | null
  pharmacyName: string | null
  pharmacyAddress: string | null
  pharmacyCity: string | null
  pharmacyStreetAddress: string | null
  monitorCount: number | null
  hasClientScreen: boolean | null
  appVersion: string | null
  lastSeen: string
}

export interface ConnectedScreensDto {
  total: number
  devices: ConnectedDeviceDto[]
}

export interface ConnectedScreensSummaryDto {
  total: number
  observedAt: string
}

export interface PosmCoverageGapDto {
  pharmacyId: string
  pharmacyName: string
  city: string
  address: string
}

export interface PosmCoverageDto {
  activePharmacies: number
  provisionedPharmacies: number
  onlinePharmacies: number
  onlineRegisters: number
  unprovisionedPharmacies: PosmCoverageGapDto[]
  observedAt: string
}

// ─── AI-Exam (Этап 3.6) — банк вопросов (результаты/сертификаты в Этапе 4) ───
export type ExamQuestionKind = 'factual' | 'comparative' | 'scenario'

export interface ExamQuestionDto {
  id: string
  prompt: string
  kind: ExamQuestionKind
  category: string
  keywords: string[]
  difficulty: number
  createdAt: string
  updatedAt: string
}

export interface CreateExamQuestionRequest {
  prompt: string
  kind?: ExamQuestionKind
  category?: string
  keywords?: string[]
  difficulty?: number
}

export interface UpdateExamQuestionRequest {
  prompt?: string
  kind?: ExamQuestionKind
  category?: string
  keywords?: string[]
  difficulty?: number
}

// ─── Receipts / Reconcile (ТЗ §3.5) ──────────────────────────────────────
// Зеркало kz.epharm.receipts.dto.*
export type ReceiptStatus = 'pending' | 'moderation_required' | 'flagged' | 'approved' | 'rejected'

export interface ReceiptDto {
  id: string
  pharmacistId: string
  pharmacistName: string
  pharmacyId: string
  pharmacyName: string
  photoUrl: string | null
  parsedSku: string
  parsedAmount: number
  parsedCashier: string
  parsedAt: string | null
  status: ReceiptStatus
  autoApproved: boolean
  flagReason: string | null
  pendingBonusId: string | null
  /** CSV id акций (pr_*), заявленных фармацевтом при загрузке чека (контекст для модератора). */
  claimedPromoIds: string | null
  expectedAmount: number | null
  bonus: number | null
  bonusCredited: number
  source: string
  confirmedByLog: boolean
  confirmedByExcel: boolean
  reviewer: string | null
  reviewedAt: string | null
  createdAt: string
}

export interface ReconcileSummaryDto {
  queue: number
  moderationRequired: number
  flagged: number
  approved: number
  rejected: number
  autoApproved: number
}

export interface ExcelImportResultDto {
  importId: string
  fileName: string
  rowsTotal: number
  rowsMatched: number
}

// ── Витрина каталога (Medusa, read-only в админке) ──────────────────────────
// Зеркало backend MobileCatalogProductDto/MobileCatalogPageDto. Цена/бренд/фото
// nullable — реальный каталог наполняется постепенно.
export interface StorefrontProductDto {
  id: string
  name: string
  brand: string | null
  mnn: string | null
  rxOtc: string | null
  price: number | null
  currency: string
  imageUrl: string | null
  barcode: string | null
  ipartId?: string | null
  category: string | null
  priceMin?: number | null
  priceMax?: number | null
  pharmacyPriceCount?: number | null
}

/** Зеркало backend MobileCatalogDetailDto — деталь товара витрины (описание + характеристики). */
export interface StorefrontProductDetailDto {
  id: string
  name: string
  brand: string | null
  mnn: string | null
  atc: string | null
  rxOtc: string | null
  price: number | null
  currency: string
  imageUrl: string | null
  images: string[]
  barcode: string | null
  ipartId?: string | null
  category: string | null
  country: string | null
  manufacturer: string | null
  description: string | null
  keyFacts: string[]
  priceMin?: number | null
  priceMax?: number | null
  pharmacyPriceCount?: number | null
}

export interface StorefrontPageDto {
  items: StorefrontProductDto[]
  total: number
  limit: number
  offset: number
}

// ─── Banners (п.5) — баннеры главного экрана мобильного приложения ──────────
// Зеркало kz.epharm.banners.dto.* (BannerDtos.kt). Картинка грузится отдельно
// (POST /image → imageUrl), затем её URL передаётся в create/update.
export type BannerStatus = 'active' | 'draft' | 'archived'

/** Админская карточка баннера (все статусы). */
export interface BannerDto {
  id: string
  title: string
  subtitle: string | null
  imageUrl: string
  detailMd: string | null
  status: BannerStatus
  position: number
  createdAt: string
  updatedAt: string
}

/** Создание баннера. status по умолчанию draft на backend. */
export interface CreateBannerRequest {
  title: string
  subtitle?: string | null
  imageUrl?: string | null
  detailMd?: string | null
  status?: BannerStatus
  position?: number
}

/** Частичное обновление: только не-null поля (null/undefined = «не трогать»). */
export interface UpdateBannerRequest {
  title?: string
  subtitle?: string | null
  imageUrl?: string | null
  detailMd?: string | null
  status?: BannerStatus
  position?: number
}

/** Ответ загрузки картинки баннера (POST /api/admin/banners/image). */
export interface BannerImageUploadDto {
  imageUrl: string
}

// ─── Training programs ───────────────────────────────────────────────────
// Mirrors kz.epharm.training.dto and is shared by the operational admin UI.
export type TrainingFormat = 'online' | 'hybrid' | 'offline'
export type TrainingProgramStatus =
  | 'draft'
  | 'review'
  | 'scheduled'
  | 'published'
  | 'paused'
  | 'completed'
  | 'archived'
export type TrainingStageType =
  | 'material'
  | 'online_course'
  | 'test'
  | 'ai_exam'
  | 'offline_event'
  | 'manual_review'
export type TrainingStageStatus =
  | 'locked'
  | 'available'
  | 'in_progress'
  | 'waiting_review'
  | 'completed'
  | 'failed'
  | 'skipped'
export type TrainingAssignmentStatus =
  | 'scheduled'
  | 'not_started'
  | 'in_progress'
  | 'waiting_online'
  | 'waiting_test'
  | 'waiting_exam'
  | 'waiting_event_selection'
  | 'waiting_offline'
  | 'waiting_attendance'
  | 'waiting_review'
  | 'retake_required'
  | 'completed'
  | 'overdue'
  | 'paused'
  | 'cancelled'
export type TrainingPriority = 'low' | 'normal' | 'high' | 'critical'
export type OfflineEventStatus =
  | 'draft'
  | 'registration'
  | 'scheduled'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'archived'
export type EventParticipantStatus =
  | 'registered'
  | 'confirmed'
  | 'attended'
  | 'late'
  | 'no_show'
  | 'excused'
  | 'cancelled'
  | 'waitlisted'
export type AttendanceMethod = 'manual' | 'qr'
export type CertificateStatus = 'valid' | 'expired' | 'revoked' | 'replaced'
export type DuplicateAssignmentPolicy = 'skip' | 'update_deadline' | 'repeat'

export interface TrainingCapabilitiesDto {
  canManagePrograms: boolean
  canManageAssignments: boolean
  canManageEvents: boolean
  canMarkAttendance: boolean
  canAdjustRewards: boolean
  canRecordResults: boolean
  canManagePreferences: boolean
  canExport: boolean
  regionalScope: string[]
}

export interface TrainingDashboardDto {
  activePrograms: number
  totalAssignments: number
  notStarted: number
  inProgress: number
  completed: number
  overdue: number
  completionRatePct: number
  averageScore: number | null
  certificates: number
  rewardsIssued: number
  attendanceConfirmed: number
  noShows: number
  byFormat: Partial<Record<TrainingFormat, number>>
  capabilities: TrainingCapabilitiesDto
}

export interface TrainingProgramStageDto {
  id: string
  key: string
  type: TrainingStageType
  title: string
  order: number
  required: boolean
  unlockAfterKey: string | null
  deadlineDays: number | null
  passingScore: number | null
  maxAttempts: number | null
  bonus: number
  manualReview: boolean
  applicableFormats: TrainingFormat[]
  contentUrl: string | null
}

export interface TrainingProgramDto {
  id: string
  name: string
  shortDescription: string
  description: string
  coverUrl: string | null
  category: string
  manufacturer: string
  brand: string
  product: string
  language: string
  managerId: string | null
  managerName: string | null
  allowedFormats: TrainingFormat[]
  startsAt: string | null
  endsAt: string | null
  normativeDays: number
  tags: string[]
  status: TrainingProgramStatus
  version: number
  versionId: string
  onlineCourseId: string | null
  passingScore: number
  maxAttempts: number
  completionBonus: number
  stages: TrainingProgramStageDto[]
  assignments: number
  createdAt: string
  updatedAt: string
}

export interface CreateTrainingStageRequest {
  key: string
  type: TrainingStageType
  title: string
  order: number
  required?: boolean
  unlockAfterKey?: string | null
  deadlineDays?: number | null
  passingScore?: number | null
  maxAttempts?: number | null
  bonus?: number
  manualReview?: boolean
  applicableFormats?: TrainingFormat[]
  contentUrl?: string | null
}

export interface CreateTrainingProgramRequest {
  name: string
  shortDescription?: string
  description?: string
  coverUrl?: string | null
  category?: string
  manufacturer?: string
  brand?: string
  product?: string
  language?: string
  managerId?: string | null
  allowedFormats: TrainingFormat[]
  startsAt?: string | null
  endsAt?: string | null
  normativeDays?: number
  tags?: string[]
  status?: TrainingProgramStatus
  onlineCourseId?: string | null
  passingScore?: number
  maxAttempts?: number
  completionBonus?: number
  stages?: CreateTrainingStageRequest[]
}

export type UpdateTrainingProgramRequest = Partial<CreateTrainingProgramRequest> & {
  clearCoverUrl?: boolean
  clearManager?: boolean
  clearStartsAt?: boolean
  clearEndsAt?: boolean
  clearOnlineCourseId?: boolean
}

export interface OfflineEventDto {
  id: string
  programId: string
  programVersionId: string
  programName: string
  title: string
  eventType: string
  startsAt: string
  endsAt: string
  timezone: string
  region: string
  city: string
  address: string
  mapUrl: string | null
  trainerId: string | null
  trainerName: string | null
  organizer: string
  capacity: number
  occupied: number
  registrationDeadline: string | null
  status: OfflineEventStatus
  materialsUrl: string | null
  comment: string
  createdAt: string
  updatedAt: string
}

export interface TrainingEventQrDto {
  eventId: string
  token: string
  payload: string
}

export interface CreateOfflineEventRequest {
  programId: string
  title: string
  eventType?: string
  startsAt: string
  endsAt: string
  timezone?: string
  region?: string
  city?: string
  address?: string
  mapUrl?: string | null
  trainerId?: string | null
  organizer?: string
  capacity: number
  registrationDeadline?: string | null
  status?: OfflineEventStatus
  materialsUrl?: string | null
  comment?: string
}

export type UpdateOfflineEventRequest = Omit<Partial<CreateOfflineEventRequest>, 'programId'> & {
  clearRegistrationDeadline?: boolean
}

export interface EventParticipantDto {
  id: string
  eventId: string
  assignmentId: string
  pharmacistId: string
  pharmacistName: string
  pharmacyName: string
  status: EventParticipantStatus
  registeredAt: string
  checkedInAt: string | null
  checkMethod: AttendanceMethod | null
  trainerComment: string | null
  score: number | null
}

export interface MarkAttendanceRequest {
  status: EventParticipantStatus
  method?: AttendanceMethod
  comment?: string | null
  score?: number | null
}

export interface TrainingAssignmentStageDto {
  id: string
  programStageId: string
  key: string
  type: TrainingStageType
  title: string
  order: number
  required: boolean
  status: TrainingStageStatus
  progressPct: number
  score: number | null
  attemptsUsed: number
  maxAttempts: number | null
  passingScore: number | null
  contentUrl: string | null
  startedAt: string | null
  completedAt: string | null
}

export interface OfflineEventSummaryDto {
  id: string
  title: string
  startsAt: string
  endsAt: string
  timezone: string
  city: string
  address: string
  status: OfflineEventStatus
}

export interface TrainingCertificateDto {
  id: string
  number: string
  assignmentId: string
  pharmacistId: string
  pharmacistName: string
  programName: string
  format: TrainingFormat
  issuedAt: string
  expiresAt: string | null
  score: number | null
  signerName: string
  status: CertificateStatus
  verificationToken: string
  pdfUrl: string | null
}

export interface TrainingRewardDto {
  id: string
  assignmentId: string
  amount: number
  reason: string
  status: string
  issuedAt: string
}

export interface TrainingNotificationDto {
  id: string
  eventType: string
  title: string
  message: string
  assignmentId: string | null
  eventId: string | null
  read: boolean
  scheduledAt: string
  readAt: string | null
}

export interface PharmacistTrainingProfileDto {
  pharmacistId: string
  pharmacistName: string
  pharmacyName: string
  city: string
  defaultFormat: TrainingFormat | null
  totalAssignments: number
  completedAssignments: number
  inProgressAssignments: number
  totalRewards: number
  assignments: TrainingAssignmentDto[]
  certificates: TrainingCertificateDto[]
  rewards: TrainingRewardDto[]
  preferenceHistory: TrainingPreferenceDto[]
}

export interface TrainingAssignmentDto {
  id: string
  programId: string
  programVersionId: string
  programVersion: number
  programName: string
  programShortDescription: string
  coverUrl: string | null
  pharmacistId: string
  pharmacistName: string
  pharmacyName: string
  city: string
  format: TrainingFormat
  status: TrainingAssignmentStatus
  priority: TrainingPriority
  required: boolean
  event: OfflineEventSummaryDto | null
  startsAt: string | null
  dueAt: string | null
  progressPct: number
  score: number | null
  startedAt: string | null
  completedAt: string | null
  stages: TrainingAssignmentStageDto[]
  certificate: TrainingCertificateDto | null
  reward: TrainingRewardDto | null
  createdAt: string
  updatedAt: string
}

export interface TrainingAssignmentPageDto {
  items: TrainingAssignmentDto[]
  total: number
  page: number
  size: number
  totalPages: number
}

export interface CreateTrainingAssignmentsRequest {
  programId: string
  pharmacistIds: string[]
  format: TrainingFormat
  startsAt?: string | null
  dueAt?: string | null
  eventId?: string | null
  priority?: TrainingPriority
  required?: boolean
  responsibleId?: string | null
  duplicatePolicy?: DuplicateAssignmentPolicy
}

export interface MassAssignmentResultDto {
  created: number
  updated: number
  skipped: number
  assignments: TrainingAssignmentDto[]
}

export interface RecordAssessmentResultRequest {
  score: number
  passed?: boolean | null
  feedback?: string
  competencyScores?: Record<string, number>
}

export interface TrainingAssessmentResultDto {
  id: string
  assignmentId: string
  assignmentStageId: string
  sourceType: TrainingStageType
  attempt: number
  score: number
  passed: boolean
  feedback: string
  competencyScores: Record<string, number>
  recordedBy: string
  recordedByName: string
  recordedAt: string
}

export interface TrainingPreferenceDto {
  id: string
  pharmacistId: string
  pharmacistName: string
  defaultFormat: TrainingFormat
  changedBy: string
  changedByName: string
  reason: string
  validFrom: string
  validTo: string | null
  current: boolean
}

export interface ChangeTrainingPreferenceRequest {
  defaultFormat: TrainingFormat
  reason: string
}

export interface MassChangeTrainingPreferencesRequest extends ChangeTrainingPreferenceRequest {
  pharmacistIds: string[]
}

export interface ChangeAssignmentFormatRequest {
  format: TrainingFormat
  eventId?: string | null
  reason: string
}

export interface TrainingAssignmentFormatHistoryDto {
  id: string
  assignmentId: string
  oldFormat: TrainingFormat
  newFormat: TrainingFormat
  oldEventId: string | null
  newEventId: string | null
  reason: string
  changedBy: string
  changedByName: string
  changedAt: string
}

// ─── Storefront order fulfillment ───────────────────────────────────────

export type FulfillmentStatus = 'submitted' | 'assembling' | 'ready' | 'completed' | 'cancelled'
export type FulfillmentAction = 'assemble' | 'ready' | 'issue' | 'cancel'

export interface FulfillmentFeatureStatusDto {
  enabled: boolean
  deviceRegistrationEnabled: boolean
  legacyPosmKeyEnabled: boolean
}

export interface FulfillmentLineDto {
  productId: string
  sku: string
  title: string
  quantity: number
  unitPrice: number | null
}

export interface FulfillmentOrderDto {
  orderId: string
  number: string
  pharmacyExternalId: string
  pharmacyId: string | null
  pharmacyName: string | null
  pharmacyAddress: string | null
  createdAt: string
  total: number
  currency: string
  delivery: string
  paymentMethod: string
  paymentStatus: string
  paymentStatusClaimed: string
  paymentAuthority: string | null
  demo: boolean
  status: FulfillmentStatus
  version: number
  pickupAttempts: number
  pickupLockedUntil: string | null
  cancellationReason: string | null
  completedAt: string | null
  updatedAt: string
  lines: FulfillmentLineDto[]
}

export interface FulfillmentOrderPageDto {
  items: FulfillmentOrderDto[]
  offset: number
  limit: number
  hasMore: boolean
}

export interface FulfillmentActionRequest {
  action: FulfillmentAction
  expectedVersion: number
  code?: string
  reason?: string
  cashCollected?: boolean
}

export interface FulfillmentAssignRequest {
  pharmacyId: string
  expectedVersion: number
}

export interface FulfillmentPharmacyLinkRequest {
  externalId: string
  pharmacyId: string
  crmBranchId?: string | null
  active?: boolean
}

export interface FulfillmentPharmacyLinkDto {
  externalId: string
  pharmacyId: string
  pharmacyName: string
  pharmacyAddress: string
  crmBranchId: string | null
  active: boolean
  updatedAt: string
}

export interface FulfillmentDeviceDto {
  id: string
  deviceId: string
  pharmacyId: string
  pharmacyName: string
  active: boolean
  secretHint: string
  registeredAt: string
  lastSeenAt: string
  revokedAt: string | null
}

export interface ProvisionPosmDeviceRequest {
  deviceId: string
  pharmacyId: string
}

export interface ProvisionPosmDeviceResponse extends ProvisionPosmDeviceRequest {
  token: string
}
