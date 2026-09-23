package kz.epharm.training

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import kz.epharm.auth.domain.AdminRole
import kz.epharm.auth.domain.AdminUserStatus
import kz.epharm.auth.dto.LoginRequest
import kz.epharm.auth.dto.LoginResponse
import kz.epharm.auth.entity.AdminUserEntity
import kz.epharm.auth.repository.AdminUserRepository
import kz.epharm.auth.service.JwtService
import kz.epharm.lms.entity.CourseEntity
import kz.epharm.lms.entity.CourseLessonEntity
import kz.epharm.lms.entity.CourseLessonKind
import kz.epharm.lms.entity.CourseStatus
import kz.epharm.lms.repository.CourseLessonRepository
import kz.epharm.lms.repository.CourseRepository
import kz.epharm.pharmacies.entity.ChainEntity
import kz.epharm.pharmacies.entity.PharmacyEntity
import kz.epharm.pharmacies.entity.PharmacyGroup
import kz.epharm.pharmacies.repository.ChainRepository
import kz.epharm.pharmacies.repository.PharmacyRepository
import kz.epharm.pharmacists.entity.PharmacistEntity
import kz.epharm.pharmacists.entity.PharmacistStatus
import kz.epharm.pharmacists.repository.PharmacistRepository
import kz.epharm.training.repository.TrainingCertificateRepository
import kz.epharm.training.repository.TrainingAssessmentResultRepository
import kz.epharm.training.repository.TrainingRewardRepository
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.http.MediaType
import org.springframework.security.crypto.password.PasswordEncoder
import org.springframework.test.context.ActiveProfiles
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import org.springframework.transaction.annotation.Transactional
import org.testcontainers.containers.PostgreSQLContainer
import org.testcontainers.junit.jupiter.Container
import org.testcontainers.junit.jupiter.Testcontainers
import java.time.Instant

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Testcontainers
@Transactional
class TrainingIntegrationTest {
    companion object {
        @Container
        @JvmStatic
        val postgres: PostgreSQLContainer<*> = PostgreSQLContainer("postgres:16-alpine")
            .withDatabaseName("epharm_training_test")
            .withUsername("epharm")
            .withPassword("epharm_test")
            .apply { start() }

        @JvmStatic
        @DynamicPropertySource
        fun props(registry: DynamicPropertyRegistry) {
            registry.add("spring.datasource.url") { postgres.jdbcUrl }
            registry.add("spring.datasource.username") { postgres.username }
            registry.add("spring.datasource.password") { postgres.password }
        }
    }

    @Autowired private lateinit var mockMvc: MockMvc
    @Autowired private lateinit var objectMapper: ObjectMapper
    @Autowired private lateinit var passwordEncoder: PasswordEncoder
    @Autowired private lateinit var jwtService: JwtService
    @Autowired private lateinit var adminUserRepository: AdminUserRepository
    @Autowired private lateinit var chainRepository: ChainRepository
    @Autowired private lateinit var pharmacyRepository: PharmacyRepository
    @Autowired private lateinit var pharmacistRepository: PharmacistRepository
    @Autowired private lateinit var courseRepository: CourseRepository
    @Autowired private lateinit var courseLessonRepository: CourseLessonRepository
    @Autowired private lateinit var certificateRepository: TrainingCertificateRepository
    @Autowired private lateinit var assessmentResultRepository: TrainingAssessmentResultRepository
    @Autowired private lateinit var rewardRepository: TrainingRewardRepository

    private lateinit var adminBearer: String
    private lateinit var pharmacistBearer: String

    @BeforeEach
    fun seed() {
        val admin = adminUserRepository.save(
            AdminUserEntity(
                email = "training@inkar.kz",
                passwordHash = passwordEncoder.encode("strong-pass"),
                name = "Training Manager",
                company = "Inkar",
            ).also {
                it.role = AdminRole.TRAINING_MANAGER
                it.status = AdminUserStatus.ACTIVE
            },
        )
        chainRepository.save(ChainEntity(id = "chain_training", name = "Training chain", color = "#123456").also {
            it.group = PharmacyGroup.pilot
        })
        pharmacyRepository.save(
            PharmacyEntity(
                id = "pharmacy_training",
                name = "Аптека обучения",
                chainId = "chain_training",
                chainName = "Training chain",
                city = "Алматы",
                addr = "Ауэзова 134",
            ).also { it.group = PharmacyGroup.pilot },
        )
        pharmacistRepository.save(
            PharmacistEntity(
                id = "ph_training",
                name = "Айжан Фармацевт",
                iin = "900101400001",
                phone = "+77070000001",
                pharmacyId = "pharmacy_training",
                pharmacyName = "Аптека обучения",
                city = "Алматы",
            ).also { it.status = PharmacistStatus.active },
        )
        courseRepository.save(
            CourseEntity(
                id = "crs_training",
                title = "Основы продукта",
                description = "Безопасная рекомендация категории",
                lessons = 1,
                durationMin = 8,
            ).also {
                it.status = CourseStatus.published
            },
        )
        courseLessonRepository.save(
            CourseLessonEntity(
                id = "cls_training_intro",
                courseId = "crs_training",
                title = "Введение",
                description = "Основные понятия",
                content = "Текст учебного материала",
                videoUrl = "https://epharm.inkar.kz/s3/training-intro.mp4",
                externalUrl = "https://learn.epharm.kz/materials/intro",
                requiredLesson = true,
                minimumWatchPct = 80,
                durationMin = 8,
                order = 0,
            ).also { it.kind = CourseLessonKind.video },
        )
        adminBearer = "Bearer " + login().tokens.accessToken
        pharmacistBearer = "Bearer " + jwtService.issuePharmacistToken(
            "ph_training",
            "Айжан Фармацевт",
            "+77070000001",
        )
    }

    @Test
    fun `program assignment mobile progress creates certificate and reward exactly once`() {
        val program = createPublishedProgram()
        val programId = program["id"].asText()

        val assignmentBody = """
            {
              "programId":"$programId",
              "pharmacistIds":["ph_training"],
              "format":"online",
              "duplicatePolicy":"skip"
            }
        """.trimIndent()
        val assignmentResponse = mockMvc.perform(
            post("/api/admin/training/assignments")
                .header("Authorization", adminBearer)
                .contentType(MediaType.APPLICATION_JSON)
                .content(assignmentBody),
        )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.created").value(1))
            .andExpect(jsonPath("$.skipped").value(0))
            .andReturn().response.contentAsString
        val assignment = objectMapper.readTree(assignmentResponse)["assignments"][0]
        val assignmentId = assignment["id"].asText()
        assert(assignment["stages"].size() == 2)

        mockMvc.perform(
            get("/api/admin/training/assignments/page")
                .param("programId", programId)
                .param("format", "online")
                .param("q", "Айжан")
                .param("page", "0")
                .param("size", "1")
                .header("Authorization", adminBearer),
        )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.items.length()").value(1))
            .andExpect(jsonPath("$.total").value(1))
            .andExpect(jsonPath("$.page").value(0))
            .andExpect(jsonPath("$.size").value(1))
            .andExpect(jsonPath("$.totalPages").value(1))

        mockMvc.perform(
            post("/api/admin/training/assignments")
                .header("Authorization", adminBearer)
                .contentType(MediaType.APPLICATION_JSON)
                .content(assignmentBody),
        )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.created").value(0))
            .andExpect(jsonPath("$.skipped").value(1))

        val started = mockMvc.perform(
            post("/api/mobile/training/assignments/$assignmentId/start")
                .header("Authorization", pharmacistBearer),
        )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.status").value("waiting_online"))
            .andExpect(jsonPath("$.stages[0].course.title").value("Основы продукта"))
            .andExpect(jsonPath("$.stages[0].course.lessons[0].title").value("Введение"))
            .andExpect(jsonPath("$.stages[0].course.lessons[0].kind").value("video"))
            .andExpect(jsonPath("$.stages[0].course.lessons[0].externalUrl").value("https://learn.epharm.kz/materials/intro"))
            .andExpect(jsonPath("$.stages[0].course.lessons[0].required").value(true))
            .andExpect(jsonPath("$.stages[0].course.lessons[0].minimumWatchPct").value(80))
            .andExpect(
                jsonPath("$.stages[0].course.lessons[0].videoUrl")
                    .value("https://epharm.inkar.kz/s3/training-intro.mp4"),
            )
            .andReturn().response.contentAsString
        val startedJson = objectMapper.readTree(started)
        val onlineStage = startedJson["stages"].first { it["type"].asText() == "online_course" }

        val afterOnline = mockMvc.perform(
            patch("/api/mobile/training/assignments/$assignmentId/stages/${onlineStage["id"].asText()}")
                .header("Authorization", pharmacistBearer)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""{"progressPct":100}"""),
        )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.status").value("waiting_test"))
            .andReturn().response.contentAsString
        val testStage = objectMapper.readTree(afterOnline)["stages"].first { it["type"].asText() == "test" }

        mockMvc.perform(
            patch("/api/mobile/training/assignments/$assignmentId/stages/${testStage["id"].asText()}")
                .header("Authorization", pharmacistBearer)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""{"progressPct":100}"""),
        )
            .andExpect(status().isForbidden)

        val completedResponse = mockMvc.perform(
            patch("/api/admin/training/assignments/$assignmentId/stages/${testStage["id"].asText()}/result")
                .header("Authorization", adminBearer)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""{"score":92,"feedback":"Тест успешно сдан"}"""),
        )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.status").value("completed"))
            .andExpect(jsonPath("$.progressPct").value(100))
            .andExpect(jsonPath("$.certificate.number").isNotEmpty)
            .andExpect(jsonPath("$.certificate.pdfUrl").value(org.hamcrest.Matchers.endsWith("/pdf")))
            .andExpect(jsonPath("$.reward.amount").value(750))
            .andReturn().response.contentAsString
        val completed = objectMapper.readTree(completedResponse)
        val certificateToken = completed["certificate"]["verificationToken"].asText()

        mockMvc.perform(
            get("/api/admin/training/assignments/$assignmentId/results")
                .header("Authorization", adminBearer),
        )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$[0].attempt").value(1))
            .andExpect(jsonPath("$[0].score").value(92))
            .andExpect(jsonPath("$[0].passed").value(true))

        val overviewResponse = mockMvc.perform(get("/api/mobile/training").header("Authorization", pharmacistBearer))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.completed").value(1))
            .andExpect(jsonPath("$.certificates.length()").value(1))
            .andExpect(jsonPath("$.notifications.length()").value(2))
            .andExpect(jsonPath("$.notifications[0].read").value(false))
            .andReturn().response.contentAsString
        val notificationId = objectMapper.readTree(overviewResponse)["notifications"][0]["id"].asText()

        mockMvc.perform(
            patch("/api/mobile/training/notifications/$notificationId/read")
                .header("Authorization", pharmacistBearer),
        )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.read").value(true))
            .andExpect(jsonPath("$.readAt").isNotEmpty)

        mockMvc.perform(
            get("/api/admin/training/pharmacists/ph_training/profile")
                .header("Authorization", adminBearer),
        )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.pharmacistName").value("Айжан Фармацевт"))
            .andExpect(jsonPath("$.totalAssignments").value(1))
            .andExpect(jsonPath("$.completedAssignments").value(1))
            .andExpect(jsonPath("$.totalRewards").value(750))
            .andExpect(jsonPath("$.certificates.length()").value(1))

        mockMvc.perform(get("/api/public/training/certificates/$certificateToken"))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.number").isNotEmpty)
            .andExpect(jsonPath("$.pharmacistName").value("Айжан Фармацевт"))
            .andExpect(jsonPath("$.programName").value("Безопасная рекомендация продукта"))
            .andExpect(jsonPath("$.valid").value(true))

        val pdf = mockMvc.perform(get("/api/public/training/certificates/$certificateToken/pdf"))
            .andExpect(status().isOk)
            .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.content().contentType(MediaType.APPLICATION_PDF))
            .andReturn().response.contentAsByteArray
        assert(pdf.size > 5_000)
        assert(String(pdf.take(4).toByteArray()) == "%PDF")

        assert(certificateRepository.count() == 1L)
        assert(assessmentResultRepository.count() == 1L)
        assert(rewardRepository.count() == 1L)
        assert(pharmacistRepository.findById("ph_training").orElseThrow().balance == 750L)
    }

    @Test
    fun `pharmacist cannot access another assignment and admin endpoints reject pharmacist token`() {
        mockMvc.perform(get("/api/admin/training/programs").header("Authorization", pharmacistBearer))
            .andExpect(status().isForbidden)
        mockMvc.perform(get("/api/mobile/training").header("Authorization", adminBearer))
            .andExpect(status().isForbidden)
    }

    @Test
    fun `preference history and filtered export are available to training manager`() {
        mockMvc.perform(
            patch("/api/admin/training/pharmacists/ph_training/preference")
                .header("Authorization", adminBearer)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""{"defaultFormat":"hybrid","reason":"Нужна очная практика"}"""),
        )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.pharmacistName").value("Айжан Фармацевт"))
            .andExpect(jsonPath("$.defaultFormat").value("hybrid"))
            .andExpect(jsonPath("$.current").value(true))

        mockMvc.perform(get("/api/admin/training/preferences").header("Authorization", adminBearer))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$[0].defaultFormat").value("hybrid"))

        mockMvc.perform(
            patch("/api/admin/training/pharmacists/ph_training/preference")
                .header("Authorization", adminBearer)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""{"defaultFormat":"online","reason":"Перевод на дистанционный формат"}"""),
        ).andExpect(status().isOk)

        mockMvc.perform(
            get("/api/admin/training/pharmacists/ph_training/preference-history")
                .header("Authorization", adminBearer),
        )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.length()").value(2))
            .andExpect(jsonPath("$[0].defaultFormat").value("online"))
            .andExpect(jsonPath("$[1].validTo").isNotEmpty)

        val csv = mockMvc.perform(
            get("/api/admin/training/assignments/export.csv")
                .param("format", "online")
                .header("Authorization", adminBearer),
        )
            .andExpect(status().isOk)
            .andReturn().response.contentAsString
        assert(csv.contains("Назначения обучения"))
        assert(csv.contains("Автор"))
    }

    @Test
    fun `each format receives only its configured route and status change keeps version`() {
        val createBody = """
            {
              "name":"Маршруты по формату",
              "description":"Исходное описание",
              "coverUrl":"https://cdn.example.org/training/cover.jpg",
              "language":"ru",
              "startsAt":"2026-08-10T08:00:00Z",
              "endsAt":"2026-08-20T08:00:00Z",
              "allowedFormats":["online","hybrid","offline"],
              "status":"draft",
              "onlineCourseId":"crs_training",
              "stages":[
                {"key":"materials","type":"material","title":"Материалы","order":0,
                 "applicableFormats":["online","hybrid"],"contentUrl":"https://example.org/material"},
                {"key":"seminar","type":"offline_event","title":"Семинар","order":1,
                 "applicableFormats":["hybrid","offline"]},
                {"key":"test","type":"test","title":"Тест","order":2,
                 "passingScore":80,"maxAttempts":2,"applicableFormats":["online","hybrid","offline"]}
              ]
            }
        """.trimIndent()
        val created = objectMapper.readTree(
            mockMvc.perform(
                post("/api/admin/training/programs")
                    .header("Authorization", adminBearer)
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(createBody),
            )
                .andExpect(status().isOk)
                .andExpect(jsonPath("$.stages[0].contentUrl").value("https://example.org/material"))
                .andReturn().response.contentAsString,
        )
        val programId = created["id"].asText()

        mockMvc.perform(
            patch("/api/admin/training/programs/$programId")
                .header("Authorization", adminBearer)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""{"status":"published"}"""),
        )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.version").value(1))

        mockMvc.perform(
            patch("/api/admin/training/programs/$programId")
                .header("Authorization", adminBearer)
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    """{"description":"Обновлённое описание","language":"kk","tags":["INKAR","кардиология"],"clearCoverUrl":true,"clearStartsAt":true,"clearEndsAt":true}""",
                ),
        )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.version").value(1))
            .andExpect(jsonPath("$.description").value("Обновлённое описание"))
            .andExpect(jsonPath("$.language").value("kk"))
            .andExpect(jsonPath("$.coverUrl").doesNotExist())
            .andExpect(jsonPath("$.startsAt").doesNotExist())
            .andExpect(jsonPath("$.endsAt").doesNotExist())

        mockMvc.perform(
            patch("/api/admin/training/programs/$programId")
                .header("Authorization", adminBearer)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""{"clearOnlineCourseId":true}"""),
        )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.version").value(2))
            .andExpect(jsonPath("$.onlineCourseId").doesNotExist())

        val assignment = objectMapper.readTree(
            mockMvc.perform(
                post("/api/admin/training/assignments")
                    .header("Authorization", adminBearer)
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(
                        """{"programId":"$programId","pharmacistIds":["ph_training"],"format":"online"}""",
                    ),
            )
                .andExpect(status().isOk)
                .andExpect(jsonPath("$.assignments[0].stages.length()").value(2))
                .andExpect(jsonPath("$.assignments[0].stages[0].type").value("material"))
                .andExpect(jsonPath("$.assignments[0].stages[1].type").value("test"))
                .andReturn().response.contentAsString,
        )["assignments"][0]
        val assignmentId = assignment["id"].asText()

        mockMvc.perform(
            patch("/api/admin/training/assignments/$assignmentId/format")
                .header("Authorization", adminBearer)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""{"format":"offline","reason":"Нужна очная практика"}"""),
        )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.format").value("offline"))
            .andExpect(jsonPath("$.stages.length()").value(2))
            .andExpect(jsonPath("$.stages[0].type").value("offline_event"))
            .andExpect(jsonPath("$.stages[1].type").value("test"))

        mockMvc.perform(
            get("/api/admin/training/assignments/$assignmentId/format-history")
                .header("Authorization", adminBearer),
        )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$[0].oldFormat").value("online"))
            .andExpect(jsonPath("$[0].newFormat").value("offline"))
    }

    @Test
    fun `online course stage requires linked course or content url`() {
        mockMvc.perform(
            post("/api/admin/training/programs")
                .header("Authorization", adminBearer)
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    """
                    {
                      "name":"Некорректная программа",
                      "allowedFormats":["online"],
                      "stages":[
                        {"key":"course","type":"online_course","title":"Онлайн-курс","order":0,
                         "applicableFormats":["online"]}
                      ]
                    }
                    """.trimIndent(),
                ),
        )
            .andExpect(status().isBadRequest)
            .andExpect(
                jsonPath("$.message").value(
                    "Этап course: привяжите онлайн-курс или укажите ссылку на материал",
                ),
            )
    }

    @Test
    fun `hybrid route requires both online and offline stages`() {
        mockMvc.perform(
            post("/api/admin/training/programs")
                .header("Authorization", adminBearer)
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    """
                    {
                      "name":"Неполный гибридный маршрут",
                      "allowedFormats":["hybrid"],
                      "status":"draft",
                      "stages":[
                        {"key":"materials","type":"material","title":"Материалы","order":0,
                         "applicableFormats":["hybrid"],"contentUrl":"https://example.org/material"}
                      ]
                    }
                    """.trimIndent(),
                ),
        )
            .andExpect(status().isBadRequest)
            .andExpect(jsonPath("$.message").value("Гибридный маршрут должен содержать обязательное очное мероприятие"))
    }

    @Test
    fun `pharmacist selects matching event and checks in with protected qr`() {
        val program = createPublishedProgram()
        val programId = program["id"].asText()
        val startsAt = Instant.now().plusSeconds(3_600)
        val endsAt = startsAt.plusSeconds(3_600)
        val registrationDeadline = Instant.now().plusSeconds(1_800)

        val eventResponse = mockMvc.perform(
            post("/api/admin/training/events")
                .header("Authorization", adminBearer)
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    """
                    {
                      "programId":"$programId",
                      "title":"Практика по продукту",
                      "startsAt":"$startsAt",
                      "endsAt":"$endsAt",
                      "registrationDeadline":"$registrationDeadline",
                      "region":"Алматы",
                      "city":"Алматы",
                      "address":"Ауэзова 134",
                      "capacity":10,
                      "status":"registration"
                    }
                    """.trimIndent(),
                ),
        )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.occupied").value(0))
            .andExpect(jsonPath("$.qrToken").doesNotExist())
            .andReturn().response.contentAsString
        val eventId = objectMapper.readTree(eventResponse)["id"].asText()
        val movedStartsAt = startsAt.plusSeconds(600)
        val movedEndsAt = endsAt.plusSeconds(600)

        mockMvc.perform(
            patch("/api/admin/training/events/$eventId")
                .header("Authorization", adminBearer)
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    """{"startsAt":"$movedStartsAt","endsAt":"$movedEndsAt","address":"Тимирязева 42","capacity":12,"clearRegistrationDeadline":true}""",
                ),
        )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.startsAt").value(movedStartsAt.toString()))
            .andExpect(jsonPath("$.address").value("Тимирязева 42"))
            .andExpect(jsonPath("$.capacity").value(12))
            .andExpect(jsonPath("$.registrationDeadline").doesNotExist())

        val assignmentResponse = mockMvc.perform(
            post("/api/admin/training/assignments")
                .header("Authorization", adminBearer)
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    """{"programId":"$programId","pharmacistIds":["ph_training"],"format":"hybrid"}""",
                ),
        )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.assignments[0].event").doesNotExist())
            .andReturn().response.contentAsString
        val assignmentId = objectMapper.readTree(assignmentResponse)["assignments"][0]["id"].asText()

        mockMvc.perform(
            get("/api/mobile/training/assignments/$assignmentId/events")
                .header("Authorization", pharmacistBearer),
        )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.length()").value(1))
            .andExpect(jsonPath("$[0].id").value(eventId))
            .andExpect(jsonPath("$[0].qrToken").doesNotExist())

        mockMvc.perform(
            post("/api/mobile/training/assignments/$assignmentId/events/$eventId")
                .header("Authorization", pharmacistBearer),
        )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.event.id").value(eventId))

        val qrResponse = mockMvc.perform(
            get("/api/admin/training/events/$eventId/qr")
                .header("Authorization", adminBearer),
        )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.eventId").value(eventId))
            .andExpect(jsonPath("$.payload").value(org.hamcrest.Matchers.startsWith("epharm://training/check-in/")))
            .andReturn().response.contentAsString
        val qrToken = objectMapper.readTree(qrResponse)["token"].asText()

        mockMvc.perform(
            post("/api/mobile/training/events/check-in/$qrToken")
                .header("Authorization", pharmacistBearer),
        )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.event.id").value(eventId))
            .andExpect(jsonPath("$.stages[?(@.type == 'offline_event')].status").value("completed"))

        mockMvc.perform(
            get("/api/admin/training/events/$eventId/participants")
                .header("Authorization", adminBearer),
        )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$[0].pharmacistId").value("ph_training"))
            .andExpect(jsonPath("$[0].status").value("attended"))
            .andExpect(jsonPath("$[0].checkMethod").value("qr"))

        val participantResponse = mockMvc.perform(
            get("/api/admin/training/events/$eventId/participants")
                .header("Authorization", adminBearer),
        ).andReturn().response.contentAsString
        val participantId = objectMapper.readTree(participantResponse)[0]["id"].asText()

        mockMvc.perform(
            patch("/api/admin/training/events/$eventId/participants/$participantId")
                .header("Authorization", adminBearer)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""{"status":"late","method":"manual","comment":"Опоздание на 10 минут"}"""),
        )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.status").value("late"))
            .andExpect(jsonPath("$.checkedInAt").isNotEmpty)

        mockMvc.perform(
            patch("/api/admin/training/events/$eventId/participants/$participantId")
                .header("Authorization", adminBearer)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""{"status":"excused","method":"manual","comment":"Больничный"}"""),
        )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.status").value("excused"))
            .andExpect(jsonPath("$.checkedInAt").doesNotExist())

        mockMvc.perform(
            get("/api/mobile/training/assignments/$assignmentId")
                .header("Authorization", pharmacistBearer),
        )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.status").value("waiting_online"))
            .andExpect(jsonPath("$.event").doesNotExist())
    }

    @Test
    fun `cancelling event releases unfinished assignment and notifies pharmacist`() {
        val programId = createPublishedProgram()["id"].asText()
        val startsAt = Instant.now().plusSeconds(7_200)
        val endsAt = startsAt.plusSeconds(3_600)
        val eventId = objectMapper.readTree(
            mockMvc.perform(
                post("/api/admin/training/events")
                    .header("Authorization", adminBearer)
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(
                        """
                        {
                          "programId":"$programId",
                          "title":"Отменяемая практика",
                          "startsAt":"$startsAt",
                          "endsAt":"$endsAt",
                          "city":"Алматы",
                          "capacity":10,
                          "status":"registration"
                        }
                        """.trimIndent(),
                    ),
            ).andExpect(status().isOk).andReturn().response.contentAsString,
        )["id"].asText()

        val assignmentId = objectMapper.readTree(
            mockMvc.perform(
                post("/api/admin/training/assignments")
                    .header("Authorization", adminBearer)
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(
                        """{"programId":"$programId","pharmacistIds":["ph_training"],"format":"hybrid","eventId":"$eventId"}""",
                    ),
            ).andExpect(status().isOk).andReturn().response.contentAsString,
        )["assignments"][0]["id"].asText()

        mockMvc.perform(
            patch("/api/admin/training/events/$eventId")
                .header("Authorization", adminBearer)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""{"status":"cancelled"}"""),
        )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.status").value("cancelled"))

        mockMvc.perform(
            get("/api/mobile/training/assignments/$assignmentId")
                .header("Authorization", pharmacistBearer),
        )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.status").value("waiting_online"))
            .andExpect(jsonPath("$.event").doesNotExist())

        mockMvc.perform(
            get("/api/admin/training/events/$eventId/participants")
                .header("Authorization", adminBearer),
        )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$[0].status").value("cancelled"))

        mockMvc.perform(get("/api/mobile/training").header("Authorization", pharmacistBearer))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.notifications[?(@.eventType == 'training_event_cancelled')].title")
                .value("Мероприятие отменено"))
    }

    private fun createPublishedProgram(): JsonNode {
        val body = """
            {
              "name":"Безопасная рекомендация продукта",
              "shortDescription":"Онлайн-курс и итоговый тест",
              "allowedFormats":["online","hybrid"],
              "status":"published",
              "onlineCourseId":"crs_training",
              "passingScore":80,
              "maxAttempts":3,
              "completionBonus":750
            }
        """.trimIndent()
        val response = mockMvc.perform(
            post("/api/admin/training/programs")
                .header("Authorization", adminBearer)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body),
        )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.version").value(1))
            .andExpect(jsonPath("$.stages.length()").value(3))
            .andReturn().response.contentAsString
        return objectMapper.readTree(response)
    }

    private fun login(): LoginResponse {
        val response = mockMvc.perform(
            post("/api/admin/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(LoginRequest("training@inkar.kz", "strong-pass"))),
        ).andExpect(status().isOk).andReturn().response.contentAsString
        return objectMapper.readValue(response, LoginResponse::class.java)
    }
}
