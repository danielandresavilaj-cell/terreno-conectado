import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const dashboard = await readFile(new URL('../src/screens/Dashboard.tsx', import.meta.url), 'utf8')

describe('gestión de hallazgos', () => {
  it('agrupa selector de estado y gestión en una columna lateral', () => {
    expect(dashboard).toContain('w-[5.5rem] shrink-0 flex flex-col items-stretch gap-2')
    expect(dashboard).toContain('h-11 w-full px-2 rounded-[10px]')
  })

  it('delimita visualmente el botón Gestionar sin cambiar su control de apertura', () => {
    expect(dashboard).toContain('variante="secundaria"')
    expect(dashboard).toContain('className="w-full"')
    expect(dashboard).toContain('aria-expanded={editando}')
  })
})
