/* Ficha de hallazgo en Gerencia — TSK-REP-018 / TSK-REP-019. */
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const dashboard = await readFile(new URL('../src/screens/Dashboard.tsx', import.meta.url), 'utf8')

describe('gestión de hallazgos', () => {
  it('en el teléfono la descripción ocupa todo el ancho y Estado y Gestionar van debajo, en una fila', () => {
    // La descripción toma la línea completa bajo 640 px y vuelve a ser columna flexible desde `sm`.
    expect(dashboard).toContain('order-1 sm:order-none basis-full sm:basis-auto min-w-0 sm:flex-1')
    // Estado y Gestionar: fila bajo la descripción en el teléfono, columna lateral desde `sm`.
    expect(dashboard).toContain('flex flex-row sm:flex-col items-end sm:items-stretch gap-2')
    expect(dashboard).toContain('h-11 w-full px-2 rounded-[10px]')
  })

  it('delimita visualmente el botón Gestionar sin cambiar su control de apertura', () => {
    expect(dashboard).toContain('variante="secundaria"')
    expect(dashboard).toContain('aria-expanded={editando}')
  })
})

describe('detalle de la inspección en su misma ficha (TSK-REP-019)', () => {
  it('ya no hay un panel al final de la lista ni desplazamiento automático hacia él', () => {
    expect(dashboard).not.toContain('scrollIntoView')
    expect(dashboard).toContain('detalle={origenDetalle === \'lista\' && idDetalle === i.id ? panelDetalle : null}')
  })

  it('"Ver" alterna con "Cerrar" y anuncia si está desplegado', () => {
    expect(dashboard).toContain("{abierta ? 'Cerrar' : 'Ver'}")
    expect(dashboard).toContain('aria-expanded={abierta}')
  })
})
