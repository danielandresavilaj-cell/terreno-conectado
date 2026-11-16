import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const pantalla = await readFile(new URL('../src/screens/Plantillas.tsx', import.meta.url), 'utf8')

describe('vista móvil de Plantillas', () => {
  it('pone el nombre y las acciones en filas separadas antes del breakpoint sm', () => {
    expect(pantalla).toContain('flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between')
    expect(pantalla).toContain('flex flex-wrap items-center gap-1 self-start sm:shrink-0 sm:self-auto')
  })

  it('deja los destinos de cada rol con todo el ancho disponible en teléfono', () => {
    expect(pantalla).toContain('flex flex-col gap-2 sm:flex-row sm:items-center')
    expect(pantalla).toContain('label-inst shrink-0 sm:w-24')
    expect(pantalla).toContain('flex flex-wrap gap-1.5')
  })

  it('también apila el nombre y la acción de las plantillas archivadas', () => {
    expect(pantalla).toContain('panel flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between')
    expect(pantalla).toContain('className="self-start sm:shrink-0" tamano="sm"')
  })
})
