import { useMemo, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  Clock3,
  FileText,
  Image,
  Paperclip,
  Pencil,
  PlayCircle,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react'
import { Button, Drawer, Empty, Field, IconButton, Input, Modal, Select, Toggle, useToast } from '@/ui'
import type { CourseDto, CourseLessonDto, CourseLessonKind, CourseStatus } from '@/lib/api-types'
import {
  useCourse,
  useCreateCourseLesson,
  useDeleteCourseLesson,
  useDeleteCourseLessonAttachment,
  useReorderCourseLessons,
  useUpdateCourse,
  useUpdateCourseLesson,
  useUploadCourseLessonVideo,
  useUploadCourseLessonAttachment,
} from '@/lib/queries/lms'
import { describeError } from '@/lib/describeError'

const lessonKindOptions: { value: CourseLessonKind; label: string }[] = [
  { value: 'text', label: 'Текстовый материал' },
  { value: 'video', label: 'Видеоурок' },
  { value: 'pdf', label: 'PDF' },
  { value: 'presentation', label: 'Презентация' },
  { value: 'image', label: 'Изображение' },
  { value: 'audio', label: 'Аудио' },
  { value: 'link', label: 'Внешняя ссылка' },
  { value: 'interactive', label: 'Интерактив' },
  { value: 'quiz', label: 'Внешний тест' },
  { value: 'practice', label: 'Практическое задание' },
]

function lessonKindLabel(kind: CourseLessonKind) {
  return lessonKindOptions.find((option) => option.value === kind)?.label ?? 'Материал'
}

interface CourseEditorDrawerProps {
  courseId: string | null
  fallbackCourse?: CourseDto
  canManage: boolean
  onClose: () => void
}

export function CourseEditorDrawer({
  courseId,
  fallbackCourse,
  canManage,
  onClose,
}: CourseEditorDrawerProps) {
  const toast = useToast()
  const detail = useCourse(courseId)
  const course = detail.data ?? fallbackCourse
  const updateCourse = useUpdateCourse()
  const removeLesson = useDeleteCourseLesson()
  const reorder = useReorderCourseLessons()
  const [lessonTarget, setLessonTarget] = useState<CourseLessonDto | 'new' | null>(null)
  const [title, setTitle] = useState(fallbackCourse?.title ?? '')
  const [category, setCategory] = useState(fallbackCourse?.category ?? '')
  const [description, setDescription] = useState(fallbackCourse?.description ?? '')
  const [bonus, setBonus] = useState(String(fallbackCourse?.bonus ?? 0))
  const [status, setStatus] = useState<CourseStatus>(fallbackCourse?.status ?? 'draft')
  const [metadataError, setMetadataError] = useState<string | null>(null)

  const editable = canManage && course?.status !== 'archived'
  const lessons = useMemo(
    () => [...(course?.lessonItems ?? [])].sort((a, b) => a.order - b.order),
    [course?.lessonItems],
  )

  const saveMetadata = () => {
    if (!course || !title.trim()) {
      setMetadataError('Введите название курса')
      return
    }
    setMetadataError(null)
    updateCourse.mutate(
      {
        id: course.id,
        patch: {
          title: title.trim(),
          category: category.trim(),
          description: description.trim(),
          bonus: Number(bonus) || 0,
          status,
        },
      },
      {
        onSuccess: () => toast.push('Курс сохранён'),
        onError: (error) => setMetadataError(describeError(error)),
      },
    )
  }

  const moveLesson = (index: number, direction: -1 | 1) => {
    if (!course) return
    const nextIndex = index + direction
    if (nextIndex < 0 || nextIndex >= lessons.length) return
    const lessonIds = lessons.map((lesson) => lesson.id)
    ;[lessonIds[index], lessonIds[nextIndex]] = [lessonIds[nextIndex], lessonIds[index]]
    reorder.mutate(
      { courseId: course.id, lessonIds },
      { onError: (error) => toast.push(describeError(error)) },
    )
  }

  return (
    <>
      <Drawer
        open={!!courseId}
        onClose={onClose}
        width={760}
        title={course?.title ?? 'Онлайн-курс'}
        subtitle={editable ? 'Содержание и настройки курса' : 'Просмотр содержания курса'}
        footer={
          editable ? (
            <Button disabled={updateCourse.isPending} onClick={saveMetadata}>
              {updateCourse.isPending ? 'Сохраняем…' : 'Сохранить курс'}
            </Button>
          ) : undefined
        }
      >
        {!course ? (
          <div className="py-16 text-center text-[13px] text-ink-500">
            {detail.isError ? 'Не удалось загрузить курс' : 'Загружаем курс…'}
          </div>
        ) : (
          <div className="flex flex-col gap-6" data-testid="course-editor">
            <section className="grid gap-3 border-b border-ink-100 pb-6">
              {metadataError && <ErrorBanner message={metadataError} />}
              <Field label="Название">
                <Input
                  value={title}
                  disabled={!editable}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </Field>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field label="Категория" optional>
                  <Input
                    value={category}
                    disabled={!editable}
                    onChange={(event) => setCategory(event.target.value)}
                  />
                </Field>
                <Field label="Бонус, ₸">
                  <Input
                    type="number"
                    min={0}
                    value={bonus}
                    disabled={!editable}
                    onChange={(event) => setBonus(event.target.value)}
                  />
                </Field>
                <Field label="Статус">
                  <Select
                    value={status}
                    disabled={!editable}
                    onChange={(value) => setStatus(value as CourseStatus)}
                    options={[
                      { value: 'draft', label: 'Черновик' },
                      { value: 'published', label: 'Опубликован' },
                      ...(status === 'archived' ? [{ value: 'archived', label: 'Архив' }] : []),
                    ]}
                  />
                </Field>
              </div>
              <Field label="Описание" optional>
                <textarea
                  className="inp min-h-24"
                  value={description}
                  disabled={!editable}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </Field>
            </section>

            <section>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-[15px] font-extrabold text-ink-900">Уроки</h3>
                  <div className="mt-0.5 flex gap-3 text-[12px] text-ink-500">
                    <span className="inline-flex items-center gap-1">
                      <BookOpen size={14} /> {course.lessons}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Clock3 size={14} /> {course.durationMin} мин.
                    </span>
                  </div>
                </div>
                {editable && (
                  <Button
                    size="sm"
                    variant="outline"
                    leading={<Plus size={15} />}
                    onClick={() => setLessonTarget('new')}
                  >
                    Добавить урок
                  </Button>
                )}
              </div>

              {lessons.length === 0 ? (
                <Empty
                  title="В курсе пока нет уроков"
                  body={
                    course.lessons > 0
                      ? `Старые данные курса содержат счётчик ${course.lessons}, но содержимое ещё не перенесено в редактор.`
                      : 'Добавьте текстовый материал или видеоурок.'
                  }
                  icon={<BookOpen size={26} />}
                  action={
                    editable ? (
                      <Button size="sm" onClick={() => setLessonTarget('new')}>
                        Добавить урок
                      </Button>
                    ) : undefined
                  }
                />
              ) : (
                <div className="divide-y divide-ink-100 border-y border-ink-100">
                  {lessons.map((lesson, index) => (
                    <article key={lesson.id} className="py-4">
                      <div className="flex items-start gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-paper-hover text-ink-600">
                          {lesson.kind === 'video' ? (
                            <PlayCircle size={18} />
                          ) : (
                            <FileText size={18} />
                          )}
                        </div>
                        <button
                          type="button"
                          className="min-w-0 flex-1 text-left"
                          onClick={() => setLessonTarget(lesson)}
                        >
                          <div className="font-bold text-ink-900">
                            {index + 1}. {lesson.title}
                          </div>
                          <div className="mt-0.5 text-[12px] text-ink-500">
                            {lessonKindLabel(lesson.kind)} · {lesson.durationMin} мин.
                          </div>
                          {lesson.description && (
                            <p className="mt-2 line-clamp-2 text-[12px] leading-5 text-ink-600">
                              {lesson.description}
                            </p>
                          )}
                          {(lesson.attachments?.length ?? 0) > 0 && (
                            <div className="mt-2 inline-flex items-center gap-1 text-[12px] font-semibold text-brand-green-700">
                              <Paperclip size={13} /> {lesson.attachments.length} вложений
                            </div>
                          )}
                        </button>
                        <div className="flex shrink-0 items-center gap-0.5">
                          {editable && (
                            <>
                              <IconButton
                                tip="Выше"
                                aria-label={`Переместить урок ${lesson.title} выше`}
                                disabled={index === 0 || reorder.isPending}
                                onClick={() => moveLesson(index, -1)}
                              >
                                <ArrowUp size={16} />
                              </IconButton>
                              <IconButton
                                tip="Ниже"
                                aria-label={`Переместить урок ${lesson.title} ниже`}
                                disabled={index === lessons.length - 1 || reorder.isPending}
                                onClick={() => moveLesson(index, 1)}
                              >
                                <ArrowDown size={16} />
                              </IconButton>
                              <IconButton
                                tip="Редактировать"
                                aria-label={`Редактировать урок ${lesson.title}`}
                                onClick={() => setLessonTarget(lesson)}
                              >
                                <Pencil size={16} />
                              </IconButton>
                              <IconButton
                                tip="Удалить"
                                aria-label={`Удалить урок ${lesson.title}`}
                                disabled={removeLesson.isPending}
                                onClick={() => {
                                  if (!confirm(`Удалить урок «${lesson.title}»?`)) return
                                  removeLesson.mutate(
                                    { courseId: course.id, lessonId: lesson.id },
                                    {
                                      onSuccess: () => toast.push('Урок удалён'),
                                      onError: (error) => toast.push(describeError(error)),
                                    },
                                  )
                                }}
                              >
                                <Trash2 size={16} />
                              </IconButton>
                            </>
                          )}
                        </div>
                      </div>
                      {lesson.videoUrl && (
                        <video
                          controls
                          preload="metadata"
                          className="mt-3 aspect-video w-full rounded-md bg-ink-900"
                          src={lesson.videoUrl}
                        />
                      )}
                      {lesson.content && (
                        <div className="mt-3 whitespace-pre-wrap text-[13px] leading-6 text-ink-700">
                          {lesson.content}
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </Drawer>

      {course && lessonTarget && (
        <LessonEditorModal
          key={lessonTarget === 'new' ? `new-${course.id}` : lessonTarget.id}
          course={course}
          lesson={lessonTarget === 'new' ? null : lessonTarget}
          canManage={editable}
          onClose={() => setLessonTarget(null)}
        />
      )}
    </>
  )
}

function LessonEditorModal({
  course,
  lesson,
  canManage,
  onClose,
}: {
  course: CourseDto
  lesson: CourseLessonDto | null
  canManage: boolean
  onClose: () => void
}) {
  const toast = useToast()
  const create = useCreateCourseLesson()
  const update = useUpdateCourseLesson()
  const upload = useUploadCourseLessonVideo()
  const uploadAttachment = useUploadCourseLessonAttachment()
  const deleteAttachment = useDeleteCourseLessonAttachment()
  const [title, setTitle] = useState(lesson?.title ?? '')
  const [description, setDescription] = useState(lesson?.description ?? '')
  const [content, setContent] = useState(lesson?.content ?? '')
  const [kind, setKind] = useState<CourseLessonKind>(lesson?.kind ?? 'text')
  const [externalUrl, setExternalUrl] = useState(lesson?.externalUrl ?? '')
  const [requiredLesson, setRequiredLesson] = useState(lesson?.required ?? true)
  const [minimumWatchPct, setMinimumWatchPct] = useState(
    lesson?.minimumWatchPct == null ? '' : String(lesson.minimumWatchPct),
  )
  const [durationMin, setDurationMin] = useState(String(lesson?.durationMin ?? 0))
  const [file, setFile] = useState<File | null>(null)
  const [attachmentFiles, setAttachmentFiles] = useState<File[]>([])
  const [persistedId, setPersistedId] = useState(lesson?.id ?? null)
  const [error, setError] = useState<string | null>(null)
  const pending =
    create.isPending ||
    update.isPending ||
    upload.isPending ||
    uploadAttachment.isPending ||
    deleteAttachment.isPending

  const submit = async () => {
    if (!canManage) return
    if (!title.trim()) return setError('Введите название урока')
    if (file && file.size > 60 * 1024 * 1024)
      return setError('Размер видео не должен превышать 60 МБ')
    if (attachmentFiles.some((attachment) => attachment.size > 25 * 1024 * 1024))
      return setError('Размер каждого вложения не должен превышать 25 МБ')
    const parsedMinimumWatchPct = minimumWatchPct === '' ? null : Number(minimumWatchPct)
    if (
      kind === 'video' &&
      parsedMinimumWatchPct != null &&
      (!Number.isInteger(parsedMinimumWatchPct) ||
        parsedMinimumWatchPct < 0 ||
        parsedMinimumWatchPct > 100)
    ) {
      return setError('Минимальный просмотр должен быть целым числом от 0 до 100')
    }
    setError(null)
    try {
      let lessonId = persistedId
      const payload = {
        title: title.trim(),
        description: description.trim(),
        content: content.trim(),
        kind,
        externalUrl: externalUrl.trim(),
        required: requiredLesson,
        minimumWatchPct:
          kind === 'video' && parsedMinimumWatchPct != null ? parsedMinimumWatchPct : undefined,
        durationMin: Number(durationMin) || 0,
      }
      if (lessonId) {
        await update.mutateAsync({
          courseId: course.id,
          lessonId,
          patch: {
            ...payload,
            clearVideo: kind !== 'video',
            clearMinimumWatchPct: kind !== 'video' || minimumWatchPct === '',
          },
        })
      } else {
        const saved = await create.mutateAsync({ courseId: course.id, lesson: payload })
        lessonId = saved.lessonItems.at(-1)?.id ?? null
        if (!lessonId) throw new Error('Backend не вернул созданный урок')
        setPersistedId(lessonId)
      }
      if (kind === 'video' && file) {
        await upload.mutateAsync({ courseId: course.id, lessonId, file })
      }
      for (const attachment of attachmentFiles) {
        await uploadAttachment.mutateAsync({
          courseId: course.id,
          lessonId,
          file: attachment,
        })
      }
      toast.push(lesson ? 'Урок сохранён' : 'Урок добавлен')
      onClose()
    } catch (requestError) {
      setError(describeError(requestError))
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      width={620}
      title={canManage ? (lesson ? 'Редактировать урок' : 'Новый урок') : (lesson?.title ?? 'Урок')}
      subtitle={course.title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {canManage ? 'Отмена' : 'Закрыть'}
          </Button>
          {canManage && (
            <Button disabled={pending} onClick={submit}>
              {pending ? 'Сохраняем…' : 'Сохранить урок'}
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {error && <ErrorBanner message={error} />}
        <Field label="Название">
          <Input
            value={title}
            disabled={!canManage}
            onChange={(event) => setTitle(event.target.value)}
            autoFocus
          />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Тип урока">
            <Select
              value={kind}
              disabled={!canManage}
              onChange={(value) => setKind(value as CourseLessonKind)}
              options={lessonKindOptions}
            />
          </Field>
          <Field label="Длительность, минут">
            <Input
              type="number"
              min={0}
              value={durationMin}
              disabled={!canManage}
              onChange={(event) => setDurationMin(event.target.value)}
            />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field
            label="Внешняя ссылка"
            optional
            hint="Для ссылки, интерактива, внешнего теста или материала"
          >
            <Input
              type="url"
              value={externalUrl}
              disabled={!canManage}
              placeholder="https://…"
              onChange={(event) => setExternalUrl(event.target.value)}
            />
          </Field>
          {kind === 'video' ? (
            <Field label="Минимальный просмотр, %" optional>
              <Input
                type="number"
                min={0}
                max={100}
                value={minimumWatchPct}
                disabled={!canManage}
                onChange={(event) => setMinimumWatchPct(event.target.value)}
              />
            </Field>
          ) : (
            <div className="flex items-end pb-2">
              <Toggle
                on={requiredLesson}
                onChange={setRequiredLesson}
                label="Обязательный урок"
                disabled={!canManage}
              />
            </div>
          )}
        </div>
        {kind === 'video' && (
          <Toggle
            on={requiredLesson}
            onChange={setRequiredLesson}
            label="Обязательный урок"
            disabled={!canManage}
          />
        )}
        <Field label="Краткое описание" optional>
          <textarea
            className="inp min-h-20"
            value={description}
            disabled={!canManage}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>
        <Field label="Текст урока" optional>
          <textarea
            className="inp min-h-36"
            value={content}
            disabled={!canManage}
            onChange={(event) => setContent(event.target.value)}
          />
        </Field>
        {kind === 'video' && (
          <Field
            label={lesson?.videoUrl ? 'Заменить видео' : 'Видео'}
            optional={!!lesson?.videoUrl}
            hint="MP4 или WebM, не более 60 МБ"
          >
            <label className="flex min-h-20 cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-ink-300 bg-paper-hover px-4 text-[13px] font-semibold text-ink-600 hover:border-brand-green-600">
              <Upload size={18} />
              <span className="truncate">{file?.name ?? 'Выбрать видеофайл'}</span>
              <input
                className="sr-only"
                type="file"
                accept="video/mp4,video/webm,.mp4,.webm"
                disabled={!canManage}
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </label>
          </Field>
        )}
        {lesson?.videoUrl && kind === 'video' && !file && (
          <video
            controls
            preload="metadata"
            className="aspect-video w-full rounded-md bg-ink-900"
            src={lesson.videoUrl}
          />
        )}
        <Field
          label="Материалы урока"
          optional
          hint="Изображения, аудио, PDF, Word, Excel, PowerPoint или текст; до 25 МБ каждый"
        >
          <label className="flex min-h-20 cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-ink-300 bg-paper-hover px-4 text-[13px] font-semibold text-ink-600 hover:border-brand-green-600">
            <Paperclip size={18} />
            <span className="truncate">
              {attachmentFiles.length > 0
                ? `Выбрано файлов: ${attachmentFiles.length}`
                : 'Прикрепить файлы'}
            </span>
            <input
              className="sr-only"
              type="file"
              multiple
              accept="image/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.mp3,.m4a,.aac,.wav,.ogg"
              disabled={!canManage}
              onChange={(event) => setAttachmentFiles(Array.from(event.target.files ?? []))}
            />
          </label>
        </Field>
        {attachmentFiles.length > 0 && (
          <div className="space-y-1 rounded-md bg-paper-hover p-3">
            {attachmentFiles.map((attachment) => (
              <div key={`${attachment.name}-${attachment.size}`} className="flex items-center gap-2 text-[12px] text-ink-600">
                {attachment.type.startsWith('image/') ? <Image size={14} /> : <FileText size={14} />}
                <span className="min-w-0 flex-1 truncate">{attachment.name}</span>
                <span>{formatBytes(attachment.size)}</span>
              </div>
            ))}
          </div>
        )}
        {lesson && (lesson.attachments?.length ?? 0) > 0 && (
          <div className="space-y-2">
            <div className="text-[12px] font-bold text-ink-700">Уже прикреплено</div>
            {(lesson.attachments ?? []).map((attachment) => (
              <div key={attachment.id} className="flex items-center gap-2 rounded-md border border-ink-100 px-3 py-2">
                {attachment.kind === 'image' ? <Image size={16} /> : <FileText size={16} />}
                <a
                  className="min-w-0 flex-1 truncate text-[12px] font-semibold text-brand-green-700"
                  href={attachment.mediaUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {attachment.title}
                </a>
                {canManage && (
                  <IconButton
                    tip="Удалить материал"
                    aria-label={`Удалить материал ${attachment.title}`}
                    disabled={pending}
                    onClick={() =>
                      deleteAttachment.mutate(
                        {
                          courseId: course.id,
                          lessonId: lesson.id,
                          attachmentId: attachment.id,
                        },
                        {
                          onSuccess: () => toast.push('Материал удалён'),
                          onError: (requestError) => setError(describeError(requestError)),
                        },
                      )
                    }
                  >
                    <Trash2 size={15} />
                  </IconButton>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} КБ`
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="rounded-md bg-surface-danger px-3 py-2 text-[12px] font-semibold text-accent-danger">
      {message}
    </div>
  )
}
