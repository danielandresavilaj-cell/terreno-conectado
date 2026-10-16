import { afterEach, expect, it, vi } from 'vitest'
import { me } from '../src/lib/api'

afterEach(() => vi.unstubAllGlobals())

it('restaura el perfil usando GET /me, la ruta real de MeController', async () => {
  vi.stubGlobal('sessionStorage', { getItem: () => 'token-test' })
  const perfil = { id: 'demo', tenant_id: 'tenant-demo', email: 'demo@example.test', role: 'field_worker', full_name: 'Demo' }
  const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(perfil), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  expect(await me()).toEqual(perfil)
  expect(fetchMock.mock.calls[0]?.[0]).toMatch(/\/api\/v1\/me$/)
})
