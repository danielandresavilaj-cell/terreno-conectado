/* Controles del motor de render data-driven (TSK-FORM-001, FR-036).
 *
 * Cada componente dibuja UN `response_type` y emite el valor ya "crudo" — la
 * validación contra `props` (FR-039) la hace el store antes de persistir, así
 * el control nunca escribe solo. Targets grandes (≥44 px) y alto contraste:
 * pensados para guantes y sol.
 */

import { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import type { CampoValor, TemplateItem } from '@terreno/shared'
import { CamaraCaptura } from './CamaraCaptura'
import { EASE } from '../lib/motion'
import {
  esEdicionNumericaPosible,
  numeroDesdeEdicion,
  numeroDentroDeRango,
} from '../lib/campo-numerico'

const INPUT =
  'h-11 w-full sm:w-auto sm:max-w-[190px] px-3 rounded-[10px] bg-s0 border border-campo text-[14px] placeholder:text-ink-3 focus:border-beam transition-colors duration-150 shrink-0'

const CHIP_BASE =
  'min-h-[46px] px-3.5 rounded-xl border text-[13px] font-medium tracking-[-0.01em] transition-colors duration-150 cursor-pointer'

export interface PropsCampo {
  item: TemplateItem
  valor: CampoValor | null | undefined
  error?: string | undefined
  onCambio: (valor: CampoValor) => void
}

function atributosRespuesta(item: TemplateItem, error?: string) {
  return {
    'aria-label': `Respuesta para: ${item.prompt}`,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? `respuesta-error-${item.id}` : undefined,
  }
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

export function CampoOkNokNa({ valor, onCambio, item, error }: PropsCampo) {
  const reducir = useReducedMotion()
  const v = valor === 'ok' || valor === 'nok' || valor === 'na' ? valor : null
  const activo = OPCIONES.find((o) => o.v === v) ?? null
  const idx = Math.max(0, OPCIONES.findIndex((o) => o.v === v))
  return (
    <div
      role="radiogroup"
      aria-label={`Respuesta para: ${item.prompt}`}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `respuesta-error-${item.id}` : undefined}
      className="relative shrink-0 flex p-1 rounded-xl bg-s0 border border-campo w-full sm:w-auto"
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
              animate={{ color: sel ? o.color : 'var(--color-ink-2)' }}
              transition={{ duration: 0.18, ease: EASE.out }}
              className="num-inst text-[14px] font-semibold tracking-[0.04em]"
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
export function CampoTexto({ valor, onCambio, item, error }: PropsCampo) {
  return (
    <input
      value={typeof valor === 'string' ? valor : ''}
      maxLength={item.props?.max_length}
      name={`respuesta-${item.id}`}
      {...atributosRespuesta(item, error)}
      placeholder="Escribir…"
      onChange={(e) => onCambio(e.target.value)}
      className={INPUT}
    />
  )
}

/* ── numérico (decimal con coma o punto) ───────────────────────────────── */
export function CampoNumerico({ valor, onCambio, item, error }: PropsCampo) {
  const props = item.props ?? {}
  const valorInicial = typeof valor === 'number' ? String(valor) : typeof valor === 'string' ? valor : ''
  const [texto, setTexto] = useState(valorInicial)
  const editando = useRef(false)

  // Una respuesta restaurada, un valor automático o un cambio desde otra
  // pantalla actualizan el control. Mientras se escribe, en cambio, no se
  // pisa el texto parcial por el último número válido guardado.
  useEffect(() => {
    if (!editando.current) setTexto(valorInicial)
  }, [valorInicial])

  const confirmar = () => {
    editando.current = false
    if (texto === '') {
      onCambio('')
      return
    }
    const numero = numeroDesdeEdicion(texto)
    // En blur sí se comunica el error de formato/rango al store. Durante la
    // escritura sólo se guarda cuando el valor completo ya es válido.
    onCambio(numero ?? texto)
  }

  return (
    <input
      value={texto}
      inputMode="decimal"
      name={`respuesta-${item.id}`}
      {...atributosRespuesta(item, error)}
      placeholder="0,00"
      min={typeof props.min === 'number' ? props.min : undefined}
      max={typeof props.max === 'number' ? props.max : undefined}
      onFocus={() => {
        editando.current = true
      }}
      onChange={(e) => {
        const t = e.target.value
        if (!esEdicionNumericaPosible(t)) return
        setTexto(t)
        const numero = numeroDesdeEdicion(t)
        if (numero !== null && numeroDentroDeRango(numero, props)) onCambio(numero)
      }}
      onBlur={confirmar}
      className={INPUT}
    />
  )
}

/* ── fecha / hora ──────────────────────────────────────────────────────── */
export function CampoFecha({ valor, onCambio, item, error }: PropsCampo) {
  const props = item.props ?? {}
  return (
    <input
      type="date"
      name={`respuesta-${item.id}`}
      {...atributosRespuesta(item, error)}
      value={typeof valor === 'string' ? valor : ''}
      min={typeof props.min === 'string' ? props.min : undefined}
      max={typeof props.max === 'string' ? props.max : undefined}
      onChange={(e) => onCambio(e.target.value)}
      className={INPUT}
    />
  )
}

export function CampoHora({ valor, onCambio, item, error }: PropsCampo) {
  return (
    <input
      type="time"
      name={`respuesta-${item.id}`}
      {...atributosRespuesta(item, error)}
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
        activo ? 'border-beam bg-beam/10 text-ink' : 'border-campo bg-s0 text-ink-2',
      ].join(' ')}
    >
      {multiple && (
        <span
          aria-hidden
          className={[
            'inline-block h-3.5 w-3.5 mr-1.5 rounded-[4px] border align-[-2px]',
            activo ? 'bg-beam border-beam' : 'border-campo',
          ].join(' ')}
        />
      )}
      {label}
    </motion.button>
  )
}

export function CampoSeleccion({ valor, onCambio, item, error }: PropsCampo) {
  const opciones = item.props?.options ?? []
  const v = typeof valor === 'string' ? valor : ''
  return (
    <div
      role="group"
      aria-label={`Respuesta para: ${item.prompt}`}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `respuesta-error-${item.id}` : undefined}
      className="flex flex-wrap gap-2 w-full sm:w-auto sm:justify-end shrink-0"
    >
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

export function CampoSeleccionMultiple({ valor, onCambio, item, error }: PropsCampo) {
  const opciones = item.props?.options ?? []
  const arr = Array.isArray(valor) ? valor.filter((x): x is string => typeof x === 'string') : []
  return (
    <div
      role="group"
      aria-label={`Respuestas para: ${item.prompt}`}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `respuesta-error-${item.id}` : undefined}
      className="flex flex-wrap gap-2 w-full sm:w-auto sm:justify-end shrink-0"
    >
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
 * La cámara se abre con `getUserMedia` y prefiere el lente trasero. El binario
 * se comprime (FR-012) y vive en un ATTACHMENT `owner_type='response'`
 * (FR-037, TSK-FORM-004); el valor del campo queda como referencia no vacía
 * ('capturada'). */
export function CampoFoto({ valor, onCambio, onFoto, error, item, cargarFoto }: PropsCampo & {
  onFoto: (archivo: File) => void
  /** TSK-OFF-011: foto ya guardada del ítem, para mostrar la miniatura al volver. */
  cargarFoto?: (itemId: string) => Promise<Blob | null>
}) {
  const [camaraAbierta, setCamaraAbierta] = useState(false)
  const hay = typeof valor === 'string' && valor.length > 0
  /* La persona ve la foto que quedó como evidencia, no sólo "Foto capturada".
   * La recién tomada se muestra al instante; la guardada se lee del teléfono. */
  const [recien, setRecien] = useState<File | null>(null)
  const [guardada, setGuardada] = useState<Blob | null>(null)
  useEffect(() => {
    if (!hay) {
      setRecien(null)
      setGuardada(null)
      return
    }
    if (recien || !cargarFoto) return
    let vivo = true
    void cargarFoto(item.id).then((b) => {
      if (vivo) setGuardada(b)
    })
    return () => {
      vivo = false
    }
  }, [hay, recien, cargarFoto, item.id])
  const visible = recien ?? guardada
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!visible) {
      setUrl(null)
      return
    }
    const u = URL.createObjectURL(visible)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [visible])
  return (
    <div
      role="group"
      aria-label={`Respuesta para: ${item.prompt}`}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `respuesta-error-${item.id}` : undefined}
      className="flex items-center gap-3 w-full sm:w-auto justify-start sm:justify-end shrink-0"
    >
      <CamaraCaptura
        abierta={camaraAbierta}
        alCerrar={() => setCamaraAbierta(false)}
        alCapturar={(f) => {
          setRecien(f)
          onFoto(f)
        }}
      />
      {hay ? (
        <>
          {url ? (
            <img
              src={url}
              alt={`Foto de: ${item.prompt}`}
              width={56}
              height={56}
              className="h-14 w-14 rounded-lg object-cover border border-campo shrink-0"
            />
          ) : (
            <span className="text-[14px] font-medium text-synced whitespace-nowrap">Foto capturada</span>
          )}
          <button
            type="button"
            onClick={() => setCamaraAbierta(true)}
            className="min-h-11 px-3 rounded-[10px] border border-campo bg-s0 text-[14px] font-medium cursor-pointer"
          >
            Repetir
          </button>
          <button
            type="button"
            onClick={() => onCambio(null)}
            className={[
              'min-h-11 px-2 text-[14px] text-ink-2 underline underline-offset-2 cursor-pointer',
              error ? 'text-failed' : '',
            ].join(' ')}
          >
            Quitar
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setCamaraAbierta(true)}
          className="h-11 px-4 rounded-[10px] border border-campo bg-s0 text-[14px] font-medium cursor-pointer hover:border-beam transition-colors duration-150"
        >
          Tomar foto
        </button>
      )}
    </div>
  )
}
