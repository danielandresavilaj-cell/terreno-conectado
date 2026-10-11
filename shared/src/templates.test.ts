/* Bloqueo del contrato del delta de plantillas (FR-027, TSK-FORM-009).
 *
 * El cursor pasó de `latest_version` a `latest_seq` porque `version` se asigna
 * POR PLANTILLA y un umbral global la saltaba. Este test falla si alguien
 * reintroduce el nombre viejo, que es el error que haría que el delta volviera
 * a perder revisiones silenciosamente.
 */
import { describe, expect, it } from 'vitest'
import { templateOriginalMetaSchema, templatesDeltaResponseSchema, XLSX_MIME } from './templates'

const definicion = {
  sections: [
    {
      id: '01890000-0000-7000-8000-0000000000d1',
      title: 'Seguridad',
      items: [
        {
          id: '01890000-0000-7000-8000-0000000000e1',
          prompt: '¿EPP completo?',
          response_type: 'ok_nok_na' as const,
        },
      ],
    },
  ],
}

const publicada = {
  template_id: '01890000-0000-7000-8000-0000000000a6',
  revision_id: '01890000-0000-7000-8000-0000000000a8',
  tenant_id: '01890000-0000-7000-8000-0000000000a1',
  name: 'Chequeo de seguridad minera',
  version: 1,
  published_seq: 7,
  published_at: '2026-10-01T00:00:00.000Z',
  definition: definicion,
}

describe('contrato del delta (FR-027)', () => {
  it('acepta latest_seq y las revisiones con published_seq', () => {
    const r = templatesDeltaResponseSchema.safeParse({ items: [publicada], latest_seq: 7 })
    expect(r.success).toBe(true)
  })

  it('RECHAZA latest_version: el cursor viejo saltaba revisiones', () => {
    const r = templatesDeltaResponseSchema.safeParse({ items: [], latest_version: 1 })
    expect(r.success).toBe(false)
  })

  it('exige published_seq en cada revisión (sin él nunca entraría al delta)', () => {
    const { published_seq: _omitido, ...sinSeq } = publicada
    const r = templatesDeltaResponseSchema.safeParse({ items: [sinSeq], latest_seq: 1 })
    expect(r.success).toBe(false)
  })

  it('admite latest_seq nulo (tenant sin publicadas)', () => {
    const r = templatesDeltaResponseSchema.safeParse({ items: [], latest_seq: null })
    expect(r.success).toBe(true)
  })
})

describe('metadatos del documento original (FR-018/019)', () => {
  const meta = {
    revision_id: '01890000-0000-7000-8000-0000000000a8',
    tenant_id: '01890000-0000-7000-8000-0000000000a1',
    file_name: 'control-diario.xlsx',
    mime: XLSX_MIME,
    bytes_length: 1234,
    cached_at: 1_760_000_000_000,
  }

  it('valida la fila que el dispositivo persiste en IndexedDB', () => {
    expect(templateOriginalMetaSchema.safeParse(meta).success).toBe(true)
  })

  it('rechaza un mime que no sea el libro de V1 (ADR-003)', () => {
    expect(templateOriginalMetaSchema.safeParse({ ...meta, mime: 'application/pdf' }).success).toBe(false)
  })

  it('rechaza un tamaño no positivo (un original vacío no es exportable)', () => {
    expect(templateOriginalMetaSchema.safeParse({ ...meta, bytes_length: 0 }).success).toBe(false)
  })
})