import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  aplicarActualizacionPwa,
  avisarActualizacionDisponible,
  buscarActualizacionPwa,
  configurarActualizacionPwa,
  estadoActualizacionPwa,
  indicarActualizacionNoDisponible,
  reiniciarActualizacionPwa,
} from '../src/lib/actualizacion-pwa'

afterEach(reiniciarActualizacionPwa)

describe('actualización manual de la PWA', () => {
  it('consulta el service worker y dice si la versión ya está al día', async () => {
    const buscar = vi.fn(async () => {})
    configurarActualizacionPwa({ buscar, aplicar: vi.fn(async () => {}) })

    await buscarActualizacionPwa()

    expect(buscar).toHaveBeenCalledOnce()
    expect(estadoActualizacionPwa()).toEqual({ fase: 'lista', mensaje: 'Ya tienes la versión más reciente.' })
  })

  it('no activa una versión nueva hasta que la persona la confirma', async () => {
    const aplicar = vi.fn(async () => {})
    configurarActualizacionPwa({ buscar: vi.fn(async () => {}), aplicar })

    await aplicarActualizacionPwa()
    expect(aplicar).not.toHaveBeenCalled()

    avisarActualizacionDisponible()
    await aplicarActualizacionPwa()
    expect(aplicar).toHaveBeenCalledOnce()
    expect(estadoActualizacionPwa().fase).toBe('aplicando')
  })

  it('explica cuando el navegador no puede consultar el service worker', () => {
    indicarActualizacionNoDisponible()
    expect(estadoActualizacionPwa().fase).toBe('sin_soporte')
    expect(estadoActualizacionPwa().mensaje).toContain('PWA instalada')
  })
})
