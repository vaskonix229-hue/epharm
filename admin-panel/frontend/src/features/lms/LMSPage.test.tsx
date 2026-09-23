import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { ToastHost } from '@/ui'
import type {
  CourseDto,
  EventParticipantDto,
  OfflineEventDto,
  PharmacistDto,
  TrainingAssignmentDto,
  TrainingDashboardDto,
  TrainingProgramDto,
} from '@/lib/api-types'
import { USERS } from '@/mocks/fixtures'
import { useUiStore } from '@/app/store'
import LMSPage from './LMSPage'

const lmsHooks = vi.hoisted(() => ({
  useCourses: vi.fn(),
  useCourse: vi.fn(),
  useCreateCourse: vi.fn(),
  useUpdateCourse: vi.fn(),
  useDeleteCourse: vi.fn(),
  useCreateCourseLesson: vi.fn(),
  useUpdateCourseLesson: vi.fn(),
  useDeleteCourseLesson: vi.fn(),
  useReorderCourseLessons: vi.fn(),
  useUploadCourseLessonVideo: vi.fn(),
  useUploadCourseLessonAttachment: vi.fn(),
  useDeleteCourseLessonAttachment: vi.fn(),
  useTrainingDashboard: vi.fn(),
  useTrainingPharmacists: vi.fn(),
  useTrainingPrograms: vi.fn(),
  useTrainingAssignments: vi.fn(),
  useTrainingAssignmentPage: vi.fn(),
  useOfflineEvents: vi.fn(),
  useTrainingCertificates: vi.fn(),
  useUpdateTrainingProgram: vi.fn(),
  useCreateTrainingProgram: vi.fn(),
  useCreateTrainingAssignments: vi.fn(),
  useCreateOfflineEvent: vi.fn(),
  useUpdateOfflineEvent: vi.fn(),
  useEventParticipants: vi.fn(),
  useTrainingEventQr: vi.fn(),
  useMarkAttendance: vi.fn(),
  useRecordAssessmentResult: vi.fn(),
  useChangeAssignmentFormat: vi.fn(),
  useAssignmentFormatHistory: vi.fn(),
  downloadTrainingAssignments: vi.fn(),
}))

vi.mock('@/lib/queries/lms', () => lmsHooks)
vi.mock('qrcode', () => ({
  default: { toCanvas: vi.fn().mockResolvedValue(undefined) },
}))

const queryResult = <T,>(data: T) => ({
  data,
  isLoading: false,
  isError: false,
  error: null,
  refetch: vi.fn(),
})

const mutationResult = (mutate = vi.fn(), mutateAsync = vi.fn().mockResolvedValue(undefined)) => ({
  mutate,
  mutateAsync,
  isPending: false,
})

const dashboard: TrainingDashboardDto = {
  activePrograms: 2,
  totalAssignments: 10,
  notStarted: 3,
  inProgress: 4,
  completed: 3,
  overdue: 1,
  completionRatePct: 30,
  averageScore: 91,
  certificates: 3,
  rewardsIssued: 2250,
  attendanceConfirmed: 2,
  noShows: 1,
  byFormat: { online: 6, hybrid: 2, offline: 2 },
  capabilities: {
    canManagePrograms: true,
    canManageAssignments: true,
    canManageEvents: true,
    canMarkAttendance: true,
    canAdjustRewards: false,
    canRecordResults: true,
    canManagePreferences: true,
    canExport: true,
    regionalScope: [],
  },
}

const program: TrainingProgramDto = {
  id: 'program-1',
  name: 'Кардиология: продукты INKAR',
  shortDescription: 'Основы категории',
  description: '',
  coverUrl: null,
  category: 'Кардиология',
  manufacturer: 'INKAR',
  brand: 'Brand',
  product: '',
  language: 'ru',
  managerId: null,
  managerName: null,
  allowedFormats: ['online', 'hybrid'],
  startsAt: null,
  endsAt: null,
  normativeDays: 14,
  tags: [],
  status: 'published',
  version: 1,
  versionId: 'version-1',
  onlineCourseId: 'course-1',
  passingScore: 80,
  maxAttempts: 3,
  completionBonus: 750,
  stages: [
    {
      id: 'stage-1',
      key: 'online',
      type: 'online_course',
      title: 'Онлайн-курс',
      order: 0,
      required: true,
      unlockAfterKey: null,
      deadlineDays: null,
      passingScore: null,
      maxAttempts: null,
      bonus: 0,
      manualReview: false,
      applicableFormats: ['online', 'hybrid'],
      contentUrl: 'https://content.inkar.kz/course-1',
    },
  ],
  assignments: 10,
  createdAt: '2026-08-01T08:00:00Z',
  updatedAt: '2026-08-01T08:00:00Z',
}

const course: CourseDto = {
  id: 'course-1',
  title: 'Основы категории',
  description: 'Базовый курс по категории',
  status: 'published',
  category: 'Кардиология',
  lessons: 4,
  durationMin: 35,
  enrolled: 10,
  completed: 3,
  bonus: 0,
  lessonItems: [
    {
      id: 'lesson-1',
      title: 'Введение',
      description: 'Основные понятия',
      content: 'Текст урока',
      kind: 'video',
      videoUrl: 'https://epharm.inkar.kz/s3/course.mp4',
      externalUrl: 'https://learn.epharm.kz/materials/intro',
      required: true,
      minimumWatchPct: 80,
      attachments: [
        {
          id: 'attachment-1',
          title: 'Памятка фармацевта',
          fileName: 'handout.pdf',
          contentType: 'application/pdf',
          mediaUrl: 'https://epharm.inkar.kz/s3/handout.pdf',
          sizeBytes: 2048,
          createdAt: '2026-08-01T08:00:00Z',
          kind: 'document',
        },
      ],
      durationMin: 8,
      order: 0,
      createdAt: '2026-08-01T08:00:00Z',
      updatedAt: '2026-08-01T08:00:00Z',
    },
  ],
  createdAt: '2026-08-01T08:00:00Z',
  updatedAt: '2026-08-01T08:00:00Z',
}

const offlineEvent: OfflineEventDto = {
  id: 'event-1',
  programId: program.id,
  programVersionId: program.versionId,
  programName: program.name,
  title: 'Очный семинар',
  eventType: 'seminar',
  startsAt: '2026-08-10T08:00:00Z',
  endsAt: '2026-08-10T10:00:00Z',
  timezone: 'Asia/Almaty',
  region: 'Алматы',
  city: 'Алматы',
  address: 'Ауэзова 134',
  mapUrl: null,
  trainerId: null,
  trainerName: null,
  organizer: 'INKAR',
  capacity: 20,
  occupied: 1,
  registrationDeadline: '2026-08-09T08:00:00Z',
  status: 'registration',
  materialsUrl: null,
  comment: '',
  createdAt: '2026-08-01T08:00:00Z',
  updatedAt: '2026-08-01T08:00:00Z',
}

const pharmacist: PharmacistDto = {
  id: 'ph-1',
  name: 'Айжан Садыкова',
  iin: '900101400001',
  phone: '+77070000001',
  pharmacyId: 'store-1',
  pharmacyName: 'Ауэзова 134',
  city: 'Алматы',
  tier: 'Silver',
  receipts30d: 0,
  rulesAccepted30d: 0,
  earned30d: 0,
  balance: 0,
  coursesDone: 0,
  coursesTotal: 0,
  status: 'active',
  joinedAt: '2026-08-01',
  createdAt: '2026-08-01T08:00:00Z',
  updatedAt: '2026-08-01T08:00:00Z',
}

const assignment: TrainingAssignmentDto = {
  id: 'assignment-1',
  programId: program.id,
  programVersionId: program.versionId,
  programVersion: program.version,
  programName: program.name,
  programShortDescription: program.shortDescription,
  coverUrl: null,
  pharmacistId: pharmacist.id,
  pharmacistName: pharmacist.name,
  pharmacyName: pharmacist.pharmacyName,
  city: pharmacist.city,
  format: 'online',
  status: 'not_started',
  priority: 'normal',
  required: true,
  event: null,
  startsAt: null,
  dueAt: null,
  progressPct: 0,
  score: null,
  startedAt: null,
  completedAt: null,
  stages: [],
  certificate: null,
  reward: null,
  createdAt: '2026-08-01T08:00:00Z',
  updatedAt: '2026-08-01T08:00:00Z',
}

const participant: EventParticipantDto = {
  id: 'participant-1',
  eventId: offlineEvent.id,
  assignmentId: 'assignment-1',
  pharmacistId: pharmacist.id,
  pharmacistName: pharmacist.name,
  pharmacyName: pharmacist.pharmacyName,
  status: 'registered',
  registeredAt: '2026-08-01T08:00:00Z',
  checkedInAt: null,
  checkMethod: null,
  trainerComment: null,
  score: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  // Component-level scenarios exercise the legacy HQ tab bar. The dedicated
  // training-workspace behavior is covered separately below and in Sidebar/E2E.
  useUiStore.setState({ authedUser: { ...USERS.lms, role: 'SYSTEM_ADMIN' } })
  lmsHooks.useTrainingDashboard.mockReturnValue(queryResult(dashboard))
  lmsHooks.useTrainingPrograms.mockReturnValue(queryResult([program]))
  lmsHooks.useTrainingAssignments.mockReturnValue(queryResult([] as TrainingAssignmentDto[]))
  lmsHooks.useTrainingAssignmentPage.mockReturnValue(
    queryResult({
      items: [] as TrainingAssignmentDto[],
      total: 0,
      page: 0,
      size: 25,
      totalPages: 0,
    }),
  )
  lmsHooks.useOfflineEvents.mockReturnValue(queryResult([] as OfflineEventDto[]))
  lmsHooks.useTrainingCertificates.mockReturnValue(queryResult([]))
  lmsHooks.useCourses.mockReturnValue(queryResult([course]))
  lmsHooks.useCourse.mockReturnValue(queryResult(course))
  lmsHooks.useEventParticipants.mockReturnValue(queryResult([]))
  lmsHooks.useTrainingEventQr.mockReturnValue(
    queryResult({
      eventId: offlineEvent.id,
      token: '8e23c62e-497c-49b3-ae84-35491fdf40a7',
      payload: 'epharm://training/check-in/8e23c62e-497c-49b3-ae84-35491fdf40a7',
    }),
  )
  lmsHooks.useTrainingPharmacists.mockReturnValue(queryResult([pharmacist]))
  lmsHooks.useCreateCourse.mockReturnValue(mutationResult())
  lmsHooks.useUpdateCourse.mockReturnValue(mutationResult())
  lmsHooks.useDeleteCourse.mockReturnValue(mutationResult())
  lmsHooks.useCreateCourseLesson.mockReturnValue(mutationResult())
  lmsHooks.useUpdateCourseLesson.mockReturnValue(mutationResult())
  lmsHooks.useDeleteCourseLesson.mockReturnValue(mutationResult())
  lmsHooks.useReorderCourseLessons.mockReturnValue(mutationResult())
  lmsHooks.useUploadCourseLessonVideo.mockReturnValue(mutationResult())
  lmsHooks.useUploadCourseLessonAttachment.mockReturnValue(mutationResult())
  lmsHooks.useDeleteCourseLessonAttachment.mockReturnValue(mutationResult())
  lmsHooks.useUpdateTrainingProgram.mockReturnValue(mutationResult())
  lmsHooks.useCreateTrainingProgram.mockReturnValue(mutationResult())
  lmsHooks.useCreateTrainingAssignments.mockReturnValue(mutationResult())
  lmsHooks.useCreateOfflineEvent.mockReturnValue(mutationResult())
  lmsHooks.useUpdateOfflineEvent.mockReturnValue(mutationResult())
  lmsHooks.useMarkAttendance.mockReturnValue(mutationResult())
  lmsHooks.useRecordAssessmentResult.mockReturnValue(mutationResult())
  lmsHooks.useChangeAssignmentFormat.mockReturnValue(mutationResult())
  lmsHooks.useAssignmentFormatHistory.mockReturnValue(queryResult([]))
  lmsHooks.downloadTrainingAssignments.mockResolvedValue(new Blob(['report']))
})

function renderPage(initialEntry = '/lms') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <ToastHost>
          <LMSPage />
        </ToastHost>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('Обучение — операционный раздел', () => {
  it('показывает сводные показатели', () => {
    renderPage()
    expect(screen.getByRole('heading', { level: 1, name: 'Обучение' })).toBeInTheDocument()
    expect(screen.getByText('Активные программы')).toBeInTheDocument()
    expect(screen.getByText('30%')).toBeInTheDocument()
    expect(screen.getByText('2 250 ₸')).toBeInTheDocument()
  })

  it('в учебном workspace получает активный раздел из URL и не дублирует sidebar вкладками', () => {
    useUiStore.setState({ authedUser: USERS.lms })

    renderPage('/lms?tab=programs')

    expect(screen.getByRole('heading', { level: 1, name: 'Программы' })).toBeInTheDocument()
    expect(screen.getByTestId('training-programs-table')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Программы' })).not.toBeInTheDocument()
  })

  it('неизвестный учебный URL безопасно возвращает на дашборд', () => {
    useUiStore.setState({ authedUser: USERS.lms })

    renderPage('/lms?tab=unknown')

    expect(
      screen.getByRole('heading', { level: 1, name: 'Дашборд обучения' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Активные программы')).toBeInTheDocument()
  })

  it('открывает реестр программ и показывает маршрут', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Программы' }))
    expect(screen.getByTestId('training-programs-table')).toBeInTheDocument()
    expect(screen.getByText('Кардиология: продукты INKAR')).toBeInTheDocument()
    expect(screen.getAllByText('Онлайн-курс')).not.toHaveLength(0)
  })

  it('открывает содержание онлайн-курса и показывает видеоуроки', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Онлайн-курсы' }))
    await user.click(screen.getByRole('button', { name: 'Основы категории' }))

    expect(screen.getByTestId('course-editor')).toBeInTheDocument()
    expect(screen.getByText(/Введение/)).toBeInTheDocument()
    expect(screen.getByText('Текст урока')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Добавить урок' })).toBeInTheDocument()
    expect(screen.getByText('1 вложений')).toBeInTheDocument()
  })

  it('показывает прикрепленные материалы в редакторе урока', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Онлайн-курсы' }))
    await user.click(screen.getByRole('button', { name: 'Основы категории' }))
    await user.click(screen.getByRole('button', { name: /1\. Введение/ }))

    expect(screen.getByText('Уже прикреплено')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Памятка фармацевта' })).toHaveAttribute(
      'href',
      'https://epharm.inkar.kz/s3/handout.pdf',
    )
    expect(screen.getByRole('button', { name: 'Удалить материал Памятка фармацевта' })).toBeInTheDocument()
    expect(screen.getByDisplayValue('https://learn.epharm.kz/materials/intro')).toBeInTheDocument()
    expect(screen.getByDisplayValue('80')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Обязательный урок' })).toBeChecked()
  })

  it('разрешает роли только на чтение открыть курс без кнопок редактирования', async () => {
    useUiStore.setState({ authedUser: USERS.bauyrzhan })
    lmsHooks.useTrainingDashboard.mockReturnValue(
      queryResult({
        ...dashboard,
        capabilities: {
          ...dashboard.capabilities,
          canManagePrograms: false,
        },
      }),
    )
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Онлайн-курсы' }))
    await user.click(screen.getByRole('button', { name: 'Основы категории' }))

    expect(screen.getByTestId('course-editor')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Добавить урок' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Сохранить курс' })).not.toBeInTheDocument()
  })

  it('скрывает управляющие действия для роли только на чтение', async () => {
    useUiStore.setState({ authedUser: USERS.bauyrzhan })
    lmsHooks.useTrainingDashboard.mockReturnValue(
      queryResult({
        ...dashboard,
        capabilities: {
          ...dashboard.capabilities,
          canManagePrograms: false,
          canManageAssignments: false,
          canManageEvents: false,
          canMarkAttendance: false,
          canAdjustRewards: false,
          canRecordResults: false,
          canManagePreferences: false,
          canExport: true,
        },
      }),
    )
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Программы' }))
    expect(screen.queryByRole('button', { name: 'Новая программа' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Приостановить' })).not.toBeInTheDocument()
    expect(screen.getByTestId('training-read-only')).toHaveTextContent('Только просмотр')
  })

  it('HQ_HEAD не может открыть модалку назначения через прямую ссылку', () => {
    useUiStore.setState({ authedUser: USERS.bauyrzhan })
    lmsHooks.useTrainingDashboard.mockReturnValue(
      queryResult({
        ...dashboard,
        capabilities: {
          ...dashboard.capabilities,
          canManagePrograms: false,
          canManageAssignments: false,
          canManageEvents: false,
          canMarkAttendance: false,
          canAdjustRewards: false,
          canRecordResults: false,
          canManagePreferences: false,
          canExport: true,
        },
      }),
    )

    renderPage('/lms?action=assign&pharmacists=ph-1')

    expect(screen.queryByRole('dialog', { name: 'Назначить обучение' })).not.toBeInTheDocument()
  })

  it('создаёт программу с выбранным форматом', async () => {
    const mutate = vi.fn()
    lmsHooks.useCreateTrainingProgram.mockReturnValue(mutationResult(mutate))
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Программы' }))
    await user.click(screen.getByRole('button', { name: 'Новая программа' }))
    await user.type(screen.getByLabelText('Название'), 'Новая программа')
    await user.click(screen.getByRole('button', { name: 'Создать программу' }))
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Новая программа', allowedFormats: ['online'] }),
      expect.any(Object),
    )
  })

  it('редактирует метаданные программы без лишней версии маршрута', async () => {
    const mutate = vi.fn()
    lmsHooks.useUpdateTrainingProgram.mockReturnValue(mutationResult(mutate))
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Программы' }))
    await user.click(screen.getByRole('button', { name: 'Редактировать программу' }))
    expect(screen.getByRole('dialog', { name: 'Редактировать программу' })).toBeInTheDocument()
    await user.clear(screen.getByLabelText('Название'))
    await user.type(screen.getByLabelText('Название'), 'Кардиология 2.0')
    await user.click(screen.getByRole('button', { name: 'Сохранить изменения' }))
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: program.id,
        patch: expect.not.objectContaining({
          stages: expect.anything(),
          allowedFormats: expect.anything(),
        }),
      }),
      expect.any(Object),
    )
    expect(mutate.mock.calls[0][0].patch.name).toBe('Кардиология 2.0')
  })

  it('создаёт новую версию при изменении маршрута программы', async () => {
    const mutate = vi.fn()
    lmsHooks.useUpdateTrainingProgram.mockReturnValue(mutationResult(mutate))
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Программы' }))
    await user.click(screen.getByRole('button', { name: 'Редактировать программу' }))
    await user.selectOptions(screen.getByLabelText('Онлайн-курс'), '__none__')
    await user.selectOptions(screen.getByLabelText('Тип этапа 1'), 'material')
    await user.click(screen.getByRole('button', { name: 'Сохранить изменения' }))
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: program.id,
        patch: expect.objectContaining({
          stages: expect.any(Array),
          allowedFormats: program.allowedFormats,
          clearOnlineCourseId: true,
        }),
      }),
      expect.any(Object),
    )
  })

  it('дублирует программу отдельным черновиком', async () => {
    const mutate = vi.fn()
    lmsHooks.useCreateTrainingProgram.mockReturnValue(mutationResult(mutate))
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Программы' }))
    await user.click(screen.getByRole('button', { name: 'Создать копию' }))
    expect(screen.getByRole('dialog', { name: 'Дублировать программу' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Создать программу' }))
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ name: `${program.name} (копия)`, status: 'draft' }),
      expect.any(Object),
    )
  })

  it('массово назначает программу выбранному фармацевту', async () => {
    const mutate = vi.fn()
    lmsHooks.useCreateTrainingAssignments.mockReturnValue(mutationResult(mutate))
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Назначения' }))
    await user.click(screen.getByRole('button', { name: 'Назначить обучение' }))
    await user.selectOptions(screen.getByLabelText('Программа'), program.id)
    await user.click(screen.getByRole('checkbox', { name: /Айжан Садыкова/ }))
    await user.click(screen.getByRole('button', { name: 'Назначить (1)' }))
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        programId: program.id,
        pharmacistIds: [pharmacist.id],
        format: 'online',
        required: true,
        duplicatePolicy: 'skip',
      }),
      expect.any(Object),
    )
  })

  it('копирует персональную ссылку на назначенный курс', async () => {
    lmsHooks.useTrainingAssignmentPage.mockReturnValue(
      queryResult({ items: [assignment], total: 1, page: 0, size: 25, totalPages: 1 }),
    )

    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText')
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Назначения' }))
    await user.click(
      screen.getByRole('button', { name: `Скопировать ссылку на курс для ${pharmacist.name}` }),
    )

    expect(writeText).toHaveBeenCalledWith(
      new URL('/learn/course/assignment-1', window.location.origin).toString(),
    )
  })

  it('предвыбирает фармацевта при переходе из реестра', () => {
    renderPage('/lms?action=assign&pharmacists=ph-1')
    expect(screen.getByRole('dialog', { name: 'Назначить обучение' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /Айжан Садыкова/ })).toBeChecked()
  })

  it('показывает защищённый QR-код очного события', async () => {
    lmsHooks.useOfflineEvents.mockReturnValue(queryResult([offlineEvent]))
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Офлайн-мероприятия' }))
    await user.click(screen.getByRole('button', { name: 'QR-код' }))
    expect(screen.getByRole('dialog', { name: 'QR-код посещаемости' })).toBeInTheDocument()
    expect(screen.getByLabelText('QR-код регистрации на мероприятии')).toBeInTheDocument()
  })

  it('редактирует расписание очного события без смены программы', async () => {
    const mutate = vi.fn()
    lmsHooks.useOfflineEvents.mockReturnValue(queryResult([offlineEvent]))
    lmsHooks.useUpdateOfflineEvent.mockReturnValue(mutationResult(mutate))
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Офлайн-мероприятия' }))
    await user.click(screen.getByRole('button', { name: 'Редактировать событие' }))
    expect(screen.getByRole('dialog', { name: 'Редактировать событие' })).toBeInTheDocument()
    expect(screen.getByLabelText('Программа')).toHaveValue(program.name)
    await user.clear(screen.getByLabelText('Название события'))
    await user.type(screen.getByLabelText('Название события'), 'Очный семинар 2.0')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: offlineEvent.id,
        patch: expect.objectContaining({ title: 'Очный семинар 2.0' }),
      }),
      expect.any(Object),
    )
  })

  it('сохраняет посещаемость вместе с оценкой и комментарием тренера', async () => {
    const mutate = vi.fn()
    lmsHooks.useOfflineEvents.mockReturnValue(queryResult([offlineEvent]))
    lmsHooks.useEventParticipants.mockReturnValue(queryResult([participant]))
    lmsHooks.useMarkAttendance.mockReturnValue(mutationResult(mutate))
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Посещаемость' }))
    await user.click(screen.getByRole('button', { name: 'Участники' }))
    await user.type(screen.getByLabelText(`Оценка ${pharmacist.name}`), '95')
    await user.type(screen.getByLabelText(`Комментарий ${pharmacist.name}`), 'Активно участвовала')
    await user.click(screen.getByRole('button', { name: 'Присутствовал' }))
    expect(mutate).toHaveBeenCalledWith(
      {
        eventId: offlineEvent.id,
        participantId: participant.id,
        request: {
          status: 'attended',
          method: 'manual',
          score: 95,
          comment: 'Активно участвовала',
        },
      },
      expect.any(Object),
    )
  })
})
