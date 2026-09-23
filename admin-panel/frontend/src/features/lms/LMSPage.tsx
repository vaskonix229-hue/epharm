import { useDeferredValue, useMemo, useState } from 'react'
import { Copy, Eye, QrCode } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import {
  Button,
  Empty,
  Field,
  Input,
  IconButton,
  Metric,
  Modal,
  PageHeader,
  ProgressBar,
  SearchInput,
  Select,
  Tabs,
  useToast,
  type TabItem,
} from '@/ui'
import {
  IconCheck,
  IconArchive,
  IconDownload,
  IconDuplicate,
  IconEdit,
  IconLMS,
  IconPlayCircle,
  IconPlus,
  IconUsers,
} from '@/ui/icons'
import type {
  CourseDto,
  CourseStatus,
  OfflineEventDto,
  TrainingAssignmentDto,
  TrainingAssignmentStageDto,
  TrainingAssignmentStatus,
  TrainingCapabilitiesDto,
  TrainingFormat,
  TrainingProgramDto,
  TrainingProgramStatus,
} from '@/lib/api-types'
import {
  downloadTrainingAssignments,
  useCourses,
  useCreateCourse,
  useDeleteCourse,
  useOfflineEvents,
  useTrainingAssignmentPage,
  useTrainingAssignments,
  useTrainingCertificates,
  useTrainingDashboard,
  useTrainingPrograms,
  useTrainingPharmacists,
  useUpdateTrainingProgram,
} from '@/lib/queries/lms'
import { describeError } from '@/lib/describeError'
import { formatKzt, formatNum } from '@/mocks/fixtures'
import { isTrainingReadOnlyRole, isTrainingWorkspaceRole } from '@/app/accessPolicy'
import { useUiStore } from '@/app/store'
import {
  TRAINING_NAVIGATION,
  trainingItem,
  trainingTabFromSearch,
  type TrainingTab,
} from '@/app/trainingNavigation'
import {
  AssignTrainingModal,
  AssessmentResultModal,
  AttendanceModal,
  ChangeAssignmentFormatModal,
  CreateEventModal,
  CreateProgramModal,
  EventSummary,
  EventQrModal,
} from './TrainingModals'
import {
  ASSIGNMENT_STATUS_LABEL,
  FORMAT_LABEL,
  PROGRAM_STATUS_LABEL,
  STAGE_TYPE_LABEL,
  chipClass,
  dateOnly,
  dateTime,
} from './training-ui'
import { CourseEditorDrawer } from './CourseEditorDrawer'

const TABS: TabItem<TrainingTab>[] = TRAINING_NAVIGATION.map(({ value, label }) => ({
  value,
  label,
}))

export default function LMSPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const role = useUiStore((state) => state.authedUser?.role)
  const isReadOnly = isTrainingReadOnlyRole(role)
  const trainingWorkspace = role ? isTrainingWorkspaceRole(role) : false
  const requestedPharmacistIds = useMemo(
    () => (searchParams.get('pharmacists') ?? '').split(',').filter(Boolean),
    [searchParams],
  )
  const requestedAssignment =
    !isReadOnly && searchParams.get('action') === 'assign' && requestedPharmacistIds.length > 0
  const tab = trainingTabFromSearch(searchParams, requestedAssignment)
  const currentSection = trainingItem(tab)
  const setTab = (nextTab: TrainingTab) => {
    const nextParams = new URLSearchParams(searchParams)
    nextParams.delete('action')
    nextParams.delete('pharmacists')
    if (nextTab === 'overview') nextParams.delete('tab')
    else nextParams.set('tab', nextTab)
    setSearchParams(nextParams)
  }
  const [programModalOpen, setProgramModalOpen] = useState(false)
  const [programTarget, setProgramTarget] = useState<{
    program: TrainingProgramDto
    mode: 'edit' | 'duplicate'
  } | null>(null)
  const [assignmentModalOpen, setAssignmentModalOpen] = useState(false)
  const [eventModalOpen, setEventModalOpen] = useState(false)
  const [eventTarget, setEventTarget] = useState<OfflineEventDto | null>(null)
  const [courseModalOpen, setCourseModalOpen] = useState(false)
  const [courseTargetId, setCourseTargetId] = useState<string | null>(null)
  const [attendanceEvent, setAttendanceEvent] = useState<OfflineEventDto | null>(null)
  const [qrEvent, setQrEvent] = useState<OfflineEventDto | null>(null)
  const [resultTarget, setResultTarget] = useState<{
    assignment: TrainingAssignmentDto
    stage: TrainingAssignmentStageDto
  } | null>(null)
  const [formatTarget, setFormatTarget] = useState<TrainingAssignmentDto | null>(null)

  const dashboardQuery = useTrainingDashboard()
  const programsQuery = useTrainingPrograms()
  const assignmentsQuery = useTrainingAssignments()
  const eventsQuery = useOfflineEvents()
  const certificatesQuery = useTrainingCertificates()
  const coursesQuery = useCourses()
  const pharmacistsQuery = useTrainingPharmacists()

  const dashboard = dashboardQuery.data
  const programs = programsQuery.data ?? []
  const assignments = assignmentsQuery.data ?? []
  const events = eventsQuery.data ?? []
  const certificates = certificatesQuery.data ?? []
  const courses = coursesQuery.data ?? []
  const pharmacists = pharmacistsQuery.data ?? []
  const capabilities = dashboard?.capabilities
  const closeAssignmentModal = () => {
    setAssignmentModalOpen(false)
    if (requestedAssignment) {
      const nextParams = new URLSearchParams(searchParams)
      nextParams.delete('action')
      nextParams.delete('pharmacists')
      nextParams.set('tab', 'assignments')
      setSearchParams(nextParams, { replace: true })
    }
  }

  const action = (() => {
    if (isReadOnly) {
      return (
        <span className="chip chip-ink" data-testid="training-read-only">
          Только просмотр
        </span>
      )
    }
    if (tab === 'programs' && capabilities?.canManagePrograms) {
      return (
        <Button leading={<IconPlus size={15} />} onClick={() => setProgramModalOpen(true)}>
          Новая программа
        </Button>
      )
    }
    if (tab === 'assignments' && capabilities?.canManageAssignments) {
      return (
        <Button leading={<IconPlus size={15} />} onClick={() => setAssignmentModalOpen(true)}>
          Назначить обучение
        </Button>
      )
    }
    if (tab === 'events' && capabilities?.canManageEvents) {
      return (
        <Button leading={<IconPlus size={15} />} onClick={() => setEventModalOpen(true)}>
          Новое событие
        </Button>
      )
    }
    if (tab === 'courses' && capabilities?.canManagePrograms) {
      return (
        <Button leading={<IconPlus size={15} />} onClick={() => setCourseModalOpen(true)}>
          Новый курс
        </Button>
      )
    }
    return undefined
  })()

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={trainingWorkspace ? currentSection.title : 'Обучение'}
        subtitle={
          trainingWorkspace
            ? currentSection.subtitle
            : 'Программы, назначения, очные события, контроль прохождения и сертификаты фармацевтов'
        }
        actions={action}
      />

      {!trainingWorkspace && (
        <div className="card overflow-x-auto px-5 pt-1">
          <div className="min-w-max">
            <Tabs items={TABS} value={tab} onChange={setTab} />
          </div>
        </div>
      )}

      {dashboardQuery.isError && !dashboard ? (
        <Empty
          title="Не удалось загрузить раздел обучения"
          body={describeError(dashboardQuery.error)}
          icon={<IconLMS size={28} />}
          action={<Button onClick={() => dashboardQuery.refetch()}>Повторить</Button>}
        />
      ) : tab === 'overview' ? (
        <OverviewTab dashboard={dashboard} loading={dashboardQuery.isLoading} />
      ) : tab === 'programs' ? (
        <ProgramsTab
          programs={programs}
          loading={programsQuery.isLoading}
          canManage={!!capabilities?.canManagePrograms}
          onEdit={(program) => setProgramTarget({ program, mode: 'edit' })}
          onDuplicate={(program) => setProgramTarget({ program, mode: 'duplicate' })}
        />
      ) : tab === 'assignments' ? (
        <AssignmentsTab
          programs={programs}
          canManage={!!capabilities?.canManageAssignments}
          canExport={!!capabilities?.canExport}
          onChangeFormat={setFormatTarget}
        />
      ) : tab === 'events' || tab === 'attendance' ? (
        <EventsTab
          events={events}
          loading={eventsQuery.isLoading}
          canManageEvents={!!capabilities?.canManageEvents}
          canMarkAttendance={!!capabilities?.canMarkAttendance}
          onEdit={setEventTarget}
          onParticipants={setAttendanceEvent}
          onQr={setQrEvent}
        />
      ) : tab === 'courses' ? (
        <CoursesTab
          courses={courses}
          loading={coursesQuery.isLoading}
          canManage={!!capabilities?.canManagePrograms}
          onOpen={(course) => setCourseTargetId(course.id)}
        />
      ) : tab === 'results' ? (
        <ResultsTab
          assignments={assignments}
          loading={assignmentsQuery.isLoading}
          canRecord={!!capabilities?.canRecordResults}
          onRecord={setResultTarget}
        />
      ) : tab === 'certificates' ? (
        <CertificatesTab certificates={certificates} loading={certificatesQuery.isLoading} />
      ) : tab === 'analytics' ? (
        <AnalyticsTab
          dashboard={dashboard}
          assignments={assignments}
          canExport={!!capabilities?.canExport}
        />
      ) : (
        <TrainingSettingsTab capabilities={capabilities} />
      )}

      {programModalOpen && capabilities?.canManagePrograms && (
        <CreateProgramModal open onClose={() => setProgramModalOpen(false)} courses={courses} />
      )}
      {programTarget && capabilities?.canManagePrograms && (
        <CreateProgramModal
          key={`${programTarget.mode}-${programTarget.program.id}-${programTarget.program.version}`}
          open
          onClose={() => setProgramTarget(null)}
          courses={courses}
          program={programTarget.program}
          mode={programTarget.mode}
        />
      )}
      {(assignmentModalOpen || requestedAssignment) && capabilities?.canManageAssignments && (
        <AssignTrainingModal
          key={requestedPharmacistIds.join(':') || 'manual-assignment'}
          open
          onClose={closeAssignmentModal}
          programs={programs}
          events={events}
          pharmacists={pharmacists}
          initialPharmacistIds={requestedPharmacistIds}
        />
      )}
      {eventModalOpen && capabilities?.canManageEvents && (
        <CreateEventModal open onClose={() => setEventModalOpen(false)} programs={programs} />
      )}
      {eventTarget && capabilities?.canManageEvents && (
        <CreateEventModal
          key={`event-${eventTarget.id}-${eventTarget.updatedAt}`}
          open
          onClose={() => setEventTarget(null)}
          programs={programs}
          event={eventTarget}
        />
      )}
      {capabilities?.canManagePrograms && (
        <CreateCourseModal open={courseModalOpen} onClose={() => setCourseModalOpen(false)} />
      )}
      <CourseEditorDrawer
        key={courseTargetId ?? 'closed-course-editor'}
        courseId={courseTargetId}
        fallbackCourse={courses.find((course) => course.id === courseTargetId)}
        canManage={!!capabilities?.canManagePrograms}
        onClose={() => setCourseTargetId(null)}
      />
      {capabilities?.canMarkAttendance && (
        <AttendanceModal event={attendanceEvent} onClose={() => setAttendanceEvent(null)} />
      )}
      <EventQrModal event={qrEvent} onClose={() => setQrEvent(null)} />
      {capabilities?.canRecordResults && (
        <AssessmentResultModal target={resultTarget} onClose={() => setResultTarget(null)} />
      )}
      {formatTarget && capabilities?.canManageAssignments && (
        <ChangeAssignmentFormatModal
          key={formatTarget.id}
          assignment={formatTarget}
          program={programs.find((program) => program.id === formatTarget.programId) ?? null}
          events={events}
          onClose={() => setFormatTarget(null)}
        />
      )}
    </div>
  )
}

function OverviewTab({
  dashboard,
  loading,
}: {
  dashboard: ReturnType<typeof useTrainingDashboard>['data']
  loading: boolean
}) {
  if (loading || !dashboard) return <LoadingBlock label="Загружаем показатели обучения…" />
  return (
    <>
      <div className="grid grid-cols-4 gap-4">
        <Metric
          label="Активные программы"
          value={formatNum(dashboard.activePrograms)}
          accent="ink"
          icon={<IconLMS size={17} />}
        />
        <Metric
          label="Назначено"
          value={formatNum(dashboard.totalAssignments)}
          accent="blue"
          icon={<IconUsers size={17} />}
        />
        <Metric
          label="Завершено"
          value={formatNum(dashboard.completed)}
          accent="green"
          icon={<IconCheck size={17} />}
        />
        <Metric
          label="Процент завершения"
          value={`${dashboard.completionRatePct}%`}
          accent="purple"
          icon={<IconPlayCircle size={17} />}
        />
      </div>
      <div className="grid grid-cols-[1.4fr_1fr] gap-4">
        <section className="card p-5">
          <h2 className="text-[15px] font-extrabold text-ink-900">Состояние назначений</h2>
          <div className="mt-4 grid grid-cols-4 gap-5">
            <CompactMetric label="Не начато" value={dashboard.notStarted} />
            <CompactMetric label="В процессе" value={dashboard.inProgress} />
            <CompactMetric label="Просрочено" value={dashboard.overdue} danger />
            <CompactMetric
              label="Средний балл"
              value={dashboard.averageScore == null ? '—' : `${dashboard.averageScore}%`}
            />
          </div>
          <div className="mt-5">
            <ProgressBar value={dashboard.completionRatePct} height={8} />
            <div className="mt-2 flex justify-between text-[11px] text-ink-500">
              <span>Общий прогресс сети</span>
              <span className="num font-bold">
                {dashboard.completed} из {dashboard.totalAssignments}
              </span>
            </div>
          </div>
        </section>
        <section className="card p-5">
          <h2 className="text-[15px] font-extrabold text-ink-900">Результаты</h2>
          <dl className="mt-4 divide-y divide-ink-100 text-[13px]">
            <InfoRow label="Сертификатов выдано" value={formatNum(dashboard.certificates)} />
            <InfoRow label="Бонусов начислено" value={formatKzt(dashboard.rewardsIssued)} />
            <InfoRow
              label="Посещение подтверждено"
              value={formatNum(dashboard.attendanceConfirmed)}
            />
            <InfoRow label="Неявки" value={formatNum(dashboard.noShows)} />
          </dl>
        </section>
      </div>
      <section className="card p-5">
        <h2 className="text-[15px] font-extrabold text-ink-900">Назначения по формату</h2>
        <div className="mt-4 grid grid-cols-3 gap-4">
          {(Object.keys(FORMAT_LABEL) as Array<keyof typeof FORMAT_LABEL>).map((format) => (
            <div key={format} className="hairline rounded-lg border px-4 py-3">
              <div className="text-[12px] font-semibold text-ink-500">{FORMAT_LABEL[format]}</div>
              <div className="num mt-1 text-[22px] font-extrabold text-ink-900">
                {formatNum(dashboard.byFormat[format] ?? 0)}
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  )
}

function ProgramsTab({
  programs,
  loading,
  canManage,
  onEdit,
  onDuplicate,
}: {
  programs: TrainingProgramDto[]
  loading: boolean
  canManage: boolean
  onEdit: (program: TrainingProgramDto) => void
  onDuplicate: (program: TrainingProgramDto) => void
}) {
  const toast = useToast()
  const update = useUpdateTrainingProgram()
  const [query, setQuery] = useState('')
  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return programs.filter(
      (program) =>
        !normalized ||
        `${program.name} ${program.brand} ${program.category}`.toLowerCase().includes(normalized),
    )
  }, [programs, query])

  const changeStatus = (program: TrainingProgramDto, status: TrainingProgramStatus) => {
    if (
      status === 'archived' &&
      !confirm(`Архивировать программу «${program.name}»? История назначений сохранится.`)
    ) {
      return
    }
    update.mutate(
      { id: program.id, patch: { status } },
      {
        onSuccess: () => toast.push(`Статус программы «${program.name}» обновлён`),
        onError: (error) => toast.push(describeError(error)),
      },
    )
  }

  if (loading) return <LoadingBlock label="Загружаем программы…" />
  return (
    <TableSection
      search={
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Название, бренд или категория"
          className="!h-9 w-[340px]"
        />
      }
      empty={visible.length === 0}
      emptyLabel="Программ обучения пока нет"
    >
      <table className="w-full text-[13px]" data-testid="training-programs-table">
        <thead className="hairline border-b text-left text-[11px] font-bold uppercase text-ink-500">
          <tr>
            <th className="px-5 py-2.5">Программа</th>
            <th className="px-3 py-2.5">Маршрут</th>
            <th className="px-3 py-2.5">Формат</th>
            <th className="px-3 py-2.5">Назначено</th>
            <th className="px-3 py-2.5">Статус</th>
            <th className="px-5 py-2.5" />
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-100">
          {visible.map((program) => (
            <tr key={program.id} className="hover:bg-paper-hover">
              <td className="px-5 py-3">
                <div className="font-extrabold text-ink-900">{program.name}</div>
                <div className="mt-0.5 text-[11px] text-ink-500">
                  v{program.version} · {program.category || 'Без категории'} · бонус{' '}
                  {formatKzt(program.completionBonus)}
                </div>
              </td>
              <td className="px-3 py-3">
                <div className="flex max-w-[360px] flex-col gap-1.5">
                  {program.allowedFormats.map((format) => (
                    <div key={format} className="flex items-center gap-1.5">
                      <span className="w-16 text-[10px] font-bold uppercase text-ink-500">
                        {FORMAT_LABEL[format]}
                      </span>
                      <div className="flex flex-wrap gap-1">
                        {program.stages
                          .filter((stage) => stage.applicableFormats.includes(format))
                          .map((stage) => (
                            <span key={`${format}-${stage.id}`} className="chip chip-ink">
                              {STAGE_TYPE_LABEL[stage.type]}
                            </span>
                          ))}
                      </div>
                    </div>
                  ))}
                </div>
              </td>
              <td className="px-3 py-3 text-ink-700">
                {program.allowedFormats.map((format) => FORMAT_LABEL[format]).join(', ')}
              </td>
              <td className="num px-3 py-3 font-bold">{formatNum(program.assignments)}</td>
              <td className="px-3 py-3">
                <span className={`chip ${chipClass(program.status)}`}>
                  {PROGRAM_STATUS_LABEL[program.status]}
                </span>
              </td>
              <td className="px-5 py-3 text-right">
                {canManage && program.status !== 'archived' && (
                  <div className="flex items-center justify-end gap-1.5">
                    <IconButton
                      aria-label="Редактировать программу"
                      tip="Редактировать программу"
                      disabled={update.isPending}
                      onClick={() => onEdit(program)}
                    >
                      <IconEdit size={16} />
                    </IconButton>
                    <IconButton
                      aria-label="Создать копию"
                      tip="Создать копию"
                      disabled={update.isPending}
                      onClick={() => onDuplicate(program)}
                    >
                      <IconDuplicate size={16} />
                    </IconButton>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={update.isPending}
                      onClick={() =>
                        changeStatus(
                          program,
                          program.status === 'published' ? 'paused' : 'published',
                        )
                      }
                    >
                      {program.status === 'published' ? 'Приостановить' : 'Опубликовать'}
                    </Button>
                    <IconButton
                      aria-label="Архивировать программу"
                      tip="Архивировать программу"
                      disabled={update.isPending}
                      onClick={() => changeStatus(program, 'archived')}
                    >
                      <IconArchive size={16} />
                    </IconButton>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableSection>
  )
}

function AssignmentsTab({
  programs,
  canManage,
  canExport,
  onChangeFormat,
}: {
  programs: TrainingProgramDto[]
  canManage: boolean
  canExport: boolean
  onChangeFormat: (assignment: TrainingAssignmentDto) => void
}) {
  const toast = useToast()
  const [query, setQuery] = useState('')
  const [format, setFormat] = useState<TrainingFormat | 'all'>('all')
  const [status, setStatus] = useState<TrainingAssignmentStatus | 'all'>('all')
  const [programId, setProgramId] = useState('all')
  const [page, setPage] = useState(0)
  const [exporting, setExporting] = useState(false)
  const deferredQuery = useDeferredValue(query.trim())
  const pageQuery = useTrainingAssignmentPage({
    format: format === 'all' ? undefined : format,
    status: status === 'all' ? undefined : status,
    programId: programId === 'all' ? undefined : programId,
    q: deferredQuery || undefined,
    page,
    size: 25,
  })
  const pageData = pageQuery.data
  const visible = pageData?.items ?? []

  const exportCsv = async () => {
    setExporting(true)
    try {
      const blob = await downloadTrainingAssignments({
        format: format === 'all' ? undefined : format,
        status: status === 'all' ? undefined : status,
        programId: programId === 'all' ? undefined : programId,
        q: query.trim() || undefined,
      })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `training-assignments-${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
      toast.push('Отчёт сформирован с учётом текущих фильтров')
    } catch (error) {
      toast.push(describeError(error))
    } finally {
      setExporting(false)
    }
  }

  const copyLearnerLink = async (assignment: TrainingAssignmentDto) => {
    const url = new URL(`/learn/course/${assignment.id}`, window.location.origin).toString()
    try {
      await navigator.clipboard.writeText(url)
      toast.push(`Ссылка для ${assignment.pharmacistName} скопирована`)
    } catch {
      toast.push('Не удалось скопировать ссылку на курс')
    }
  }

  if (pageQuery.isLoading) return <LoadingBlock label="Загружаем назначения…" />
  return (
    <TableSection
      search={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <SearchInput
            value={query}
            onChange={(value) => {
              setQuery(value)
              setPage(0)
            }}
            placeholder="Фармацевт, аптека или программа"
            className="!h-9 w-[320px]"
          />
          <Select
            value={programId}
            onChange={(value) => {
              setProgramId(value)
              setPage(0)
            }}
            className="w-[210px]"
            options={[
              { value: 'all', label: 'Все программы' },
              ...programs.map((program) => ({ value: program.id, label: program.name })),
            ]}
          />
          <Select
            value={format}
            onChange={(value) => {
              setFormat(value as TrainingFormat | 'all')
              setPage(0)
            }}
            className="w-[150px]"
            options={[
              { value: 'all', label: 'Все форматы' },
              ...Object.entries(FORMAT_LABEL).map(([value, label]) => ({ value, label })),
            ]}
          />
          <Select
            value={status}
            onChange={(value) => {
              setStatus(value as TrainingAssignmentStatus | 'all')
              setPage(0)
            }}
            className="w-[190px]"
            options={[
              { value: 'all', label: 'Все статусы' },
              ...Object.entries(ASSIGNMENT_STATUS_LABEL).map(([value, label]) => ({
                value,
                label,
              })),
            ]}
          />
          {canExport && (
            <Button
              size="sm"
              variant="outline"
              leading={<IconDownload size={15} />}
              disabled={exporting}
              onClick={exportCsv}
            >
              {exporting ? 'Экспорт…' : 'CSV'}
            </Button>
          )}
        </div>
      }
      empty={visible.length === 0}
      emptyLabel="Назначений пока нет"
    >
      <table className="w-full text-[13px]" data-testid="training-assignments-table">
        <thead className="hairline border-b text-left text-[11px] font-bold uppercase text-ink-500">
          <tr>
            <th className="px-5 py-2.5">Фармацевт</th>
            <th className="px-3 py-2.5">Программа</th>
            <th className="px-3 py-2.5">Формат</th>
            <th className="px-3 py-2.5">Срок</th>
            <th className="px-3 py-2.5">Прогресс</th>
            <th className="px-3 py-2.5">Статус</th>
            <th className="px-5 py-2.5" />
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-100">
          {visible.map((assignment) => (
            <tr key={assignment.id} className="hover:bg-paper-hover">
              <td className="px-5 py-3">
                <div className="font-extrabold text-ink-900">{assignment.pharmacistName}</div>
                <div className="text-[11px] text-ink-500">
                  {assignment.pharmacyName} · {assignment.city}
                </div>
              </td>
              <td className="px-3 py-3 font-semibold text-ink-800">{assignment.programName}</td>
              <td className="px-3 py-3">{FORMAT_LABEL[assignment.format]}</td>
              <td className="num px-3 py-3 text-ink-600">{dateOnly(assignment.dueAt)}</td>
              <td className="px-3 py-3">
                <div className="flex min-w-[130px] items-center gap-2">
                  <ProgressBar value={assignment.progressPct} />
                  <span className="num w-9 text-right text-[11px] font-bold">
                    {assignment.progressPct}%
                  </span>
                </div>
              </td>
              <td className="px-3 py-3">
                <span className={`chip ${chipClass(assignment.status)}`}>
                  {ASSIGNMENT_STATUS_LABEL[assignment.status]}
                </span>
              </td>
              <td className="px-5 py-3 text-right">
                <div className="flex items-center justify-end gap-1">
                  <IconButton
                    tip="Скопировать ссылку для фармацевта"
                    aria-label={`Скопировать ссылку на курс для ${assignment.pharmacistName}`}
                    onClick={() => void copyLearnerLink(assignment)}
                  >
                    <Copy size={16} />
                  </IconButton>
                  {canManage && assignment.status !== 'cancelled' && (
                    <Button size="sm" variant="outline" onClick={() => onChangeFormat(assignment)}>
                      Сменить формат
                    </Button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {(pageData?.total ?? 0) > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 px-5 py-3 text-[12px] text-ink-600">
          <span>
            Показано {page * 25 + 1}–{Math.min((page + 1) * 25, pageData?.total ?? 0)} из{' '}
            {formatNum(pageData?.total ?? 0)}
          </span>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={page === 0 || pageQuery.isFetching}
              onClick={() => setPage((value) => Math.max(0, value - 1))}
            >
              Назад
            </Button>
            <span className="num min-w-[92px] text-center">
              Страница {page + 1} из {Math.max(1, pageData?.totalPages ?? 1)}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={page + 1 >= (pageData?.totalPages ?? 0) || pageQuery.isFetching}
              onClick={() => setPage((value) => value + 1)}
            >
              Далее
            </Button>
          </div>
        </div>
      )}
    </TableSection>
  )
}

function ResultsTab({
  assignments,
  loading,
  canRecord,
  onRecord,
}: {
  assignments: TrainingAssignmentDto[]
  loading: boolean
  canRecord: boolean
  onRecord: (target: {
    assignment: TrainingAssignmentDto
    stage: TrainingAssignmentStageDto
  }) => void
}) {
  const [query, setQuery] = useState('')
  const rows = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return assignments.flatMap((assignment) =>
      assignment.stages
        .filter((stage) => ['test', 'ai_exam', 'manual_review'].includes(stage.type))
        .filter(
          (stage) =>
            !normalized ||
            `${assignment.pharmacistName} ${assignment.programName} ${stage.title}`
              .toLowerCase()
              .includes(normalized),
        )
        .map((stage) => ({ assignment, stage })),
    )
  }, [assignments, query])

  if (loading) return <LoadingBlock label="Загружаем результаты…" />
  return (
    <TableSection
      search={
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Фармацевт, программа или этап"
          className="!h-9 w-[360px]"
        />
      }
      empty={rows.length === 0}
      emptyLabel="Этапов аттестации пока нет"
    >
      <table className="w-full text-[13px]" data-testid="training-results-table">
        <thead className="hairline border-b text-left text-[11px] font-bold uppercase text-ink-500">
          <tr>
            <th className="px-5 py-2.5">Фармацевт</th>
            <th className="px-3 py-2.5">Программа</th>
            <th className="px-3 py-2.5">Этап</th>
            <th className="px-3 py-2.5">Попытки</th>
            <th className="px-3 py-2.5">Результат</th>
            <th className="px-3 py-2.5">Статус</th>
            <th className="px-5 py-2.5" />
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-100">
          {rows.map(({ assignment, stage }) => (
            <tr key={stage.id} className="hover:bg-paper-hover">
              <td className="px-5 py-3">
                <div className="font-extrabold text-ink-900">{assignment.pharmacistName}</div>
                <div className="text-[11px] text-ink-500">{assignment.pharmacyName}</div>
              </td>
              <td className="px-3 py-3 font-semibold text-ink-800">{assignment.programName}</td>
              <td className="px-3 py-3">
                <div className="font-semibold text-ink-800">{stage.title}</div>
                <div className="text-[11px] text-ink-500">{STAGE_TYPE_LABEL[stage.type]}</div>
              </td>
              <td className="num px-3 py-3">
                {stage.attemptsUsed}/{stage.maxAttempts ?? '∞'}
              </td>
              <td className="num px-3 py-3">{stage.score == null ? '—' : `${stage.score}%`}</td>
              <td className="px-3 py-3">
                <span className={`chip ${chipClass(stage.status)}`}>
                  {stage.status.replaceAll('_', ' ')}
                </span>
              </td>
              <td className="px-5 py-3 text-right">
                {canRecord && !['completed', 'skipped', 'locked'].includes(stage.status) && (
                  <Button size="sm" onClick={() => onRecord({ assignment, stage })}>
                    Записать результат
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableSection>
  )
}

function EventsTab({
  events,
  loading,
  canManageEvents,
  canMarkAttendance,
  onEdit,
  onParticipants,
  onQr,
}: {
  events: OfflineEventDto[]
  loading: boolean
  canManageEvents: boolean
  canMarkAttendance: boolean
  onEdit: (event: OfflineEventDto) => void
  onParticipants: (event: OfflineEventDto) => void
  onQr: (event: OfflineEventDto) => void
}) {
  if (loading) return <LoadingBlock label="Загружаем события…" />
  return (
    <TableSection empty={events.length === 0} emptyLabel="Очных событий пока нет">
      <table className="w-full text-[13px]" data-testid="training-events-table">
        <thead className="hairline border-b text-left text-[11px] font-bold uppercase text-ink-500">
          <tr>
            <th className="px-5 py-2.5">Событие</th>
            <th className="px-3 py-2.5">Дата и время</th>
            <th className="px-3 py-2.5">Место</th>
            <th className="px-3 py-2.5">Тренер</th>
            <th className="px-3 py-2.5">Участники</th>
            <th className="px-5 py-2.5" />
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-100">
          {events.map((event) => (
            <tr key={event.id} className="hover:bg-paper-hover">
              <td className="px-5 py-3">
                <div className="font-extrabold text-ink-900">{event.title}</div>
                <div className="text-[11px] text-ink-500">{event.programName}</div>
              </td>
              <td className="num px-3 py-3 text-ink-700">{dateTime(event.startsAt)}</td>
              <td className="px-3 py-3 text-ink-700">
                {event.city || '—'}
                <div className="text-[11px] text-ink-500">{event.address}</div>
              </td>
              <td className="px-3 py-3 text-ink-700">
                {event.trainerName || event.organizer || '—'}
              </td>
              <td className="px-3 py-3">
                <EventSummary event={event} />
              </td>
              <td className="px-5 py-3 text-right">
                {(canManageEvents || canMarkAttendance) && (
                  <div className="flex justify-end gap-2">
                    {canManageEvents && event.status !== 'archived' && (
                      <IconButton
                        aria-label="Редактировать событие"
                        tip="Редактировать событие"
                        onClick={() => onEdit(event)}
                      >
                        <IconEdit size={16} />
                      </IconButton>
                    )}
                    {canMarkAttendance && (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          leading={<QrCode size={15} />}
                          onClick={() => onQr(event)}
                        >
                          QR-код
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => onParticipants(event)}>
                          Участники
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableSection>
  )
}

function CoursesTab({
  courses,
  loading,
  canManage,
  onOpen,
}: {
  courses: CourseDto[]
  loading: boolean
  canManage: boolean
  onOpen: (course: CourseDto) => void
}) {
  if (loading) return <LoadingBlock label="Загружаем онлайн-курсы…" />
  return (
    <TableSection empty={courses.length === 0} emptyLabel="Онлайн-курсов пока нет">
      <table className="w-full text-[13px]" data-testid="lms-courses-table">
        <thead className="hairline border-b text-left text-[11px] font-bold uppercase text-ink-500">
          <tr>
            <th className="px-5 py-2.5">Курс</th>
            <th className="px-3 py-2.5">Материалы</th>
            <th className="px-3 py-2.5">Фармацевты</th>
            <th className="px-3 py-2.5">Статус</th>
            <th className="px-5 py-2.5" />
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-100">
          {courses.map((course) => (
            <CourseRow key={course.id} course={course} canManage={canManage} onOpen={onOpen} />
          ))}
        </tbody>
      </table>
    </TableSection>
  )
}

function CourseRow({
  course,
  canManage,
  onOpen,
}: {
  course: CourseDto
  canManage: boolean
  onOpen: (course: CourseDto) => void
}) {
  const toast = useToast()
  const remove = useDeleteCourse()
  const statusLabel: Record<CourseStatus, string> = {
    published: 'Опубликован',
    draft: 'Черновик',
    archived: 'Архив',
  }
  return (
    <tr className="hover:bg-paper-hover">
      <td className="px-5 py-3">
        <button
          type="button"
          className="text-left font-extrabold text-ink-900 hover:text-brand-green-700"
          onClick={() => onOpen(course)}
        >
          {course.title}
        </button>
        <div className="text-[11px] text-ink-500">{course.category || 'Без категории'}</div>
      </td>
      <td className="px-3 py-3 text-ink-700">
        {course.lessons} уроков · {course.durationMin} мин.
      </td>
      <td className="num px-3 py-3 text-ink-700">
        {course.completed} / {course.enrolled}
      </td>
      <td className="px-3 py-3">
        <span className={`chip ${chipClass(course.status)}`}>{statusLabel[course.status]}</span>
      </td>
      <td className="px-5 py-3 text-right">
        <div className="flex items-center justify-end gap-1">
          <IconButton
            tip="Открыть курс"
            aria-label={`Открыть курс ${course.title}`}
            onClick={() => onOpen(course)}
          >
            <Eye size={16} />
          </IconButton>
          {canManage && course.status !== 'archived' && (
            <button
              type="button"
              aria-label={`Архивировать курс ${course.title}`}
              className="text-ink-400 hover:text-accent-danger"
              onClick={() => {
                if (!confirm(`Архивировать курс «${course.title}»? История обучения сохранится.`))
                  return
                remove.mutate(course.id, {
                  onSuccess: () => toast.push('Курс архивирован'),
                  onError: (error) => toast.push(describeError(error)),
                })
              }}
            >
              <IconArchive size={16} />
            </button>
          )}
        </div>
      </td>
    </tr>
  )
}

function CertificatesTab({
  certificates,
  loading,
}: {
  certificates: ReturnType<typeof useTrainingCertificates>['data'] extends infer T
    ? NonNullable<T>
    : never
  loading: boolean
}) {
  if (loading) return <LoadingBlock label="Загружаем сертификаты…" />
  return (
    <TableSection empty={certificates.length === 0} emptyLabel="Сертификатов пока нет">
      <table className="w-full text-[13px]" data-testid="training-certificates-table">
        <thead className="hairline border-b text-left text-[11px] font-bold uppercase text-ink-500">
          <tr>
            <th className="px-5 py-2.5">Номер</th>
            <th className="px-3 py-2.5">Фармацевт</th>
            <th className="px-3 py-2.5">Программа</th>
            <th className="px-3 py-2.5">Результат</th>
            <th className="px-3 py-2.5">Выдан</th>
            <th className="px-5 py-2.5" />
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-100">
          {certificates.map((certificate) => (
            <tr key={certificate.id} className="hover:bg-paper-hover">
              <td className="num px-5 py-3 font-bold text-ink-900">{certificate.number}</td>
              <td className="px-3 py-3 font-semibold text-ink-800">{certificate.pharmacistName}</td>
              <td className="px-3 py-3 text-ink-700">{certificate.programName}</td>
              <td className="num px-3 py-3">
                {certificate.score == null ? '—' : `${certificate.score}%`}
              </td>
              <td className="num px-3 py-3 text-ink-600">{dateOnly(certificate.issuedAt)}</td>
              <td className="px-5 py-3 text-right">
                {certificate.pdfUrl && (
                  <a
                    href={certificate.pdfUrl}
                    className="inline-flex text-brand-green-700"
                    aria-label="Скачать сертификат"
                  >
                    <IconDownload size={17} />
                  </a>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableSection>
  )
}

function AnalyticsTab({
  dashboard,
  assignments,
  canExport,
}: {
  dashboard: ReturnType<typeof useTrainingDashboard>['data']
  assignments: TrainingAssignmentDto[]
  canExport: boolean
}) {
  const toast = useToast()
  const [exporting, setExporting] = useState(false)
  if (!dashboard) return <LoadingBlock label="Загружаем аналитику…" />

  const rows = (Object.keys(FORMAT_LABEL) as TrainingFormat[]).map((format) => {
    const scoped = assignments.filter((assignment) => assignment.format === format)
    const started = scoped.filter(
      (assignment) => assignment.status !== 'not_started' && assignment.status !== 'scheduled',
    ).length
    const completed = scoped.filter((assignment) => assignment.status === 'completed').length
    const overdue = scoped.filter((assignment) => assignment.status === 'overdue').length
    return {
      format,
      assigned: scoped.length,
      started,
      completed,
      overdue,
      completionRate: scoped.length === 0 ? 0 : Math.round((completed * 100) / scoped.length),
    }
  })

  const exportCsv = async () => {
    setExporting(true)
    try {
      const blob = await downloadTrainingAssignments()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `training-analytics-${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
      toast.push('Отчёт по обучению сформирован')
    } catch (error) {
      toast.push(describeError(error))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-4 gap-4">
        <Metric label="Назначено" value={formatNum(dashboard.totalAssignments)} accent="blue" />
        <Metric label="Завершено" value={formatNum(dashboard.completed)} accent="green" />
        <Metric label="Просрочено" value={formatNum(dashboard.overdue)} accent="amber" />
        <Metric label="Бонусы" value={formatKzt(dashboard.rewardsIssued)} accent="purple" />
      </div>
      <section className="card overflow-hidden">
        <div className="hairline flex items-center justify-between border-b px-5 py-3">
          <div>
            <h2 className="text-[15px] font-extrabold text-ink-900">Эффективность по форматам</h2>
            <p className="text-[11px] text-ink-500">
              Текущие назначения в доступной области данных
            </p>
          </div>
          {canExport && (
            <Button
              size="sm"
              variant="outline"
              leading={<IconDownload size={15} />}
              disabled={exporting}
              onClick={exportCsv}
            >
              {exporting ? 'Экспорт…' : 'Экспорт CSV'}
            </Button>
          )}
        </div>
        <table className="w-full text-[13px]" data-testid="training-analytics-table">
          <thead className="hairline border-b text-left text-[11px] font-bold uppercase text-ink-500">
            <tr>
              <th className="px-5 py-2.5">Формат</th>
              <th className="px-3 py-2.5">Назначено</th>
              <th className="px-3 py-2.5">Начали</th>
              <th className="px-3 py-2.5">Завершили</th>
              <th className="px-3 py-2.5">Просрочили</th>
              <th className="px-5 py-2.5">Завершение</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {rows.map((row) => (
              <tr key={row.format}>
                <td className="px-5 py-3 font-extrabold text-ink-900">
                  {FORMAT_LABEL[row.format]}
                </td>
                <td className="num px-3 py-3">{row.assigned}</td>
                <td className="num px-3 py-3">{row.started}</td>
                <td className="num px-3 py-3">{row.completed}</td>
                <td className="num px-3 py-3">{row.overdue}</td>
                <td className="px-5 py-3">
                  <div className="flex min-w-[150px] items-center gap-2">
                    <ProgressBar value={row.completionRate} />
                    <span className="num w-10 text-right font-bold">{row.completionRate}%</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}

function TrainingSettingsTab({ capabilities }: { capabilities?: TrainingCapabilitiesDto }) {
  if (!capabilities) return <LoadingBlock label="Загружаем права доступа…" />
  const permissions = [
    ['Программы и маршруты', capabilities.canManagePrograms],
    ['Назначения и форматы', capabilities.canManageAssignments],
    ['Офлайн-мероприятия', capabilities.canManageEvents],
    ['Посещаемость', capabilities.canMarkAttendance],
    ['Результаты и экзамены', capabilities.canRecordResults],
    ['Формат по умолчанию', capabilities.canManagePreferences],
    ['Бонусы и корректировки', capabilities.canAdjustRewards],
    ['Экспорт отчётов', capabilities.canExport],
  ] as const
  return (
    <div className="grid grid-cols-[1.3fr_1fr] gap-4">
      <section className="card overflow-hidden">
        <div className="hairline border-b px-5 py-4">
          <h2 className="text-[15px] font-extrabold text-ink-900">Права текущего пользователя</h2>
        </div>
        <div className="divide-y divide-ink-100">
          {permissions.map(([label, allowed]) => (
            <div key={label} className="flex items-center justify-between px-5 py-3 text-[13px]">
              <span className="font-semibold text-ink-700">{label}</span>
              <span className={`chip ${allowed ? 'chip-green' : 'chip-ink'}`}>
                {allowed ? 'Разрешено' : 'Только просмотр'}
              </span>
            </div>
          ))}
        </div>
      </section>
      <section className="card p-5">
        <h2 className="text-[15px] font-extrabold text-ink-900">Область данных</h2>
        <div className="mt-4 text-[13px] text-ink-700">
          {capabilities.regionalScope.length === 0 ? (
            <span className="chip chip-green">Вся сеть</span>
          ) : (
            <div className="flex flex-wrap gap-2">
              {capabilities.regionalScope.map((region) => (
                <span key={region} className="chip chip-ink">
                  {region}
                </span>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

function CreateCourseModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast()
  const create = useCreateCourse()
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('')
  const [description, setDescription] = useState('')
  const [bonus, setBonus] = useState('')
  const [status, setStatus] = useState<CourseStatus>('draft')
  const [error, setError] = useState<string | null>(null)
  const submit = () => {
    if (!title.trim()) return setError('Введите название курса')
    create.mutate(
      {
        title: title.trim(),
        category: category.trim(),
        description: description.trim(),
        bonus: Number(bonus) || 0,
        status,
      },
      {
        onSuccess: () => {
          toast.push('Онлайн-курс создан')
          setTitle('')
          setCategory('')
          setDescription('')
          setBonus('')
          setStatus('draft')
          onClose()
        },
        onError: (requestError) => setError(describeError(requestError)),
      },
    )
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Новый онлайн-курс"
      subtitle="Курс можно включить в одну или несколько программ"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button disabled={create.isPending} onClick={submit}>
            Создать
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {error && (
          <div className="rounded-lg bg-surface-danger px-3 py-2 text-[12px] font-semibold text-accent-danger">
            {error}
          </div>
        )}
        <Field label="Название">
          <Input value={title} onChange={(event) => setTitle(event.target.value)} autoFocus />
        </Field>
        <Field label="Категория" optional>
          <Input value={category} onChange={(event) => setCategory(event.target.value)} />
        </Field>
        <Field label="Описание" optional>
          <textarea
            className="inp min-h-24"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Бонус, ₸">
            <Input
              type="number"
              min={0}
              value={bonus}
              onChange={(event) => setBonus(event.target.value)}
            />
          </Field>
        </div>
        <Field label="Статус">
          <Select
            value={status}
            onChange={(value) => setStatus(value as CourseStatus)}
            options={[
              { value: 'draft', label: 'Черновик' },
              { value: 'published', label: 'Опубликован' },
            ]}
          />
        </Field>
      </div>
    </Modal>
  )
}

function TableSection({
  children,
  search,
  empty,
  emptyLabel,
}: {
  children: React.ReactNode
  search?: React.ReactNode
  empty: boolean
  emptyLabel: string
}) {
  return (
    <section className="card min-h-[430px] overflow-hidden">
      {search && (
        <div className="hairline flex items-center justify-end border-b px-5 py-3">{search}</div>
      )}
      {empty ? (
        <Empty
          title={emptyLabel}
          body="Данные появятся после создания или назначения обучения"
          icon={<IconLMS size={26} />}
        />
      ) : (
        <div className="scrollbar-thin overflow-auto">{children}</div>
      )}
    </section>
  )
}

function LoadingBlock({ label }: { label: string }) {
  return (
    <div className="card flex min-h-[360px] items-center justify-center text-[13px] font-semibold text-ink-500">
      {label}
    </div>
  )
}

function CompactMetric({
  label,
  value,
  danger = false,
}: {
  label: string
  value: number | string
  danger?: boolean
}) {
  return (
    <div>
      <div className="text-[11px] font-semibold text-ink-500">{label}</div>
      <div
        className={`num mt-1 text-[20px] font-extrabold ${danger ? 'text-accent-danger' : 'text-ink-900'}`}
      >
        {typeof value === 'number' ? formatNum(value) : value}
      </div>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <dt className="text-ink-600">{label}</dt>
      <dd className="num font-extrabold text-ink-900">{value}</dd>
    </div>
  )
}
