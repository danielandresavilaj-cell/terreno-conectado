/* Fixtures compartidos de los tests de TSK-FORM-009.
 *
 * Vuelven DTOs VÁLIDOS (UUIDs en formato real, `published_seq` presente): los
 * esquemas de `@terreno/shared` validan el original antes de persistirlo, así
 * que un fixture con ids inventados haría fallar la fila por el motivo
 * equivocado.
 */
import type { TemplatePublicadaDto } from '@terreno/shared'
import { XLSX_MIME } from '@terreno/shared'

/** UUID determinístico por índice: los tests comparan ids en texto. */
export function uuid(n: number): string {
  return `01890000-0000-7000-8000-${n.toString(16).padStart(12, '0')}`
}

export const TENANT_A = uuid(1)
export const TENANT_B = uuid(2)

export const DEFINICION_MINIMA = {
  sections: [
    {
      id: uuid(900),
      title: 'Seguridad',
      items: [{ id: uuid(901), prompt: '¿EPP completo?', response_type: 'ok_nok_na' as const }],
    },
  ],
}

export function publicada(over: Partial<TemplatePublicadaDto> = {}): TemplatePublicadaDto {
  return {
    template_id: uuid(10),
    revision_id: uuid(11),
    tenant_id: TENANT_A,
    name: 'Chequeo de seguridad minera',
    version: 1,
    published_seq: 1,
    published_at: '2026-10-01T00:00:00.000Z',
    definition: DEFINICION_MINIMA,
    ...over,
  }
}

/** Bytes de un `.xlsx` de mentira: el caché guarda el blob tal cual llega. */
export function bytesFalsos(texto: string): Blob {
  return new Blob([texto], { type: XLSX_MIME })
}

export const META_ORIGINAL_BASE = {
  revision_id: uuid(11),
  tenant_id: TENANT_A,
  file_name: 'Chequeo de seguridad (rev 1).xlsx',
  mime: XLSX_MIME,
  bytes_length: 1024,
  cached_at: 1_760_000_000_000,
} as const