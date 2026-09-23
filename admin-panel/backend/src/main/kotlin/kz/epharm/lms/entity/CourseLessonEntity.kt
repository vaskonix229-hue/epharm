package kz.epharm.lms.entity

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.PrePersist
import jakarta.persistence.PreUpdate
import jakarta.persistence.Table
import java.time.Instant

enum class CourseLessonKind {
    text,
    video,
    pdf,
    presentation,
    image,
    audio,
    link,
    interactive,
    quiz,
    test,
    practice,
    assignment,
}

@Entity
@Table(name = "course_lessons")
class CourseLessonEntity(
    @Id
    @Column(nullable = false, length = 64)
    var id: String = "",

    @Column(name = "course_id", nullable = false, length = 64)
    var courseId: String = "",

    @Column(nullable = false)
    var title: String = "",

    @Column(nullable = false, length = 1000)
    var description: String = "",

    @Column(nullable = false, columnDefinition = "TEXT")
    var content: String = "",

    @Column(name = "kind", nullable = false, length = 16)
    var kindRaw: String = CourseLessonKind.text.name,

    @Column(name = "video_url", length = 1000)
    var videoUrl: String? = null,

    @Column(name = "external_url", length = 2000)
    var externalUrl: String? = null,

    @Column(name = "required_lesson", nullable = false)
    var requiredLesson: Boolean = true,

    @Column(name = "minimum_watch_pct")
    var minimumWatchPct: Int? = null,

    @Column(name = "duration_min", nullable = false)
    var durationMin: Int = 0,

    @Column(name = "order_no", nullable = false)
    var order: Int = 0,

    @Column(name = "created_at", nullable = false)
    var createdAt: Instant = Instant.now(),

    @Column(name = "updated_at", nullable = false)
    var updatedAt: Instant = Instant.now(),
) {
    var kind: CourseLessonKind
        get() = CourseLessonKind.valueOf(kindRaw)
        set(value) { kindRaw = value.name }

    @PrePersist
    fun onCreate() {
        val now = Instant.now()
        createdAt = now
        updatedAt = now
    }

    @PreUpdate
    fun onUpdate() {
        updatedAt = Instant.now()
    }
}
