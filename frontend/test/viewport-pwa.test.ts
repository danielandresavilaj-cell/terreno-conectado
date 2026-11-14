import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const indexHtml = await readFile(new URL('../index.html', import.meta.url), 'utf8')
const estilos = await readFile(new URL('../src/index.css', import.meta.url), 'utf8')
const gerencia = await readFile(new URL('../src/screens/Dashboard.tsx', import.meta.url), 'utf8')

describe('viewport de la PWA móvil', () => {
  it('fija la escala y conserva las áreas seguras para que Android no deforme el layout', () => {
    const viewport = indexHtml.match(/<meta name="viewport" content="([^"]+)"/i)?.[1] ?? ''

    expect(viewport).toContain('width=device-width')
    expect(viewport).toContain('initial-scale=1')
    expect(viewport).toContain('maximum-scale=1')
    expect(viewport).toContain('user-scalable=no')
    expect(viewport).toContain('viewport-fit=cover')
  })

  it('permite desplazar la página sin reactivar el gesto de escala', () => {
    expect(estilos).toContain('touch-action: pan-x pan-y')
    expect(gerencia).toContain('min-w-0 overflow-x-hidden space-y-6')
  })
})
