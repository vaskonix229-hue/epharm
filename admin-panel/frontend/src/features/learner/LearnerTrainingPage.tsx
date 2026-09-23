import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronDown,
  Clock3,
  Download,
  FileText,
  ExternalLink,
  Headphones,
  Image,
  LogOut,
  PlayCircle,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react'

type Tokens = {
  accessToken: string
  refreshToken: string
}

type TokenLifecycle = {
  onRefreshed: (tokens: Tokens) => void
  onExpired: () => void
}

type Pharmacist = {
  id: string
  name: string
  phone: string
  pharmacyName: string | null
  city: string
}

type Lesson = {
  id: string
  title: string
  description?: string
  content?: string
  kind?: string
  videoUrl?: string | null
  externalUrl?: string | null
  required?: boolean
  minimumWatchPct?: number | null
  durationMin?: number
  order?: number
  attachments?: Array<{
    id: string
    title: string
    fileName: string
    contentType: string
    mediaUrl: string
    sizeBytes: number
    kind: 'image' | 'video' | 'audio' | 'document'
  }>
}

type Course = {
  id: string
  title: string
  description?: string
  coverUrl?: string | null
  durationMin?: number
  totalDurationMin?: number
  lessons: Lesson[]
}

type Stage = {
  id: string
  title: string
  type: string
  status: string
  progressPct: number
  contentUrl?: string | null
  course?: Course | null
}

type Assignment = {
  id: string
  programName: string
  programShortDescription?: string
  pharmacyName: string
  city: string
  status: string
  format: string
  dueAt?: string | null
  progressPct: number
  startedAt?: string | null
  stages: Stage[]
}

type Overview = {
  total: number
  inProgress: number
  completed: number
  overdue: number
  assignments: Assignment[]
}

const TOKEN_KEY = 'epharm.learner.tokens'

function readLessonKey(assignmentId: string) {
  return `epharm.learner.read.${assignmentId}`
}

function readCompletedLessons(assignmentId: string) {
  try {
    return new Set<string>(JSON.parse(localStorage.getItem(readLessonKey(assignmentId)) || '[]'))
  } catch {
    return new Set<string>()
  }
}

function saveCompletedLesson(assignmentId: string, lessonId: string) {
  const completed = readCompletedLessons(assignmentId)
  completed.add(lessonId)
  localStorage.setItem(readLessonKey(assignmentId), JSON.stringify([...completed]))
}

function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('8')) return `+7${digits.slice(1)}`
  if (digits.length === 11 && digits.startsWith('7')) return `+${digits}`
  if (digits.length === 10) return `+7${digits}`
  return value.trim()
}

function readTokens(): Tokens | null {
  try {
    const raw = sessionStorage.getItem(TOKEN_KEY)
    return raw ? (JSON.parse(raw) as Tokens) : null
  } catch {
    return null
  }
}

function messageFrom(error: unknown) {
  if (error instanceof Error) return error.message
  return 'Не удалось выполнить запрос'
}

class LearnerApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'LearnerApiError'
    this.status = status
  }
}

let refreshInFlight: Promise<Tokens> | null = null

async function fetchResponse(path: string, init: RequestInit, tokens?: Tokens | null) {
  return fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(tokens?.accessToken ? { Authorization: `Bearer ${tokens.accessToken}` } : {}),
      ...init.headers,
    },
  })
}

async function decodeResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string } | null
    throw new LearnerApiError(
      body?.message || `Сервер вернул ошибку ${response.status}`,
      response.status,
    )
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

async function refreshTokens(refreshToken: string): Promise<Tokens> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const response = await fetchResponse('/api/mobile/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refreshToken }),
      })
      const result = await decodeResponse<{ tokens: Tokens }>(response)
      return result.tokens
    })().finally(() => {
      refreshInFlight = null
    })
  }
  return refreshInFlight
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  tokens?: Tokens | null,
  lifecycle?: TokenLifecycle,
): Promise<T> {
  let response = await fetchResponse(path, init, tokens)
  if (response.status === 401 && tokens?.refreshToken && lifecycle) {
    try {
      const refreshed = await refreshTokens(tokens.refreshToken)
      lifecycle.onRefreshed(refreshed)
      response = await fetchResponse(path, init, refreshed)
    } catch (error) {
      if (error instanceof LearnerApiError && error.status === 401) lifecycle.onExpired()
      throw error
    }
  }
  if (response.status === 401 && lifecycle) lifecycle.onExpired()
  return decodeResponse<T>(response)
}

const statusLabel: Record<string, string> = {
  planned: 'Запланировано',
  not_started: 'Не начато',
  in_progress: 'В процессе',
  waiting_online: 'Онлайн-этап',
  waiting_test: 'Ожидает тест',
  completed: 'Завершено',
  overdue: 'Просрочено',
  cancelled: 'Отменено',
  available: 'Доступно',
  locked: 'Заблокировано',
}

function formatDate(value?: string | null) {
  if (!value) return 'Без срока'
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' })
    .format(new Date(value))
}

export default function LearnerTrainingPage() {
  const navigate = useNavigate()
  const { assignmentId, lessonId } = useParams<{ assignmentId?: string; lessonId?: string }>()
  const [tokens, setTokens] = useState<Tokens | null>(() => readTokens())
  const [pharmacist, setPharmacist] = useState<Pharmacist | null>(null)
  const [overview, setOverview] = useState<Overview | null>(null)
  const [selected, setSelected] = useState<Assignment | null>(null)
  const [phone, setPhone] = useState('+7')
  const [code, setCode] = useState('')
  const [step, setStep] = useState<'phone' | 'code'>('phone')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(Boolean(tokens))
  const [error, setError] = useState('')

  const clearSession = useCallback(() => {
    sessionStorage.removeItem(TOKEN_KEY)
    setTokens(null)
    setPharmacist(null)
    setOverview(null)
    setSelected(null)
  }, [])

  const persistTokens = useCallback((nextTokens: Tokens) => {
    sessionStorage.setItem(TOKEN_KEY, JSON.stringify(nextTokens))
    setTokens(nextTokens)
  }, [])

  const tokenLifecycle = useMemo<TokenLifecycle>(() => ({
    onRefreshed: persistTokens,
    onExpired: clearSession,
  }), [clearSession, persistTokens])

  useEffect(() => {
    const previousTitle = document.title
    document.title = 'Обучение ePharm'
    document.body.classList.add('learner-portal')
    return () => {
      document.title = previousTitle
      document.body.classList.remove('learner-portal')
    }
  }, [])

  const loadPortal = useCallback(async (activeTokens: Tokens) => {
    try {
      const [me, training] = await Promise.all([
        request<Pharmacist>('/api/mobile/auth/me', {}, activeTokens, tokenLifecycle),
        request<Overview>('/api/mobile/training', {}, activeTokens, tokenLifecycle),
      ])
      setPharmacist(me)
      setOverview(training)
    } catch (loadError) {
      setError(messageFrom(loadError))
    } finally {
      setLoading(false)
    }
  }, [tokenLifecycle])

  const authenticated = tokens !== null
  useEffect(() => {
    if (!authenticated) return
    const timer = window.setTimeout(() => {
      const activeTokens = readTokens()
      if (activeTokens) void loadPortal(activeTokens)
      else clearSession()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [authenticated, clearSession, loadPortal])

  const loadAssignment = useCallback(async (id: string, activeTokens: Tokens) => {
    setBusy(true)
    setError('')
    try {
      let detail = await request<Assignment>(
        `/api/mobile/training/assignments/${id}`,
        {},
        activeTokens,
        tokenLifecycle,
      )
      if (!detail.startedAt && detail.status !== 'completed' && detail.status !== 'cancelled') {
        detail = await request<Assignment>(
          `/api/mobile/training/assignments/${id}/start`,
          { method: 'POST' },
          activeTokens,
          tokenLifecycle,
        )
      }
      setSelected(detail)
    } catch (loadError) {
      setError(messageFrom(loadError))
    } finally {
      setBusy(false)
    }
  }, [tokenLifecycle])

  useEffect(() => {
    if (!tokens || !assignmentId) return
    const timer = window.setTimeout(() => void loadAssignment(assignmentId, tokens), 0)
    return () => window.clearTimeout(timer)
  }, [assignmentId, loadAssignment, tokens])

  async function requestCode(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const normalized = normalizePhone(phone)
      await request('/api/mobile/auth/sms/request', {
        method: 'POST',
        body: JSON.stringify({ phone: normalized }),
      })
      setPhone(normalized)
      setStep('code')
    } catch (requestError) {
      setError(messageFrom(requestError))
    } finally {
      setBusy(false)
    }
  }

  async function verifyCode(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const result = await request<{
        registered: boolean
        tokens: Tokens | null
        pharmacist: Pharmacist | null
      }>('/api/mobile/auth/sms/verify', {
        method: 'POST',
        body: JSON.stringify({ phone, code }),
      })
      if (!result.registered || !result.tokens) {
        throw new Error('Номер ещё не привязан к активному фармацевту. Обратитесь к администратору.')
      }
      persistTokens(result.tokens)
      setPharmacist(result.pharmacist)
    } catch (verifyError) {
      setError(messageFrom(verifyError))
    } finally {
      setBusy(false)
    }
  }

  function openAssignment(assignment: Assignment) {
    navigate(`/learn/course/${assignment.id}`)
  }

  async function completeStage(stage: Stage) {
    if (!tokens || !selected) return
    setBusy(true)
    setError('')
    try {
      const updated = await request<Assignment>(
        `/api/mobile/training/assignments/${selected.id}/stages/${stage.id}`,
        { method: 'PATCH', body: JSON.stringify({ progressPct: 100 }) },
        tokens,
        tokenLifecycle,
      )
      setSelected(updated)
      const refreshed = await request<Overview>('/api/mobile/training', {}, tokens, tokenLifecycle)
      setOverview(refreshed)
    } catch (completeError) {
      setError(messageFrom(completeError))
    } finally {
      setBusy(false)
    }
  }

  async function logout() {
    const activeTokens = tokens
    try {
      if (activeTokens) {
        await request('/api/mobile/auth/logout', { method: 'POST' }, activeTokens, tokenLifecycle)
      }
    } catch {
      // Local logout must always succeed even when the server is unavailable.
    } finally {
      clearSession()
      setStep('phone')
      setCode('')
      navigate('/learn')
    }
  }

  if (!tokens) {
    return (
      <LearnerLayout>
        <div className="mx-auto w-full max-w-md rounded-3xl bg-white p-6 shadow-card sm:p-8">
          <div className="mb-7 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-green-100 text-brand-green-700">
            <BookOpen size={28} />
          </div>
          <h1 className="text-2xl font-extrabold text-ink-900">Обучение ePharm</h1>
          <p className="mt-2 text-sm leading-6 text-ink-500">
            Войдите как фармацевт, чтобы открыть назначенные курсы и сохранить прогресс.
          </p>
          {error && <ErrorMessage text={error} />}
          {step === 'phone' ? (
            <form className="mt-7 space-y-4" onSubmit={requestCode}>
              <label className="block text-sm font-bold text-ink-700">
                Номер телефона
                <input
                  className="inp mt-2 h-12 text-base"
                  inputMode="tel"
                  autoComplete="tel"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="+7 777 000 00 00"
                  required
                />
              </label>
              <button className="btn btn-primary h-12 w-full text-base" disabled={busy}>
                {busy ? 'Отправляем…' : 'Получить код'}
              </button>
            </form>
          ) : (
            <form className="mt-7 space-y-4" onSubmit={verifyCode}>
              <div className="rounded-xl bg-paper-hover px-4 py-3 text-sm text-ink-600">
                Код отправлен на <strong className="text-ink-900">{phone}</strong>
              </div>
              <label className="block text-sm font-bold text-ink-700">
                Код из SMS
                <input
                  className="inp mt-2 h-14 text-center font-mono text-2xl tracking-[0.35em]"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={4}
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 4))}
                  autoFocus
                  required
                />
              </label>
              <button className="btn btn-primary h-12 w-full text-base" disabled={busy || code.length < 4}>
                {busy ? 'Проверяем…' : 'Войти'}
              </button>
              <button type="button" className="btn btn-ghost w-full" onClick={() => setStep('phone')}>
                Изменить номер
              </button>
            </form>
          )}
          <div className="mt-6 flex items-start gap-2 text-xs leading-5 text-ink-400">
            <ShieldCheck className="mt-0.5 shrink-0" size={16} />
            Код действует ограниченное время. Вход выполняется через защищённый сервер ePharm.
          </div>
        </div>
      </LearnerLayout>
    )
  }

  return (
    <LearnerLayout>
      <div className="mx-auto w-full max-w-5xl">
        <header className="mb-6 flex items-center justify-between gap-4">
          <div>
            <div className="text-xs font-extrabold uppercase tracking-[0.18em] text-brand-green-700">ePharm Learning</div>
            <h1 className="mt-1 text-2xl font-extrabold text-ink-900 sm:text-3xl">
              {selected ? selected.programName : `Здравствуйте, ${pharmacist?.name ?? ''}`}
            </h1>
            {!selected && (
              <p className="mt-1 text-sm text-ink-500">
                {pharmacist?.pharmacyName || 'Аптека не назначена'}{pharmacist?.city ? ` · ${pharmacist.city}` : ''}
              </p>
            )}
          </div>
          <button className="btn btn-outline btn-md shrink-0" onClick={() => void logout()}>
            <LogOut size={17} /> <span className="hidden sm:inline">Выйти</span>
          </button>
        </header>

        {error && <ErrorMessage text={error} />}
        {loading ? (
          <div className="flex items-center justify-center py-24 text-ink-500">
            <RefreshCw className="mr-2 animate-spin" size={20} /> Загружаем обучение…
          </div>
        ) : selected && lessonId ? (
          <LessonPage
            assignment={selected}
            lessonId={lessonId}
            busy={busy}
            onBack={() => navigate(`/learn/course/${selected.id}`)}
            onOpenLesson={(nextLessonId) =>
              navigate(`/learn/course/${selected.id}/lesson/${nextLessonId}`)
            }
            onComplete={completeStage}
          />
        ) : selected ? (
          <AssignmentView
            assignment={selected}
            busy={busy}
            onBack={() => {
              setSelected(null)
              navigate('/learn')
            }}
            onOpenLesson={(nextLessonId) =>
              navigate(`/learn/course/${selected.id}/lesson/${nextLessonId}`)
            }
            onComplete={completeStage}
          />
        ) : (
          <OverviewView overview={overview} busy={busy} onOpen={openAssignment} />
        )}
      </div>
    </LearnerLayout>
  )
}

function LearnerLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-paper px-4 py-8 sm:px-6 sm:py-12">
      {children}
    </main>
  )
}

function ErrorMessage({ text }: { text: string }) {
  return <div className="mt-5 rounded-xl bg-surface-danger px-4 py-3 text-sm font-semibold text-accent-danger">{text}</div>
}

function OverviewView({
  overview,
  busy,
  onOpen,
}: {
  overview: Overview | null
  busy: boolean
  onOpen: (assignment: Assignment) => void
}) {
  const assignments = overview?.assignments ?? []
  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat value={overview?.total ?? 0} label="Всего" />
        <Stat value={overview?.inProgress ?? 0} label="В процессе" />
        <Stat value={overview?.completed ?? 0} label="Завершено" />
        <Stat value={overview?.overdue ?? 0} label="Просрочено" danger />
      </div>
      <h2 className="mb-3 text-lg font-extrabold text-ink-900">Мои программы</h2>
      {assignments.length === 0 ? (
        <div className="rounded-2xl bg-white p-8 text-center shadow-card">
          <BookOpen className="mx-auto text-ink-300" size={36} />
          <p className="mt-3 font-bold text-ink-700">Обучение пока не назначено</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {assignments.map((assignment) => (
            <button
              key={assignment.id}
              className="group rounded-2xl bg-white p-5 text-left shadow-card transition hover:-translate-y-0.5 hover:shadow-fab disabled:opacity-60"
              disabled={busy}
              onClick={() => onOpen(assignment)}
            >
              <div className="flex items-start justify-between gap-3">
                <span className="chip chip-green">{statusLabel[assignment.status] || assignment.status}</span>
                <span className="text-sm font-extrabold text-brand-green-700">{assignment.progressPct}%</span>
              </div>
              <h3 className="mt-4 text-lg font-extrabold text-ink-900 group-hover:text-brand-green-700">
                {assignment.programName}
              </h3>
              {assignment.programShortDescription && (
                <p className="mt-2 line-clamp-2 text-sm leading-6 text-ink-500">{assignment.programShortDescription}</p>
              )}
              <div className="mt-5 h-2 overflow-hidden rounded-full bg-paper-input">
                <div className="h-full rounded-full bg-brand-green-600" style={{ width: `${assignment.progressPct}%` }} />
              </div>
              <div className="mt-4 flex items-center gap-2 text-xs font-semibold text-ink-400">
                <Clock3 size={15} /> Срок: {formatDate(assignment.dueAt)}
              </div>
            </button>
          ))}
        </div>
      )}
    </>
  )
}

function Stat({ value, label, danger = false }: { value: number; label: string; danger?: boolean }) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-card">
      <div className={`text-2xl font-extrabold ${danger && value ? 'text-accent-danger' : 'text-ink-900'}`}>{value}</div>
      <div className="mt-1 text-xs font-semibold text-ink-400">{label}</div>
    </div>
  )
}

function AssignmentView({
  assignment,
  busy,
  onBack,
  onOpenLesson,
  onComplete,
}: {
  assignment: Assignment
  busy: boolean
  onBack: () => void
  onOpenLesson: (lessonId: string) => void
  onComplete: (stage: Stage) => Promise<void>
}) {
  return (
    <div>
      <button className="btn btn-ghost mb-4 -ml-2" onClick={onBack}>
        <ArrowLeft size={18} /> Все программы
      </button>
      <section className="rounded-3xl bg-white p-5 shadow-card sm:p-7">
        <div className="flex flex-wrap items-center gap-2">
          <span className="chip chip-green">{statusLabel[assignment.status] || assignment.status}</span>
          <span className="chip chip-ink">{assignment.format === 'online' ? 'Онлайн' : assignment.format}</span>
        </div>
        {assignment.programShortDescription && (
          <p className="mt-4 max-w-3xl text-sm leading-6 text-ink-600">{assignment.programShortDescription}</p>
        )}
        <div className="mt-5 flex items-center gap-3">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-paper-input">
            <div className="h-full rounded-full bg-brand-green-600" style={{ width: `${assignment.progressPct}%` }} />
          </div>
          <strong className="text-sm text-brand-green-700">{assignment.progressPct}%</strong>
        </div>
      </section>

      <div className="mt-6 space-y-4">
        {assignment.stages.map((stage) => (
          <StageCard
            key={stage.id}
            assignmentId={assignment.id}
            stage={stage}
            busy={busy}
            onOpenLesson={onOpenLesson}
            onComplete={() => onComplete(stage)}
          />
        ))}
      </div>
    </div>
  )
}

function StageCard({
  assignmentId,
  stage,
  busy,
  onOpenLesson,
  onComplete,
}: {
  assignmentId: string
  stage: Stage
  busy: boolean
  onOpenLesson: (lessonId: string) => void
  onComplete: () => void | Promise<void>
}) {
  const lessons = useMemo(
    () => [...(stage.course?.lessons ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [stage.course?.lessons],
  )
  const readLessons = readCompletedLessons(assignmentId)
  const requiredLessons = lessons.filter((lesson) => lesson.required !== false)
  const completedLessonCount = requiredLessons.filter((lesson) => readLessons.has(lesson.id)).length
  const completed = stage.status === 'completed' || stage.progressPct >= 100
  const canComplete = !completed && requiredLessons.every((lesson) => readLessons.has(lesson.id))

  return (
    <section className="overflow-hidden rounded-2xl bg-white shadow-card">
      <div className="border-b border-ink-100 p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <span className="text-xs font-extrabold uppercase tracking-wider text-brand-green-700">Этап обучения</span>
            <h2 className="mt-1 text-xl font-extrabold text-ink-900">{stage.course?.title || stage.title}</h2>
            {stage.course?.description && <p className="mt-2 text-sm leading-6 text-ink-500">{stage.course.description}</p>}
          </div>
          {completed && <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-green-100 text-brand-green-700"><Check size={20} /></span>}
        </div>
        {lessons.length > 0 && (
          <div className="mt-3 text-xs font-semibold text-ink-400">
            {lessons.length} урока · {stage.course?.durationMin ?? stage.course?.totalDurationMin ?? lessons.reduce((sum, lesson) => sum + (lesson.durationMin ?? 0), 0)} мин
          </div>
        )}
      </div>

      <div className="divide-y divide-ink-100">
        {lessons.map((lesson, index) => (
          <LessonRow
            key={lesson.id}
            lesson={lesson}
            number={index + 1}
            read={readLessons.has(lesson.id)}
            onOpen={() => onOpenLesson(lesson.id)}
          />
        ))}
        {lessons.length === 0 && stage.contentUrl && (
          <a className="flex items-center gap-2 p-5 font-bold text-brand-green-700 hover:bg-paper-hover" href={stage.contentUrl} target="_blank" rel="noreferrer">
            <PlayCircle size={20} /> Открыть материал
          </a>
        )}
      </div>

      {!completed && (
        <div className="border-t border-ink-100 bg-paper-hover p-5 sm:flex sm:items-center sm:justify-between sm:gap-4">
          <p className="mb-3 text-xs font-semibold text-ink-500 sm:mb-0">
            {requiredLessons.length > 0 && completedLessonCount < requiredLessons.length
              ? `Изучите обязательные уроки: ${completedLessonCount} из ${requiredLessons.length}`
              : 'После подтверждения прогресс сохранится в ePharm.'}
          </p>
          <button className="btn btn-primary btn-md w-full sm:w-auto" disabled={busy || !canComplete} onClick={onComplete}>
            <Check size={17} /> Завершить этап
          </button>
        </div>
      )}
    </section>
  )
}

function LessonPage({
  assignment,
  lessonId,
  busy,
  onBack,
  onOpenLesson,
  onComplete,
}: {
  assignment: Assignment
  lessonId: string
  busy: boolean
  onBack: () => void
  onOpenLesson: (lessonId: string) => void
  onComplete: (stage: Stage) => Promise<void>
}) {
  const stage = assignment.stages.find((candidate) =>
    candidate.course?.lessons.some((lesson) => lesson.id === lessonId),
  )
  const lessons = [...(stage?.course?.lessons ?? [])]
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  const index = lessons.findIndex((lesson) => lesson.id === lessonId)
  const lesson = lessons[index]
  const read = readCompletedLessons(assignment.id).has(lessonId)

  if (!stage || !lesson) {
    return (
      <div className="rounded-2xl bg-white p-8 text-center shadow-card">
        <h2 className="text-lg font-extrabold text-ink-900">Урок не найден</h2>
        <button className="btn btn-outline btn-md mt-4" onClick={onBack}>Вернуться к курсу</button>
      </div>
    )
  }

  const currentStage = stage
  const previous = lessons[index - 1]
  const next = lessons[index + 1]
  const attachments = lesson.attachments ?? []

  async function finishLesson() {
    saveCompletedLesson(assignment.id, lesson.id)
    if (next) {
      onOpenLesson(next.id)
      return
    }
    const completedLessons = readCompletedLessons(assignment.id)
    const allRequiredComplete = lessons
      .filter((item) => item.required !== false)
      .every((item) => completedLessons.has(item.id))
    if (allRequiredComplete) await onComplete(currentStage)
    onBack()
  }

  return (
    <article>
      <button className="btn btn-ghost mb-4 -ml-2" onClick={onBack}>
        <ArrowLeft size={18} /> К содержанию курса
      </button>
      <div className="overflow-hidden rounded-3xl bg-white shadow-card">
        <header className="border-b border-ink-100 p-5 sm:p-8">
          <div className="text-xs font-extrabold uppercase tracking-[0.16em] text-brand-green-700">
            Урок {index + 1} из {lessons.length}
          </div>
          <h2 className="mt-2 text-2xl font-extrabold text-ink-900 sm:text-3xl">{lesson.title}</h2>
          {lesson.description && <p className="mt-3 max-w-3xl text-sm leading-6 text-ink-500">{lesson.description}</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="chip chip-ink"><Clock3 size={14} /> {lesson.durationMin ?? 0} мин</span>
            {lesson.videoUrl && <span className="chip chip-green"><PlayCircle size={14} /> Видеоурок</span>}
            <span className="chip chip-ink">{lesson.required === false ? 'Необязательный' : 'Обязательный'}</span>
            {lesson.minimumWatchPct != null && (
              <span className="chip chip-blue">Просмотр от {lesson.minimumWatchPct}%</span>
            )}
            {attachments.length > 0 && <span className="chip chip-blue"><FileText size={14} /> {attachments.length} материалов</span>}
          </div>
        </header>

        <div className="space-y-7 p-5 sm:p-8">
          {lesson.videoUrl && (
            <section>
              <h3 className="mb-3 text-base font-extrabold text-ink-900">Видео урока</h3>
              <video controls preload="metadata" className="aspect-video w-full rounded-2xl bg-ink-900" src={lesson.videoUrl} />
            </section>
          )}

          {lesson.content && (
            <section>
              <h3 className="mb-3 text-base font-extrabold text-ink-900">Материал урока</h3>
              <div className="whitespace-pre-wrap text-[15px] leading-8 text-ink-700">{lesson.content}</div>
            </section>
          )}

          {lesson.externalUrl && (
            <section>
              <h3 className="mb-3 text-base font-extrabold text-ink-900">Внешний материал</h3>
              <a
                className="btn btn-outline btn-md w-full sm:w-auto"
                href={lesson.externalUrl}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink size={18} /> Открыть материал
              </a>
            </section>
          )}

          {attachments.length > 0 && (
            <section>
              <h3 className="mb-3 text-base font-extrabold text-ink-900">Дополнительные материалы</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {attachments.map((attachment) =>
                  attachment.kind === 'image' ? (
                    <a key={attachment.id} href={attachment.mediaUrl} target="_blank" rel="noreferrer" className="overflow-hidden rounded-xl border border-ink-100 bg-paper-hover">
                      <img className="aspect-video w-full object-cover" src={attachment.mediaUrl} alt={attachment.title} />
                      <div className="flex items-center gap-2 p-3 text-sm font-bold text-ink-700"><Image size={17} /> {attachment.title}</div>
                    </a>
                  ) : attachment.kind === 'video' ? (
                    <div key={attachment.id} className="rounded-xl border border-ink-100 p-3">
                      <video controls preload="metadata" className="aspect-video w-full rounded-lg bg-ink-900" src={attachment.mediaUrl} />
                      <div className="mt-2 text-sm font-bold text-ink-700">{attachment.title}</div>
                    </div>
                  ) : attachment.kind === 'audio' ? (
                    <div key={attachment.id} className="rounded-xl border border-ink-100 p-4">
                      <div className="mb-3 flex items-center gap-2 text-sm font-bold text-ink-700">
                        <Headphones size={18} /> {attachment.title}
                      </div>
                      <audio controls preload="metadata" className="w-full" src={attachment.mediaUrl} />
                    </div>
                  ) : (
                    <a key={attachment.id} href={attachment.mediaUrl} target="_blank" rel="noreferrer" download className="flex items-center gap-3 rounded-xl border border-ink-100 p-4 hover:bg-paper-hover">
                      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-blue-100 text-brand-blue-600"><FileText size={20} /></span>
                      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-extrabold text-ink-900">{attachment.title}</span><span className="text-xs text-ink-400">{formatBytes(attachment.sizeBytes)}</span></span>
                      <Download className="text-ink-400" size={18} />
                    </a>
                  ),
                )}
              </div>
            </section>
          )}

          {!lesson.content && !lesson.videoUrl && !lesson.externalUrl && attachments.length === 0 && (
            <div className="rounded-xl bg-paper-hover p-5 text-sm text-ink-500">Материалы этого урока пока не добавлены.</div>
          )}
        </div>

        <footer className="border-t border-ink-100 bg-paper-hover p-5 sm:flex sm:items-center sm:justify-between sm:gap-4 sm:p-6">
          <div className="mb-3 flex gap-2 sm:mb-0">
            {previous && <button className="btn btn-outline btn-md" onClick={() => onOpenLesson(previous.id)}><ArrowLeft size={17} /> Назад</button>}
          </div>
          <button className="btn btn-primary btn-md w-full sm:w-auto" disabled={busy} onClick={finishLesson}>
            <Check size={17} /> {next ? (read ? 'Следующий урок' : 'Урок изучен — далее') : 'Завершить курс'}
          </button>
        </footer>
      </div>
    </article>
  )
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} КБ`
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`
}

function LessonRow({
  lesson,
  number,
  read,
  onOpen,
}: {
  lesson: Lesson
  number: number
  read: boolean
  onOpen: () => void
}) {
  return (
    <article>
      <button className="flex w-full items-center gap-3 p-5 text-left hover:bg-paper-hover" onClick={onOpen}>
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-extrabold ${read ? 'bg-brand-green-600 text-white' : 'bg-brand-green-100 text-brand-green-700'}`}>
          {read ? <Check size={18} /> : number}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-extrabold text-ink-900">{lesson.title}</span>
          <span className="mt-1 block text-xs font-semibold text-ink-400">
            {lesson.durationMin ? `${lesson.durationMin} мин` : 'Учебный материал'}
            {lesson.required === false ? ' · необязательный' : ''}
          </span>
        </span>
        <ChevronDown className="-rotate-90 shrink-0 text-ink-400" size={20} />
      </button>
    </article>
  )
}
