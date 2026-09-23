import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import LearnerTrainingPage from './LearnerTrainingPage'

const tokens = { accessToken: 'access-token', refreshToken: 'refresh-token' }
const lessonStorage = new Map<string, string>()
const localStorageStub = {
  getItem: (key: string) => lessonStorage.get(key) ?? null,
  setItem: (key: string, value: string) => lessonStorage.set(key, value),
  removeItem: (key: string) => lessonStorage.delete(key),
  clear: () => lessonStorage.clear(),
  key: (index: number) => [...lessonStorage.keys()][index] ?? null,
  get length() {
    return lessonStorage.size
  },
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function renderPortal(path = '/learn') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/learn" element={<LearnerTrainingPage />} />
        <Route path="/learn/course/:assignmentId" element={<LearnerTrainingPage />} />
        <Route path="/learn/course/:assignmentId/lesson/:lessonId" element={<LearnerTrainingPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  sessionStorage.clear()
  lessonStorage.clear()
  vi.stubGlobal('localStorage', localStorageStub)
  vi.restoreAllMocks()
})

afterEach(() => {
  document.body.classList.remove('learner-portal')
  vi.unstubAllGlobals()
})

describe('learner training portal', () => {
  it('accepts the four-digit SMS code used by mobile authentication', async () => {
    const user = userEvent.setup()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ accepted: true }))
    renderPortal()

    await user.clear(screen.getByRole('textbox', { name: 'Номер телефона' }))
    await user.type(screen.getByRole('textbox', { name: 'Номер телефона' }), '77770000000')
    await user.click(screen.getByRole('button', { name: 'Получить код' }))

    const code = screen.getByRole('textbox', { name: 'Код из SMS' })
    expect(code).toHaveAttribute('maxlength', '4')
    await user.type(code, '123456')
    expect(code).toHaveValue('1234')
  })

  it('keeps a direct assigned-course link through SMS login', async () => {
    const assignment = {
      id: 'assignment-link',
      programName: 'Назначенный курс',
      pharmacyName: 'Ауэзова 134',
      city: 'Алматы',
      status: 'in_progress',
      format: 'online',
      progressPct: 0,
      startedAt: '2026-09-01T10:00:00Z',
      stages: [],
    }
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const path = String(input)
      if (path === '/api/mobile/auth/sms/request') return json({ accepted: true })
      if (path === '/api/mobile/auth/sms/verify') {
        return json({
          registered: true,
          tokens,
          pharmacist: {
            id: 'ph-1',
            name: 'Айжан',
            phone: '+77070000000',
            pharmacyName: 'Ауэзова 134',
            city: 'Алматы',
          },
        })
      }
      if (path === '/api/mobile/auth/me') {
        return json({
          id: 'ph-1',
          name: 'Айжан',
          phone: '+77070000000',
          pharmacyName: 'Ауэзова 134',
          city: 'Алматы',
        })
      }
      if (path === '/api/mobile/training') {
        return json({ total: 1, inProgress: 1, completed: 0, overdue: 0, assignments: [assignment] })
      }
      if (path === '/api/mobile/training/assignments/assignment-link') return json(assignment)
      return json({ message: `Unexpected request: ${path}` }, 500)
    })

    renderPortal('/learn/course/assignment-link')
    const user = userEvent.setup()
    await user.clear(screen.getByRole('textbox', { name: 'Номер телефона' }))
    await user.type(screen.getByRole('textbox', { name: 'Номер телефона' }), '77770000000')
    await user.click(screen.getByRole('button', { name: 'Получить код' }))
    await user.type(screen.getByRole('textbox', { name: 'Код из SMS' }), '1234')
    await user.click(screen.getByRole('button', { name: 'Войти' }))

    expect(await screen.findByRole('heading', { name: 'Назначенный курс' })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/mobile/training/assignments/assignment-link',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: `Bearer ${tokens.accessToken}` }),
      }),
    )
  })

  it('completes the current stage after its final lesson', async () => {
    sessionStorage.setItem('epharm.learner.tokens', JSON.stringify(tokens))
    localStorage.setItem('epharm.learner.read.assignment-1', JSON.stringify(['lesson-1']))
    const assignment = {
      id: 'assignment-1',
      programName: 'Безопасная работа',
      pharmacyName: 'Ауэзова 134',
      city: 'Алматы',
      status: 'in_progress',
      format: 'online',
      progressPct: 50,
      startedAt: '2026-09-01T10:00:00Z',
      stages: [
        {
          id: 'stage-1',
          title: 'Основы',
          type: 'online_course',
          status: 'in_progress',
          progressPct: 50,
          course: {
            id: 'course-1',
            title: 'Основы',
            lessons: [
              { id: 'lesson-1', title: 'Первый', order: 0, required: true, attachments: [] },
              {
                id: 'lesson-2',
                title: 'Второй',
                order: 1,
                required: true,
                externalUrl: 'https://learn.example.org/final',
                attachments: [],
              },
            ],
          },
        },
      ],
    }
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const path = String(input)
      if (path === '/api/mobile/auth/me') {
        return json({ id: 'ph-1', name: 'Айжан', phone: '+77070000000', pharmacyName: 'Ауэзова 134', city: 'Алматы' })
      }
      if (path === '/api/mobile/training/assignments/assignment-1') return json(assignment)
      if (path === '/api/mobile/training' && (!init?.method || init.method === 'GET')) {
        return json({ total: 1, inProgress: 1, completed: 0, overdue: 0, assignments: [assignment] })
      }
      if (path.endsWith('/stages/stage-1') && init?.method === 'PATCH') {
        return json({ ...assignment, progressPct: 100, stages: [{ ...assignment.stages[0], status: 'completed', progressPct: 100 }] })
      }
      return json({ message: `Unexpected request: ${path}` }, 500)
    })

    renderPortal('/learn/course/assignment-1/lesson/lesson-2')
    expect(await screen.findByRole('heading', { name: 'Второй' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Открыть материал' })).toHaveAttribute(
      'href',
      'https://learn.example.org/final',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Завершить курс' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/mobile/training/assignments/assignment-1/stages/stage-1',
        expect.objectContaining({ method: 'PATCH' }),
      )
    })
  })

  it('refreshes an expired access token once for concurrent portal requests', async () => {
    sessionStorage.setItem('epharm.learner.tokens', JSON.stringify(tokens))
    const refreshedTokens = { accessToken: 'fresh-access-token', refreshToken: 'fresh-refresh-token' }
    let refreshCalls = 0
    const protectedCalls: Array<{ path: string; authorization: string | null }> = []
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const path = String(input)
      const authorization = new Headers(init?.headers).get('Authorization')

      if (path === '/api/mobile/auth/refresh') {
        refreshCalls += 1
        expect(init?.method).toBe('POST')
        expect(JSON.parse(String(init?.body))).toEqual({ refreshToken: tokens.refreshToken })
        return json({ tokens: refreshedTokens })
      }

      if (path === '/api/mobile/auth/me' || path === '/api/mobile/training') {
        protectedCalls.push({ path, authorization })
        if (authorization === `Bearer ${tokens.accessToken}`) {
          return json({ message: 'Токен истёк' }, 401)
        }
        expect(authorization).toBe(`Bearer ${refreshedTokens.accessToken}`)
        if (path === '/api/mobile/auth/me') {
          return json({
            id: 'ph-1',
            name: 'Айжан',
            phone: '+77070000000',
            pharmacyName: 'Ауэзова 134',
            city: 'Алматы',
          })
        }
        return json({ total: 0, inProgress: 0, completed: 0, overdue: 0, assignments: [] })
      }

      return json({ message: `Unexpected request: ${path}` }, 500)
    })

    renderPortal()

    expect(await screen.findByRole('heading', { name: 'Здравствуйте, Айжан' })).toBeInTheDocument()
    expect(refreshCalls).toBe(1)
    expect(JSON.parse(sessionStorage.getItem('epharm.learner.tokens') || '{}')).toEqual(refreshedTokens)
    expect(protectedCalls).toEqual(expect.arrayContaining([
      { path: '/api/mobile/auth/me', authorization: `Bearer ${tokens.accessToken}` },
      { path: '/api/mobile/training', authorization: `Bearer ${tokens.accessToken}` },
      { path: '/api/mobile/auth/me', authorization: `Bearer ${refreshedTokens.accessToken}` },
      { path: '/api/mobile/training', authorization: `Bearer ${refreshedTokens.accessToken}` },
    ]))
    expect(fetchMock).toHaveBeenCalledTimes(5)
  })
})
