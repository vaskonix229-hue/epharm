ALTER TABLE course_lessons
    ADD COLUMN external_url VARCHAR(2000),
    ADD COLUMN required_lesson BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN minimum_watch_pct INT;

ALTER TABLE course_lessons
    DROP CONSTRAINT ck_course_lessons_kind,
    ADD CONSTRAINT ck_course_lessons_kind CHECK (
        kind IN (
            'text', 'video', 'pdf', 'presentation', 'image', 'audio',
            'link', 'interactive', 'quiz', 'test', 'practice', 'assignment'
        )
    ),
    ADD CONSTRAINT ck_course_lessons_minimum_watch_pct CHECK (
        minimum_watch_pct IS NULL OR minimum_watch_pct BETWEEN 0 AND 100
    );
