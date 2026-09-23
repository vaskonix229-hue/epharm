package kz.epharm.lms.service

import kz.epharm.lms.dto.CourseDto
import kz.epharm.lms.dto.CourseLessonDto
import kz.epharm.lms.dto.CreateCourseLessonRequest
import kz.epharm.lms.dto.CreateCourseRequest
import kz.epharm.lms.dto.ReorderCourseLessonsRequest
import kz.epharm.lms.dto.UpdateCourseLessonRequest
import kz.epharm.lms.dto.UpdateCourseRequest
import kz.epharm.lms.entity.CourseEntity
import kz.epharm.lms.entity.CourseLessonAttachmentEntity
import kz.epharm.lms.entity.CourseLessonEntity
import kz.epharm.lms.entity.CourseLessonKind
import kz.epharm.lms.entity.CourseStatus
import kz.epharm.lms.repository.CourseLessonRepository
import kz.epharm.lms.repository.CourseLessonAttachmentRepository
import kz.epharm.lms.repository.CourseRepository
import kz.epharm.shared.error.AppException
import kz.epharm.shared.error.ErrorCode
import kz.epharm.shared.storage.MediaStorage
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.transaction.support.TransactionSynchronization
import org.springframework.transaction.support.TransactionSynchronizationManager
import org.springframework.web.multipart.MultipartFile
import java.util.UUID

@Service
class CourseService(
    private val courseRepository: CourseRepository,
    private val lessonRepository: CourseLessonRepository,
    private val attachmentRepository: CourseLessonAttachmentRepository,
    private val mediaStorage: MediaStorage,
) {

    @Transactional(readOnly = true)
    fun list(status: CourseStatus? = null): List<CourseDto> {
        val rows = if (status != null) {
            courseRepository.findAllByStatusRawOrderByUpdatedAtDesc(status.name)
        } else {
            courseRepository.findAllByOrderByUpdatedAtDesc()
        }
        if (rows.isEmpty()) return emptyList()
        val allLessons = lessonRepository
            .findAllByCourseIdInOrderByCourseIdAscOrderAscCreatedAtAsc(rows.map { it.id })
        val lessonsByCourse = allLessons.groupBy { it.courseId }
        val attachmentsByLesson = attachmentsByLesson(allLessons)
        return rows.map {
            CourseDto.of(it, lessonsByCourse[it.id].orEmpty(), attachmentsByLesson)
        }
    }

    @Transactional(readOnly = true)
    fun get(id: String): CourseDto {
        val course = loadOrThrow(id)
        val rows = lessons(id)
        return CourseDto.of(course, rows, attachmentsByLesson(rows))
    }

    @Transactional
    fun create(req: CreateCourseRequest, createdBy: String): CourseDto {
        val entity = CourseEntity(
            id = "crs_${UUID.randomUUID().toString().replace("-", "").take(12)}",
            title = req.title.trim(),
            description = req.description.trim(),
            category = req.category.trim(),
            lessons = req.lessons,
            durationMin = req.durationMin,
            bonus = req.bonus,
            createdBy = createdBy,
        ).also { it.status = req.status ?: CourseStatus.draft }
        return CourseDto.of(courseRepository.save(entity))
    }

    @Transactional
    fun update(id: String, req: UpdateCourseRequest): CourseDto {
        val entity = editableCourse(id)
        req.title?.let {
            if (it.isBlank()) invalid("Название курса обязательно")
            entity.title = it.trim()
        }
        req.status?.let { entity.status = it }
        req.category?.let { entity.category = it.trim() }
        req.description?.let { entity.description = it.trim() }
        val structuredLessons = lessons(id)
        if (structuredLessons.isNotEmpty() && (req.lessons != null || req.durationMin != null)) {
            invalid("Количество уроков и длительность курса рассчитываются автоматически")
        }
        req.lessons?.let { entity.lessons = it }
        req.durationMin?.let { entity.durationMin = it }
        req.bonus?.let { entity.bonus = it }
        courseRepository.save(entity)
        return get(id)
    }

    @Transactional
    fun delete(id: String) {
        val entity = loadOrThrow(id)
        entity.status = CourseStatus.archived
        courseRepository.save(entity)
    }

    @Transactional
    fun createLesson(courseId: String, req: CreateCourseLessonRequest): CourseDto {
        editableCourse(courseId)
        val current = lessons(courseId)
        val lesson = CourseLessonEntity(
            id = "cls_${UUID.randomUUID().toString().replace("-", "").take(16)}",
            courseId = courseId,
            title = req.title.trim(),
            description = req.description.trim(),
            content = req.content.trim(),
            externalUrl = req.externalUrl?.trim()?.takeIf(String::isNotEmpty),
            requiredLesson = req.required,
            minimumWatchPct = req.minimumWatchPct.takeIf { req.kind == CourseLessonKind.video },
            durationMin = req.durationMin,
            order = current.size,
        ).also { it.kind = req.kind }
        lessonRepository.save(lesson)
        syncAggregates(courseId)
        return get(courseId)
    }

    @Transactional
    fun updateLesson(courseId: String, lessonId: String, req: UpdateCourseLessonRequest): CourseDto {
        editableCourse(courseId)
        val lesson = loadLessonOrThrow(courseId, lessonId)
        req.title?.let {
            if (it.isBlank()) invalid("Название урока обязательно")
            lesson.title = it.trim()
        }
        req.description?.let { lesson.description = it.trim() }
        req.content?.let { lesson.content = it.trim() }
        req.externalUrl?.let { lesson.externalUrl = it.trim().takeIf(String::isNotEmpty) }
        req.required?.let { lesson.requiredLesson = it }
        if (req.clearMinimumWatchPct) lesson.minimumWatchPct = null
        req.minimumWatchPct?.let { lesson.minimumWatchPct = it }
        req.durationMin?.let { lesson.durationMin = it }

        var obsoleteVideo: String? = null
        if (req.clearVideo || (req.kind != null && req.kind != CourseLessonKind.video)) {
            obsoleteVideo = lesson.videoUrl
            lesson.videoUrl = null
        }
        req.kind?.let {
            lesson.kind = it
            if (it != CourseLessonKind.video) lesson.minimumWatchPct = null
        }
        lessonRepository.save(lesson)
        syncAggregates(courseId)
        obsoleteVideo?.let(::registerAfterCommitCleanup)
        return get(courseId)
    }

    @Transactional
    fun deleteLesson(courseId: String, lessonId: String): CourseDto {
        editableCourse(courseId)
        val lesson = loadLessonOrThrow(courseId, lessonId)
        val obsoleteVideo = lesson.videoUrl
        val obsoleteAttachments = attachmentRepository
            .findAllByLessonIdOrderByCreatedAtAsc(lessonId)
            .map { it.mediaUrl }
        lessonRepository.delete(lesson)
        lessons(courseId).filter { it.id != lessonId }.forEachIndexed { index, row ->
            if (row.order != index) {
                row.order = index
                lessonRepository.save(row)
            }
        }
        syncAggregates(courseId)
        obsoleteVideo?.let(::registerAfterCommitCleanup)
        obsoleteAttachments.forEach(::registerAfterCommitCleanup)
        return get(courseId)
    }

    @Transactional
    fun reorderLessons(courseId: String, req: ReorderCourseLessonsRequest): CourseDto {
        editableCourse(courseId)
        val current = lessons(courseId)
        val expected = current.map { it.id }.toSet()
        if (req.lessonIds.size != expected.size || req.lessonIds.toSet() != expected) {
            invalid("Передайте каждый урок курса ровно один раз")
        }
        val byId = current.associateBy { it.id }
        req.lessonIds.forEachIndexed { index, lessonId ->
            val lesson = byId.getValue(lessonId)
            if (lesson.order != index) {
                lesson.order = index
                lessonRepository.save(lesson)
            }
        }
        return get(courseId)
    }

    @Transactional
    fun uploadLessonVideo(courseId: String, lessonId: String, file: MultipartFile): CourseDto {
        editableCourse(courseId)
        val lesson = loadLessonOrThrow(courseId, lessonId)
        validateVideo(file)
        val contentType = file.contentType.orEmpty().ifBlank { "application/octet-stream" }
        val newUrl = mediaStorage.upload(file.bytes, contentType, file.originalFilename ?: "lesson.mp4")
        registerRollbackCleanup(newUrl)
        val previousUrl = lesson.videoUrl
        lesson.videoUrl = newUrl
        lesson.kind = CourseLessonKind.video
        lessonRepository.save(lesson)
        previousUrl?.takeIf { it != newUrl }?.let(::registerAfterCommitCleanup)
        return get(courseId)
    }

    @Transactional
    fun uploadLessonAttachment(
        courseId: String,
        lessonId: String,
        file: MultipartFile,
        title: String,
    ): CourseDto {
        editableCourse(courseId)
        loadLessonOrThrow(courseId, lessonId)
        validateAttachment(file)
        val fileName = file.originalFilename.orEmpty()
            .substringAfterLast('/')
            .substringAfterLast('\\')
            .take(255)
            .ifBlank { "material" }
        val contentType = file.contentType.orEmpty().lowercase()
            .ifBlank { "application/octet-stream" }
        val url = mediaStorage.upload(file.bytes, contentType, fileName)
        registerRollbackCleanup(url)
        attachmentRepository.save(
            CourseLessonAttachmentEntity(
                id = "cla_${UUID.randomUUID().toString().replace("-", "").take(16)}",
                lessonId = lessonId,
                title = title.trim().take(255).ifBlank { fileName },
                fileName = fileName,
                contentType = contentType,
                mediaUrl = url,
                sizeBytes = file.size,
            ),
        )
        return get(courseId)
    }

    @Transactional
    fun deleteLessonAttachment(courseId: String, lessonId: String, attachmentId: String): CourseDto {
        editableCourse(courseId)
        loadLessonOrThrow(courseId, lessonId)
        val attachment = attachmentRepository.findById(attachmentId).orElse(null)
            ?.takeIf { it.lessonId == lessonId }
            ?: throw AppException(ErrorCode.NOT_FOUND, "Материал не найден", HttpStatus.NOT_FOUND)
        attachmentRepository.delete(attachment)
        registerAfterCommitCleanup(attachment.mediaUrl)
        return get(courseId)
    }

    private fun syncAggregates(courseId: String) {
        val course = loadOrThrow(courseId)
        val rows = lessons(courseId)
        course.lessons = rows.size
        course.durationMin = rows.sumOf { it.durationMin }
        courseRepository.save(course)
    }

    private fun lessons(courseId: String): List<CourseLessonEntity> =
        lessonRepository.findAllByCourseIdOrderByOrderAscCreatedAtAsc(courseId)

    private fun attachmentsByLesson(
        lessons: List<CourseLessonEntity>,
    ): Map<String, List<CourseLessonAttachmentEntity>> = if (lessons.isEmpty()) {
        emptyMap()
    } else {
        attachmentRepository
            .findAllByLessonIdInOrderByLessonIdAscCreatedAtAsc(lessons.map { it.id })
            .groupBy { it.lessonId }
    }

    private fun editableCourse(id: String): CourseEntity = loadOrThrow(id).also {
        if (it.status == CourseStatus.archived) {
            throw AppException(ErrorCode.CONFLICT, "Архивный курс нельзя редактировать", HttpStatus.CONFLICT)
        }
    }

    private fun loadOrThrow(id: String): CourseEntity =
        courseRepository.findById(id).orElseThrow {
            AppException(ErrorCode.NOT_FOUND, "Course $id not found", HttpStatus.NOT_FOUND)
        }

    private fun loadLessonOrThrow(courseId: String, lessonId: String): CourseLessonEntity =
        lessonRepository.findById(lessonId).orElse(null)
            ?.takeIf { it.courseId == courseId }
            ?: throw AppException(ErrorCode.NOT_FOUND, "Урок не найден", HttpStatus.NOT_FOUND)

    private fun validateVideo(file: MultipartFile) {
        if (file.isEmpty) invalid("Видеофайл пуст")
        if (file.size > MAX_VIDEO_BYTES) invalid("Размер видео не должен превышать 60 МБ")
        val extension = file.originalFilename.orEmpty().substringAfterLast('.', "").lowercase()
        val contentType = file.contentType.orEmpty().lowercase()
        val validType = contentType in SUPPORTED_VIDEO_TYPES ||
            (contentType == "application/octet-stream" && extension in SUPPORTED_VIDEO_EXTENSIONS)
        if (!validType || extension !in SUPPORTED_VIDEO_EXTENSIONS) {
            invalid("Поддерживаются только MP4 и WebM")
        }
    }

    private fun validateAttachment(file: MultipartFile) {
        if (file.isEmpty) invalid("Файл пуст")
        if (file.size > MAX_ATTACHMENT_BYTES) invalid("Размер материала не должен превышать 25 МБ")
        val extension = file.originalFilename.orEmpty().substringAfterLast('.', "").lowercase()
        val contentType = file.contentType.orEmpty().lowercase()
        if (extension !in SUPPORTED_ATTACHMENT_EXTENSIONS ||
            (contentType.isNotBlank() && contentType !in SUPPORTED_ATTACHMENT_TYPES)
        ) {
            invalid("Поддерживаются изображения, аудио, PDF, Word, Excel, PowerPoint и текстовые файлы")
        }
    }

    private fun registerRollbackCleanup(newUrl: String) {
        if (!TransactionSynchronizationManager.isSynchronizationActive()) return
        TransactionSynchronizationManager.registerSynchronization(object : TransactionSynchronization {
            override fun afterCompletion(status: Int) {
                if (status != TransactionSynchronization.STATUS_COMMITTED) mediaStorage.delete(newUrl)
            }
        })
    }

    private fun registerAfterCommitCleanup(url: String) {
        if (!TransactionSynchronizationManager.isSynchronizationActive()) {
            mediaStorage.delete(url)
            return
        }
        TransactionSynchronizationManager.registerSynchronization(object : TransactionSynchronization {
            override fun afterCommit() = mediaStorage.delete(url)
        })
    }

    private fun invalid(message: String): Nothing =
        throw AppException(ErrorCode.VALIDATION_FAILED, message, HttpStatus.BAD_REQUEST)

    private companion object {
        const val MAX_VIDEO_BYTES = 60L * 1024 * 1024
        const val MAX_ATTACHMENT_BYTES = 25L * 1024 * 1024
        val SUPPORTED_VIDEO_TYPES = setOf("video/mp4", "video/webm")
        val SUPPORTED_VIDEO_EXTENSIONS = setOf("mp4", "webm")
        val SUPPORTED_ATTACHMENT_EXTENSIONS = setOf(
            "jpg", "jpeg", "png", "webp", "gif", "pdf", "doc", "docx",
            "xls", "xlsx", "ppt", "pptx", "txt", "csv", "mp3", "m4a", "aac", "wav", "ogg",
        )
        val SUPPORTED_ATTACHMENT_TYPES = setOf(
            "image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf",
            "application/msword",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/vnd.ms-excel",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "application/vnd.ms-powerpoint",
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "text/plain", "text/csv", "audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/aac",
            "audio/wav", "audio/x-wav", "audio/ogg", "application/ogg", "application/octet-stream",
        )
    }
}
