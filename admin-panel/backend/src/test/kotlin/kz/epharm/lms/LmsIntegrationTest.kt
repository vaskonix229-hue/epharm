package kz.epharm.lms

import com.fasterxml.jackson.databind.ObjectMapper
import kz.epharm.auth.domain.AdminRole
import kz.epharm.auth.domain.AdminUserStatus
import kz.epharm.auth.dto.LoginRequest
import kz.epharm.auth.dto.LoginResponse
import kz.epharm.auth.entity.AdminUserEntity
import kz.epharm.auth.repository.AdminUserRepository
import kz.epharm.lms.entity.CourseEntity
import kz.epharm.lms.entity.CourseStatus
import kz.epharm.lms.repository.CourseRepository
import kz.epharm.lms.repository.CourseLessonAttachmentRepository
import kz.epharm.lms.repository.CourseLessonRepository
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
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put
import org.springframework.mock.web.MockMultipartFile
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import org.springframework.transaction.annotation.Transactional
import org.testcontainers.containers.PostgreSQLContainer
import org.testcontainers.junit.jupiter.Container
import org.testcontainers.junit.jupiter.Testcontainers

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Testcontainers
@Transactional
class LmsIntegrationTest {

    companion object {
        @Container
        @JvmStatic
        val postgres: PostgreSQLContainer<*> = PostgreSQLContainer("postgres:16-alpine")
            .withDatabaseName("epharm_test")
            .withUsername("epharm")
            .withPassword("epharm_test")
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
    @Autowired private lateinit var objectMapper: ObjectMapper
    @Autowired private lateinit var courseRepository: CourseRepository
    @Autowired private lateinit var courseLessonRepository: CourseLessonRepository
    @Autowired private lateinit var courseLessonAttachmentRepository: CourseLessonAttachmentRepository
    @Autowired private lateinit var adminUserRepository: AdminUserRepository
    @Autowired private lateinit var passwordEncoder: PasswordEncoder

    private lateinit var bearer: String

    @BeforeEach
    fun seed() {
        courseLessonAttachmentRepository.deleteAll()
        courseLessonRepository.deleteAll()
        courseRepository.deleteAll()
        adminUserRepository.deleteAll()

        courseRepository.save(CourseEntity(id = "crs_pub", title = "Опубликованный", category = "A", lessons = 5, enrolled = 100, completed = 40).also { it.status = CourseStatus.published })
        courseRepository.save(CourseEntity(id = "crs_draft", title = "Черновик", category = "B").also { it.status = CourseStatus.draft })

        adminUserRepository.save(
            AdminUserEntity(email = "damir@jadran.com", passwordHash = passwordEncoder.encode("damir2026"),
                name = "Дамир", company = "Jadran").also { it.role = AdminRole.TRAINING_MANAGER; it.status = AdminUserStatus.ACTIVE },
        )
        bearer = "Bearer " + login().tokens.accessToken
    }

    @Test
    fun `GET courses → 2`() {
        mockMvc.perform(get("/api/admin/lms/courses").header("Authorization", bearer))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.length()").value(2))
    }

    @Test
    fun `GET courses filter status=published`() {
        mockMvc.perform(get("/api/admin/lms/courses?status=published").header("Authorization", bearer))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.length()").value(1))
            .andExpect(jsonPath("$[0].id").value("crs_pub"))
            .andExpect(jsonPath("$[0].enrolled").value(100))
    }

    @Test
    fun `GET unknown course → 404`() {
        mockMvc.perform(get("/api/admin/lms/courses/nope").header("Authorization", bearer))
            .andExpect(status().isNotFound)
            .andExpect(jsonPath("$.code").value("NOT_FOUND"))
    }

    @Test
    fun `POST create course → draft по умолчанию`() {
        val body = """{"title":"Новый курс","lessons":3,"durationMin":20,"bonus":500}"""
        mockMvc.perform(
            post("/api/admin/lms/courses").header("Authorization", bearer)
                .contentType(MediaType.APPLICATION_JSON).content(body),
        )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.title").value("Новый курс"))
            .andExpect(jsonPath("$.status").value("draft"))
            .andExpect(jsonPath("$.lessons").value(3))
    }

    @Test
    fun `POST create без title → 400`() {
        mockMvc.perform(
            post("/api/admin/lms/courses").header("Authorization", bearer)
                .contentType(MediaType.APPLICATION_JSON).content("""{"title":""}"""),
        ).andExpect(status().isBadRequest)
    }

    @Test
    fun `GET без Bearer → 401`() {
        mockMvc.perform(get("/api/admin/lms/courses"))
            .andExpect(status().isUnauthorized)
    }

    // ── CRUD (Блок 2) ────────────────────────────────────────────────────

    @Test
    fun `PATCH course обновляет поля и статус`() {
        mockMvc.perform(
            patch("/api/admin/lms/courses/crs_draft")
                .header("Authorization", bearer)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""{"title":"Опубликован","status":"published","bonus":500}"""),
        )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.title").value("Опубликован"))
            .andExpect(jsonPath("$.status").value("published"))
            .andExpect(jsonPath("$.bonus").value(500))
            .andExpect(jsonPath("$.category").value("B")) // не передан → прежний
    }

    @Test
    fun `PATCH missing course → 404`() {
        mockMvc.perform(
            patch("/api/admin/lms/courses/crs_unknown")
                .header("Authorization", bearer)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""{"bonus":1}"""),
        )
            .andExpect(status().isNotFound)
            .andExpect(jsonPath("$.code").value("NOT_FOUND"))
    }

    @Test
    fun `DELETE course archives it without deleting history`() {
        mockMvc.perform(delete("/api/admin/lms/courses/crs_draft").header("Authorization", bearer))
            .andExpect(status().isNoContent)
        mockMvc.perform(get("/api/admin/lms/courses/crs_draft").header("Authorization", bearer))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.status").value("archived"))
        mockMvc.perform(get("/api/admin/lms/courses?status=archived").header("Authorization", bearer))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$[0].id").value("crs_draft"))
    }

    @Test
    fun `PATCH без Bearer → 401`() {
        mockMvc.perform(
            patch("/api/admin/lms/courses/crs_draft")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""{"bonus":1}"""),
        )
            .andExpect(status().isUnauthorized)
    }

    @Test
    fun `lesson CRUD recalculates course aggregates`() {
        val created = mockMvc.perform(
            post("/api/admin/lms/courses/crs_draft/lessons")
                .header("Authorization", bearer)
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    """{"title":"Первый урок","description":"Введение","content":"Материал","kind":"text","durationMin":12}""",
                ),
        )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.lessons").value(1))
            .andExpect(jsonPath("$.durationMin").value(12))
            .andExpect(jsonPath("$.lessonItems[0].title").value("Первый урок"))
            .andReturn()
        val lessonId = objectMapper.readTree(created.response.contentAsString)
            .path("lessonItems").path(0).path("id").asText()

        mockMvc.perform(
            patch("/api/admin/lms/courses/crs_draft/lessons/$lessonId")
                .header("Authorization", bearer)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""{"title":"Обновлённый урок","durationMin":18}"""),
        )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.durationMin").value(18))
            .andExpect(jsonPath("$.lessonItems[0].title").value("Обновлённый урок"))

        mockMvc.perform(
            delete("/api/admin/lms/courses/crs_draft/lessons/$lessonId")
                .header("Authorization", bearer),
        )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.lessons").value(0))
            .andExpect(jsonPath("$.durationMin").value(0))
            .andExpect(jsonPath("$.lessonItems.length()").value(0))
    }

    @Test
    fun `lesson material settings round-trip through admin API`() {
        val created = mockMvc.perform(
            post("/api/admin/lms/courses/crs_draft/lessons")
                .header("Authorization", bearer)
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    """{"title":"Интерактив","kind":"interactive","externalUrl":"https://learn.example.org/module","required":false,"durationMin":7}""",
                ),
        )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.lessonItems[0].kind").value("interactive"))
            .andExpect(jsonPath("$.lessonItems[0].externalUrl").value("https://learn.example.org/module"))
            .andExpect(jsonPath("$.lessonItems[0].required").value(false))
            .andExpect(jsonPath("$.lessonItems[0].minimumWatchPct").doesNotExist())
            .andReturn()
        val lessonId = objectMapper.readTree(created.response.contentAsString)
            .path("lessonItems").path(0).path("id").asText()

        mockMvc.perform(
            patch("/api/admin/lms/courses/crs_draft/lessons/$lessonId")
                .header("Authorization", bearer)
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    """{"kind":"video","required":true,"minimumWatchPct":85,"externalUrl":""}""",
                ),
        )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.lessonItems[0].kind").value("video"))
            .andExpect(jsonPath("$.lessonItems[0].externalUrl").doesNotExist())
            .andExpect(jsonPath("$.lessonItems[0].required").value(true))
            .andExpect(jsonPath("$.lessonItems[0].minimumWatchPct").value(85))

        mockMvc.perform(
            patch("/api/admin/lms/courses/crs_draft/lessons/$lessonId")
                .header("Authorization", bearer)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""{"minimumWatchPct":101}"""),
        ).andExpect(status().isBadRequest)
    }

    @Test
    fun `video upload and lesson reorder preserve all content`() {
        fun createLesson(title: String): String {
            val result = mockMvc.perform(
                post("/api/admin/lms/courses/crs_draft/lessons")
                    .header("Authorization", bearer)
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("""{"title":"$title","kind":"video","durationMin":5}"""),
            ).andExpect(status().isOk).andReturn()
            val items = objectMapper.readTree(result.response.contentAsString).path("lessonItems")
            return items.path(items.size() - 1).path("id").asText()
        }

        val firstId = createLesson("Первый")
        val secondId = createLesson("Второй")
        val video = MockMultipartFile("file", "lesson.mp4", "video/mp4", byteArrayOf(0, 1, 2, 3))
        mockMvc.perform(
            org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                .multipart("/api/admin/lms/courses/crs_draft/lessons/$firstId/video")
                .file(video)
                .header("Authorization", bearer),
        )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.lessonItems[0].kind").value("video"))
            .andExpect(jsonPath("$.lessonItems[0].videoUrl").isNotEmpty)

        mockMvc.perform(
            put("/api/admin/lms/courses/crs_draft/lessons/reorder")
                .header("Authorization", bearer)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""{"lessonIds":["$secondId","$firstId"]}"""),
        )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.lessonItems[0].id").value(secondId))
            .andExpect(jsonPath("$.lessonItems[1].id").value(firstId))
    }

    @Test
    fun `lesson upload rejects non-video and archived course rejects edits`() {
        val created = mockMvc.perform(
            post("/api/admin/lms/courses/crs_draft/lessons")
                .header("Authorization", bearer)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""{"title":"Видео","kind":"video"}"""),
        ).andExpect(status().isOk).andReturn()
        val lessonId = objectMapper.readTree(created.response.contentAsString)
            .path("lessonItems").path(0).path("id").asText()

        val textFile = MockMultipartFile("file", "lesson.txt", "text/plain", "not video".toByteArray())
        mockMvc.perform(
            org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                .multipart("/api/admin/lms/courses/crs_draft/lessons/$lessonId/video")
                .file(textFile)
                .header("Authorization", bearer),
        )
            .andExpect(status().isBadRequest)
            .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))

        mockMvc.perform(delete("/api/admin/lms/courses/crs_draft").header("Authorization", bearer))
            .andExpect(status().isNoContent)
        mockMvc.perform(
            patch("/api/admin/lms/courses/crs_draft/lessons/$lessonId")
                .header("Authorization", bearer)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""{"title":"Нельзя"}"""),
        )
            .andExpect(status().isConflict)
            .andExpect(jsonPath("$.code").value("CONFLICT"))
    }

    @Test
    fun `lesson attachment upload is returned and can be deleted`() {
        val created = mockMvc.perform(
            post("/api/admin/lms/courses/crs_draft/lessons")
                .header("Authorization", bearer)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""{"title":"Памятка","kind":"text"}"""),
        ).andExpect(status().isOk).andReturn()
        val lessonId = objectMapper.readTree(created.response.contentAsString)
            .path("lessonItems").path(0).path("id").asText()
        val handout = MockMultipartFile(
            "file",
            "handout.pdf",
            "application/pdf",
            "%PDF-1.7 test".toByteArray(),
        )

        val uploaded = mockMvc.perform(
            org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                .multipart("/api/admin/lms/courses/crs_draft/lessons/$lessonId/attachments")
                .file(handout)
                .param("title", "Памятка фармацевта")
                .header("Authorization", bearer),
        )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.lessonItems[0].attachments.length()").value(1))
            .andExpect(jsonPath("$.lessonItems[0].attachments[0].title").value("Памятка фармацевта"))
            .andExpect(jsonPath("$.lessonItems[0].attachments[0].fileName").value("handout.pdf"))
            .andExpect(jsonPath("$.lessonItems[0].attachments[0].kind").value("document"))
            .andReturn()
        val attachmentId = objectMapper.readTree(uploaded.response.contentAsString)
            .path("lessonItems").path(0).path("attachments").path(0).path("id").asText()

        val audio = MockMultipartFile(
            "file",
            "lesson.mp3",
            "audio/mpeg",
            byteArrayOf(0, 1, 2, 3),
        )
        mockMvc.perform(
            org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                .multipart("/api/admin/lms/courses/crs_draft/lessons/$lessonId/attachments")
                .file(audio)
                .param("title", "Аудиоверсия")
                .header("Authorization", bearer),
        )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.lessonItems[0].attachments[1].kind").value("audio"))

        mockMvc.perform(
            delete("/api/admin/lms/courses/crs_draft/lessons/$lessonId/attachments/$attachmentId")
                .header("Authorization", bearer),
        )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.lessonItems[0].attachments.length()").value(1))
            .andExpect(jsonPath("$.lessonItems[0].attachments[0].title").value("Аудиоверсия"))
    }

    @Test
    fun `lesson attachment rejects executable content and requires authentication`() {
        val created = mockMvc.perform(
            post("/api/admin/lms/courses/crs_draft/lessons")
                .header("Authorization", bearer)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""{"title":"Материал","kind":"text"}"""),
        ).andExpect(status().isOk).andReturn()
        val lessonId = objectMapper.readTree(created.response.contentAsString)
            .path("lessonItems").path(0).path("id").asText()
        val executable = MockMultipartFile(
            "file",
            "payload.html",
            "text/html",
            "<script>alert(1)</script>".toByteArray(),
        )

        mockMvc.perform(
            org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                .multipart("/api/admin/lms/courses/crs_draft/lessons/$lessonId/attachments")
                .file(executable)
                .header("Authorization", bearer),
        )
            .andExpect(status().isBadRequest)
            .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))

        val handout = MockMultipartFile("file", "handout.pdf", "application/pdf", "pdf".toByteArray())
        mockMvc.perform(
            org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                .multipart("/api/admin/lms/courses/crs_draft/lessons/$lessonId/attachments")
                .file(handout),
        ).andExpect(status().isUnauthorized)
    }

    private fun login(): LoginResponse {
        val req = LoginRequest(email = "damir@jadran.com", password = "damir2026")
        val result = mockMvc.perform(
            post("/api/admin/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(req)),
        ).andExpect(status().isOk).andReturn()
        return objectMapper.readValue(result.response.contentAsString, LoginResponse::class.java)
    }
}
