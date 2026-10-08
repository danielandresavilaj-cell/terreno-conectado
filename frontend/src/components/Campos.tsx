/* Controles del motor de render data-driven (TSK-FORM-001, FR-036).
 *
 * Cada componente dibuja UN `response_type` y emite el valor ya "crudo" — la
 * validación contra `props` (FR-039) la hace el store antes de persistir, así
 * el control nunca escribe solo. Los estilos son los del mockup de captura:
 * targets grandes (≥44 px), alto contraste, pensados para guantes y sol.
 */

import { useRef } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import type { CampoValor, TemplateItem } from '@terreno/shared'
import { EASE } from '../lib/motion'

const INPUT =
  'h-11 w-full sm:w-auto sm:max-w-[190px] px-3 rounded-[10px] bg-s0 border border-line-soft text-[14px] placeholder:text-ink-3 focus:border-beam transition-colors duration-150 shrink-0'

const CHIP_BASE =
  'min-h-[46px] px-3.5 rounded-xl border text-[13px] font-medium tracking-[-0.01em] transition-colors duration-150 cursor-pointer'

export interface PropsCampo {
  item: TemplateItem
  valor: CampoValor | null | undefined
  error?: string | undefined
  onCambio: (valor: CampoValor) => void
}

/* ── ok / nok / na ───────────────────────────────────────────────────────
 * El control estrella del producto: segmentado con knob deslizante (no un
 * cambio de color) para que el usuario vea QUÉ opción está activa antes de
 * leer la etiqueta. Pop del knob en spring 260 ms: rápido, con "golpe". */
const OPCIONES = [
  { v: 'ok' as const, label: 'OK', color: 'var(--color-synced)', desc: 'Conforme' },
  { v: 'nok' as const, label: 'NOK', color: 'var(--color-failed)', desc: 'No conforme' },
  { v: 'na' as const, label: 'N/A', color: 'var(--color-pending)', desc: 'No aplica' },
]

export function CampoOkNokNa({ valor, onCambio, item }: PropsCampo) {
  const reducir = useReducedMotion()
  const v = valor === 'ok' || valor === 'nok' || valor === 'na' ? valor : null
  const activo = OPCIONES.find((o) => o.v === v) ?? null
  const idx = Math.max(0, OPCIONES.findIndex((o) => o.v === v))
  return (
    <div
      role="radiogroup"
      aria-label={`Respuesta para: ${item.prompt}`}
      className="relative shrink-0 flex p-1 rounded-xl bg-s0 border border-line-soft w-full sm:w-auto"
    >
      {/* Knob activo: `x` en % del ancho del track (transform puro, GPU,
          interruptible si corrige la respuesta rápido). */}
      {activo && (
        <motion.span
          aria-hidden
          initial={false}
          animate={{ x: `${idx * 100}%` }}
          transition={reducir ? { duration: 0 } : { type: 'spring', duration: 0.34, bounce: 0.22 }}
          className="absolute top-1 bottom-1 left-1 rounded-lg"
          style={{
            width: `calc((100% - 8px) / ${OPCIONES.length})`,
            background: `color-mix(in oklab, ${activo.color} 20%, transparent)`,
            border: `1px solid color-mix(in oklab, ${activo.color} 45%, transparent)`,
          }}
        />
      )}
      {OPCIONES.map((o) => {
        const sel = v === o.v
        return (
          <motion.button
            key={o.v}
            role="radio"
            aria-checked={sel}
            title={o.desc}
            onClick={() => onCambio(o.v)}
            whileTap={reducir ? undefined : { scale: 0.94 }}
            transition={{ duration: 0.14, ease: EASE.out }}
            className="relative z-10 h-12 min-w-[46px] flex-1 grid place-items-center rounded-lg cursor-pointer"
          >
            <motion.span
              animate={{ color: sel ? o.color : 'var(--color-ink-3)' }}
              transition={{ duration: 0.18, ease: EASE.out }}
              className="num-inst text-[13px] font-semibold tracking-[0.04em]"
            >
              {o.label}
            </motion.span>
          </motion.button>
        )
      })}
    </div>
  )
}

/* ── texto libre ───────────────────────────────────────────────────────── */
export function CampoTexto({ valor, onCambio, item }: PropsCampo) {
  return (
    <input
      value={typeof valor === 'string' ? valor : ''}
      maxLength={item.props?.max_length}
      placeholder="Escribir…"
      onChange={(e) => onCambio(e.target.value)}
      className={INPUT}
    />
  )
}

/* ── numérico (decimal con coma o punto) ───────────────────────────────── */
export function CampoNumerico({ valor, onCambio, item }: PropsCampo) {
  const props = item.props ?? {}
  return (
    <input
      value={typeof valor === 'number' ? String(valor) : typeof valor === 'string' ? valor : ''}
      inputMode="decimal"
      placeholder="0,00"
      min={typeof props.min === 'number' ? props.min : undefined}
      max={typeof props.max === 'number' ? props.max : undefined}
      onChange={(e) => {
        const t = e.target.value
        if (t === '') {
          onCambio('')
          return
        }
        const n = Number(t.replace(',', '.'))
        onCambio(Number.isNaN(n) ? t : n)
      }}
      className={INPUT}
    />
  )
}

/* ── fecha / hora ──────────────────────────────────────────────────────── */
export function CampoFecha({ valor, onCambio, item }: PropsCampo) {
  const props = item.props ?? {}
  return (
    <input
      type="date"
      value={typeof valor === 'string' ? valor : ''}
      min={typeof props.min === 'string' ? props.min : undefined}
      max={typeof props.max === 'string' ? props.max : undefined}
      onChange={(e) => onCambio(e.target.value)}
      className={INPUT}
    />
  )
}

export function CampoHora({ valor, onCambio }: PropsCampo) {
  return (
    <input
      type="time"
      value={typeof valor === 'string' ? valor : ''}
      onChange={(e) => onCambio(e.target.value)}
      className={INPUT}
    />
  )
}

/* ── selección simple / múltiple ─────────────────────────────────────────
 * Chips en vez de `<select>`: con guantes un desplegable es un cuello de
 * botella, y las opciones del protocolo son pocas (2–6). Togglear una ya
 * elegida la limpia (vuelve a vacío). */
function ChipOpcion({
  label,
  activo,
  onClick,
  multiple,
}: {
  label: string
  activo: boolean
  onClick: () => void
  multiple?: boolean
}) {
  const reducir = useReducedMotion()
  return (
    <motion.button
      type="button"
      aria-pressed={activo}
      onClick={onClick}
      whileTap={reducir ? undefined : { scale: 0.96 }}
      transition={{ duration: 0.14, ease: EASE.out }}
      className={[
        CHIP_BASE,
        activo ? 'border-beam/50 bg-beam/10 text-ink' : 'border-line-soft bg-s0 text-ink-2',
      ].join(' ')}
    >
      {multiple && (
        <span
          aria-hidden
          className={[
            'inline-block h-3.5 w-3.5 mr-1.5 rounded-[4px] border align-[-2px]',
            activo ? 'bg-beam border-beam' : 'border-ink-3',
          ].join(' ')}
        />
      )}
      {label}
    </motion.button>
  )
}

export function CampoSeleccion({ valor, onCambio, item }: PropsCampo) {
  const opciones = item.props?.options ?? []
  const v = typeof valor === 'string' ? valor : ''
  return (
    <div className="flex flex-wrap gap-2 w-full sm:w-auto sm:justify-end shrink-0">
      {opciones.map((o) => (
        <ChipOpcion
          key={o}
          label={o}
          activo={v === o}
          onClick={() => onCambio(v === o ? '' : o)}
        />
      ))}
    </div>
  )
}

export function CampoSeleccionMultiple({ valor, onCambio, item }: PropsCampo) {
  const opciones = item.props?.options ?? []
  const arr = Array.isArray(valor) ? valor.filter((x): x is string => typeof x === 'string') : []
  return (
    <div className="flex flex-wrap gap-2 w-full sm:w-auto sm:justify-end shrink-0">
      {opciones.map((o) => (
        <ChipOpcion
          key={o}
          label={o}
          multiple
          activo={arr.includes(o)}
          onClick={() => onCambio(arr.includes(o) ? arr.filter((x) => x !== o) : [...arr, o])}
        />
      ))}
    </div>
  )
}

/* ── foto ────────────────────────────────────────────────────────────────
 * `capture="environment"` abre la cámara trasera en móvil. El binario se
 * comprime (FR-012) y vive en `valuePhoto` local hasta TSK-FORM-004; el
 * valor del campo queda como referencia no vacía ('capturada'). */
export function CampoFoto({ valor, onCambio, onFoto, error }: PropsCampo & {
  onFoto: (archivo: File) => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  const hay = typeof valor === 'string' && valor.length > 0
  return (
    <div className="flex items-center gap-3 w-full sm:w-auto justify-start sm:justify-end shrink-0">
      <input
        ref={ref}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onFoto(f)
          e.target.value = ''
        }}
      />
      {hay ? (
        <>
          <span className="text-[13px] font-medium text-synced whitespace-nowrap">
            Foto capturada
          </span>
          <button
            type="button"
            onClick={() => onCambio(null)}
            className={[
              'text-[12px] text-ink-2 underline underline-offset-2 cursor-pointer',
              error ? 'text-failed' : '',
            ].join(' ')}
          >
            Quitar
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => ref.current?.click()}
          className="h-11 px-4 rounded-[10px] border border-line-soft bg-s0 text-[13px] font-medium cursor-pointer hover:border-beam transition-colors duration-150"
        >
          Tomar foto
        </button>
      )}
    </div>
  )
}
