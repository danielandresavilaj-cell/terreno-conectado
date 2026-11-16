import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const dashboard = await readFile(new URL('../src/screens/Dashboard.tsx', import.meta.url), 'utf8')
const exportacion = await readFile(new URL('../src/components/dashboard/PanelExportar.tsx', import.meta.url), 'utf8')

describe('inspecciones de período en móvil', () => {
  it('usa un resumen compacto separado de la tabla de escritorio', () => {
    expect(dashboard).toContain('grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-start gap-x-2.5 gap-y-1 lg:hidden')
    expect(dashboard).toContain('className={`${COLUMNAS_INSPECCION} hidden`}')
  })

  it('mantiene el contexto y las dos acciones táctiles del registro', () => {
    expect(dashboard).toContain('{i.faena_nombre}')
    expect(dashboard).toContain('{i.ejecutado_por}')
    expect(dashboard).toContain('Descargar PDF de ${i.template_nombre ?? i.faena_nombre}')
    expect(dashboard).toContain("{descargando ? '…' : 'PDF'}")
  })

  it('muestra los cuatro formatos de exportación en una cuadrícula móvil de dos columnas', () => {
    expect(exportacion).toContain('grid grid-cols-2 gap-1.5 lg:grid-cols-4')
    expect(exportacion).toContain('panel space-y-2.5 p-3 sm:p-4')
  })
})
