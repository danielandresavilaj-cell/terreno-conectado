import { describe, expect, it } from 'vitest'
import { construirCsvHallazgos, CABECERAS_CSV_HALLAZGOS } from '../src/lib/dashboard-csv'
import type { FindingDto } from '@terreno/shared'

const id1 = crypto.randomUUID()
const id2 = crypto.randomUUID()

const base: Omit<FindingDto, 'severity' | 'status' | 'description'> = {
  id: '',
  faena_id: null,
  faena_nombre: null,
  autor_id: null,
  autor: null,
  captured_at: '2026-10-14T12:00:00.000Z',
  synced_at: null,
  foto_id: null,
  foto_mime: null,
  foto_bytes: null,
  foto_ancho: null,
  foto_alto: null,
}

const hallazgos: FindingDto[] = [
  {
    ...base,
    id: id1,
    severity: 'high',
    status: 'open',
    description: 'Falla, en "cabina" con, comas',
    faena_nombre: 'Mina Norte',
    autor: 'Pedro Trabajador',
  },
  {
    ...base,
    id: id2,
    severity: 'critical',
    status: 'resolved',
    description: 'Otra',
    faena_nombre: null,
    autor: null,
  },
]

describe('dashboard-csv (FR-042)', () => {
  it('incluye la cabecera esperada', () => {
    const csv = construirCsvHallazgos([])
    expect(csv).toBe([...CABECERAS_CSV_HALLAZGOS].map((c) => `"${c}"`).join(','))
  })

  it('genera una fila por hallazgo con las columnas correctas', () => {
    const csv = construirCsvHallazgos(hallazgos)
    const [header, row1, row2] = csv.split('\n')
    expect(header).toBe('"id","severidad","estado","faena","autor","capturado_at"')
    expect(row1).toBe(`"${id1}","high","open","Mina Norte","Pedro Trabajador","2026-10-14T12:00:00.000Z"`)
    expect(row2).toBe(`"${id2}","critical","resolved","","","2026-10-14T12:00:00.000Z"`)
  })

  it('escapa comillas duplicándolas y envuelve en comillas', () => {
    const h: FindingDto = {
      ...base,
      id: 'id-1',
      severity: 'low',
      status: 'in_progress',
      description: 'ignore',
      faena_nombre: 'Faena con "comillas"',
      autor: 'Autor, con, comas',
    }
    const csv = construirCsvHallazgos([h])
    const [, row] = csv.split('\n')
    expect(row).toBe('"id-1","low","in_progress","Faena con ""comillas""","Autor, con, comas","2026-10-14T12:00:00.000Z"')
  })

  it('no incluye BOM ni terminadores extraños', () => {
    const csv = construirCsvHallazgos(hallazgos)
    expect(csv.startsWith('\uFEFF')).toBe(false)
    expect(csv.endsWith('\n')).toBe(false)
  })
})
