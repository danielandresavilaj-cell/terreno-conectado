/* Bloqueo del contrato del delta de plantillas (FR-027, TSK-FORM-009).
 *
 * El cursor pasó de `latest_version` a `latest_seq` porque `version` se asigna
 * POR PLANTILLA y un umbral global la saltaba. Este test falla si alguien
 * reintroduce el nombre viejo, que es el error que haría que el delta volviera
 * a perder revisiones silenciosamente.
 */
import { describe, expect, it } from 'vitest'
import {
  MAX_NOMBRE_ARCHIVO,
  nombreArchivoDeContentDisposition,
  templateOriginalMetaSchema,
  templatesDeltaResponseSchema,
  XLSX_MIME,
} from './templates'

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

/* El nombre del original es lo único que NO puede perder el cliente: es la fila
 * `file_name` de la caché local (FR-019) y el rótulo del `.xlsx` exportado en
 * TSK-FORM-010. Como el valor viene de un upload remoto, este test fija sobre
 * todo que NUNCA sale un nombre con separadores de ruta. */
describe("nombre del documento original (Content-Disposition, RFC 6266)", () => {
  it('decodifica la `filename*` percent-encoded: es la única que conserva acentos', () => {
    // Un header HTTP sólo transporta latin1, así que el backend manda el nombre
    // con `encodeURIComponent` dentro de la `filename*`.
    const nombre = 'Memoria anual ñandú — revisión Nº2.xlsx'
    const header = `attachment; filename="memoria_annual.xlsx"; filename*=UTF-8''${encodeURIComponent(nombre)}`

    expect(nombreArchivoDeContentDisposition(header)).toBe(nombre)
  })

  it('cae a la `filename` ASCII cuando no hay `filename*`', () => {
    expect(nombreArchivoDeContentDisposition('attachment; filename="control-diario.xlsx"')).toBe(
      'control-diario.xlsx',
    )
  })

  it('la rama ASCII NO decodifica: un `%` legítimo sobrevive', () => {
    // Por RFC 6266 `filename` es un literal ASCII, no percent-encoding.
    // Decodificarlo convertiría un nombre válido en otro distinto —o en un
    // error— cuando el `filename*` extendido es el único que va codificado.
    expect(nombreArchivoDeContentDisposition('attachment; filename="100% roto.xlsx"')).toBe(
      '100% roto.xlsx',
    )
  })

  it('decodifica la rama extendida ANTES de sanear, así un %2F no sobrevive', () => {
    expect(
      nombreArchivoDeContentDisposition("attachment; filename*=UTF-8''a%2Fb%2Fc.xlsx"),
    ).toBe('c.xlsx')
    expect(
      nombreArchivoDeContentDisposition("attachment; filename*=UTF-8''..%2F..%2Fetc%2Fpasswd"),
    ).toBe('passwd')
  })

  it('sin cabecera, o vacía, no hay nombre: `null` deja que el cliente decida el fallback', () => {
    expect(nombreArchivoDeContentDisposition(null)).toBeNull()
    expect(nombreArchivoDeContentDisposition('')).toBeNull()
    expect(nombreArchivoDeContentDisposition('inline')).toBeNull()
  })

  it('un percent-encoding inválido da `null` en vez de tumbar la descarga', () => {
    // `% roto` no es un percent-encoding válido: `decodeURIComponent` lanzaría
    // URIError y el original se perdería por un header corrupto. El parser debe
    // tragarse el fallo y devolver `null`.
    expect(nombreArchivoDeContentDisposition("attachment; filename*=UTF-8''100% roto.xlsx")).toBeNull()
  })

  it('NUNCA deja salir una ruta: `../../etc/passwd` se queda sólo con el base', () => {
    // Un traversal completo escribiría FUERA del directorio de exportación
    // (TSK-FORM-010). El contrato no lo rechaza sino que lo degrada al nombre
    // de archivo, que es la garantía que importa: el resultado no contiene `/`.
    const header = "attachment; filename*=UTF-8''../../etc/passwd"

    expect(nombreArchivoDeContentDisposition(header)).toBe('passwd')
  })

  it('NUNCA deja salir separadores de ruta en ningún lado: `a/b/c.xlsx` → `c.xlsx`', () => {
    expect(nombreArchivoDeContentDisposition('attachment; filename="a/b/c.xlsx"')).toBe('c.xlsx')
  })

  it('rechaza un nombre con caracteres de control (rompe el header y el disco)', () => {
    // Un `\n` crudo en un header real ni siquiera llegaría (rompe el protocolo);
    // si llegara, es un intento de inyección y no puede usarse como nombre.
    expect(nombreArchivoDeContentDisposition('attachment; filename="a\nb.xlsx"')).toBeNull()
    expect(nombreArchivoDeContentDisposition("attachment; filename*=UTF-8''a%0Ab.xlsx")).toBeNull()
  })

  it(`rechaza un nombre más largo que MAX_NOMBRE_ARCHIVO (${MAX_NOMBRE_ARCHIVO})`, () => {
    // El tope cuenta el nombre ENTERO, extensión incluida.
    const justo = 'a'.repeat(MAX_NOMBRE_ARCHIVO)

    expect(nombreArchivoDeContentDisposition(`attachment; filename="${justo}"`)).toBe(justo)
    expect(nombreArchivoDeContentDisposition(`attachment; filename="${justo}x"`)).toBeNull()
  })
})