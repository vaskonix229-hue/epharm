package kz.epharm.lms.dto

import jakarta.validation.constraints.Max
import jakarta.validation.constraints.Min
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.NotEmpty
import jakarta.validation.constraints.Size
import kz.epharm.lms.entity.CourseEntity
import kz.epharm.lms.entity.CourseLessonAttachmentEntity
import kz.epharm.lms.entity.CourseLessonEntity
import kz.epharm.lms.entity.CourseLessonKind
import kz.epharm.lms.entity.CourseStatus
import java.time.Instant

data class CourseLessonDto(
    val id: String,
    val title: String,
    val description: String,
    val content: String,
    val kind: CourseLessonKind,
    val videoUrl: String?,
    val externalUrl: String?,
    val required: Boolean,
    val minimumWatchPct: Int?,
    val attachments: List<CourseLessonAttachmentDto>,
    val durationMin: Int,
    val order: Int,
    val createdAt: Instant,
    val updatedAt: Instant,
) {
    companion object {
        fun of(
            entity: CourseLessonEntity,
            attachments: List<CourseLessonAttachmentEntity> = emptyList(),
        ): CourseLessonDto = CourseLessonDto(
            id = entity.id,
            title = entity.title,
            description = entity.description,
            content = entity.content,
            kind = entity.kind,
            videoUrl = entity.videoUrl,
            externalUrl = entity.externalUrl,
            required = entity.requiredLesson,
            minimumWatchPct = entity.minimumWatchPct,
            attachments = attachments.map(CourseLessonAttachmentDto::of),
            durationMin = entity.durationMin,
            order = entity.order,
            createdAt = entity.createdAt,
            updatedAt = entity.updatedAt,
        )
    }
}

data class CourseLessonAttachmentDto(
    val id: String,
    val title: String,
    val fileName: String,
    val contentType: String,
    val mediaUrl: String,
    val sizeBytes: Long,
    val createdAt: Instant,
) {
    val kind: String
        get() = when {
            contentType.startsWith("image/") -> "image"
            contentType.startsWith("video/") -> "video"
            contentType.startsWith("audio/") -> "audio"
            else -> "document"
        }

    companion object {
        fun of(entity: CourseLessonAttachmentEntity): CourseLessonAttachmentDto =
            CourseLessonAttachmentDto(
                id = entity.id,
                title = entity.title,
                fileName = entity.fileName,
                contentType = entity.contentType,
                mediaUrl = entity.mediaUrl,
                sizeBytes = entity.sizeBytes,
                createdAt = entity.createdAt,
            )
    }
}

/** Compact course payload embedded into a pharmacist's online-course stage. */
data class CourseContentDto(
    val id: String,
    val title: String,
    val description: String,
    val durationMin: Int,
    val lessons: List<CourseLessonDto>,
) {
    companion object {
        fun of(
            entity: CourseEntity,
            lessons: List<CourseLessonEntity>,
            attachmentsByLesson: Map<String, List<CourseLessonAttachmentEntity>> = emptyMap(),
        ): CourseContentDto = CourseContentDto(
            id = entity.id,
            title = entity.title,
            description = entity.description,
            durationMin = if (lessons.isEmpty()) entity.durationMin else lessons.sumOf { it.durationMin },
            lessons = lessons.map { CourseLessonDto.of(it, attachmentsByLesson[it.id].orEmpty()) },
        )
    }
}

data class CourseDto(
    val id: String,
    val title: String,
    val description: String,
    val status: CourseStatus,
    val category: String,
    val lessons: Int,
    val durationMin: Int,
    val enrolled: Int,
    val completed: Int,
    val bonus: Int,
    val lessonItems: List<CourseLessonDto>,
    val createdAt: Instant,
    val updatedAt: Instant,
) {
    companion object {
        fun of(
            e: CourseEntity,
            lessons: List<CourseLessonEntity> = emptyList(),
            attachmentsByLesson: Map<String, List<CourseLessonAttachmentEntity>> = emptyMap(),
        ): CourseDto = CourseDto(
            id = e.id,
            title = e.title,
            description = e.description,
            status = e.status,
            category = e.category,
            lessons = e.lessons,
            durationMin = e.durationMin,
            enrolled = e.enrolled,
            completed = e.completed,
            bonus = e.bonus,
            lessonItems = lessons.map { CourseLessonDto.of(it, attachmentsByLesson[it.id].orEmpty()) },
            createdAt = e.createdAt,
            updatedAt = e.updatedAt,
        )
    }
}

data class CreateCourseRequest(
    @field:NotBlank
    @field:Size(max = 255)
    val title: String,
    val status: CourseStatus? = CourseStatus.draft,
    @field:Size(max = 128)
    val category: String = "",
    @field:Size(max = 10_000)
    val description: String = "",
    @field:Min(0)
    val lessons: Int = 0,
    @field:Min(0)
    val durationMin: Int = 0,
    @field:Min(0)
    val bonus: Int = 0,
)

/**
 * Partial-update (PATCH). Метрики enrolled/completed не патчатся вручную (ETL).
 * Статус включая archived разрешён — у курсов нет dedicated /archive endpoint'а.
 */
data class UpdateCourseRequest(
    @field:Size(max = 255)
    val title: String? = null,
    val status: CourseStatus? = null,
    @field:Size(max = 128)
    val category: String? = null,
    @field:Size(max = 10_000)
    val description: String? = null,
    @field:Min(0)
    val lessons: Int? = null,
    @field:Min(0)
    val durationMin: Int? = null,
    @field:Min(0)
    val bonus: Int? = null,
)

data class CreateCourseLessonRequest(
    @field:NotBlank
    @field:Size(max = 255)
    val title: String,
    @field:Size(max = 1000)
    val description: String = "",
    @field:Size(max = 50_000)
    val content: String = "",
    val kind: CourseLessonKind = CourseLessonKind.text,
    @field:Size(max = 2000)
    val externalUrl: String? = null,
    val required: Boolean = true,
    @field:Min(0)
    @field:Max(100)
    val minimumWatchPct: Int? = null,
    @field:Min(0)
    val durationMin: Int = 0,
)

data class UpdateCourseLessonRequest(
    @field:Size(max = 255)
    val title: String? = null,
    @field:Size(max = 1000)
    val description: String? = null,
    @field:Size(max = 50_000)
    val content: String? = null,
    val kind: CourseLessonKind? = null,
    @field:Size(max = 2000)
    val externalUrl: String? = null,
    val required: Boolean? = null,
    @field:Min(0)
    @field:Max(100)
    val minimumWatchPct: Int? = null,
    val clearMinimumWatchPct: Boolean = false,
    @field:Min(0)
    val durationMin: Int? = null,
    val clearVideo: Boolean = false,
)

data class ReorderCourseLessonsRequest(
    @field:NotEmpty
    val lessonIds: List<@NotBlank String>,
)
