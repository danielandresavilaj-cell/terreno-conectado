import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { SignatureStroke } from '@terreno/shared'
import { Boton } from './ui'

const ESCALA = 1000

/** Convierte el punto de pantalla a coordenadas estables para cualquier tamaño de pad. */
export function puntoNormalizado(x: number, y: number, rect: { left: number; top: number; width: number; height: number }) {
  const limitar = (n: number) => Math.max(0, Math.min(ESCALA, Math.round(n)))
  return {
    x: limitar(((x - rect.left) / rect.width) * ESCALA),
    y: limitar(((y - rect.top) / rect.height) * ESCALA),
  }
}

export function firmaTieneTrazo(strokes: readonly SignatureStroke[]): boolean {
  return strokes.some((stroke) => stroke.points.length >= 2)
}

function puntosSvg(stroke: SignatureStroke): string {
  return stroke.points.map((p) => `${p.x / 4},${p.y / 4}`).join(' ')
}

/** Pad de firma vectorial. Guarda trazos, no una imagen de firma ni biometría. */
export function FirmaCierre({
  onCancelar,
  onConfirmar,
  modo = 'inspector',
}: {
  onCancelar: () => void
  onConfirmar: (strokes: SignatureStroke[]) => void
  modo?: 'inspector' | 'supervisor'
}) {
  const pad = useRef<SVGSVGElement>(null)
  const dialogo = useRef<HTMLElement>(null)
  const [strokes, setStrokes] = useState<SignatureStroke[]>([])
  const [dibujando, setDibujando] = useState(false)
  const esCofirma = modo === 'supervisor'

  const punto = (ev: PointerEvent<SVGSVGElement>) => {
    const rect = pad.current?.getBoundingClientRect()
    return rect ? puntoNormalizado(ev.clientX, ev.clientY, rect) : null
  }
  const iniciar = (ev: PointerEvent<SVGSVGElement>) => {
    const p = punto(ev)
    if (!p) return
    ev.currentTarget.setPointerCapture(ev.pointerId)
    setDibujando(true)
    setStrokes((prev) => [...prev, { points: [p] }])
  }
  const mover = (ev: PointerEvent<SVGSVGElement>) => {
    if (!dibujando) return
    const p = punto(ev)
    if (!p) return
    setStrokes((prev) => {
      const ultimo = prev.at(-1)
      if (!ultimo) return prev
      return [...prev.slice(0, -1), { points: [...ultimo.points, p] }]
    })
  }
  const terminar = () => setDibujando(false)

  // Como el diálogo de cámara (TSK-OFF-003): toma el foco al abrir y lo
  // devuelve al botón que lo abrió al cerrar; Escape cancela.
  useEffect(() => {
    const previo = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialogo.current?.focus()
    return () => {
      if (previo?.isConnected) previo.focus()
    }
  }, [])
  const alTeclado = (ev: KeyboardEvent<HTMLElement>) => {
    if (ev.key === 'Escape') {
      ev.preventDefault()
      onCancelar()
    }
  }

  return (
    <section
      role="dialog"
      aria-modal="true"
      aria-labelledby="firma-cierre-titulo"
      ref={dialogo}
      tabIndex={-1}
      onKeyDown={alTeclado}
      className="fixed inset-0 z-50 flex items-end bg-black/60 p-3 sm:items-center sm:justify-center outline-none"
    >
      <div className="w-full max-w-xl rounded-2xl border border-line bg-s1 p-5 shadow-2xl">
        <p className="label-inst">{esCofirma ? 'Cofirma de supervisión' : 'Cierre de inspección'}</p>
        <h2 id="firma-cierre-titulo" className="mt-1 text-[20px] font-semibold">{esCofirma ? 'Cofirma con tu dedo' : 'Firma con tu dedo'}</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
          {esCofirma
            ? 'Confirmas la revisión de esta inspección. La firma se guarda como trazo vinculado a este cierre.'
            : 'Declaro que completé esta inspección. La firma se guarda como trazo en este dispositivo y se sincroniza cuando vuelva la señal.'}
        </p>
        <svg
          ref={pad}
          viewBox="0 0 250 125"
          role="img"
          aria-label="Área para dibujar la firma"
          className="mt-4 h-48 w-full touch-none rounded-xl border-2 border-dashed border-line-strong bg-s0"
          onPointerDown={iniciar}
          onPointerMove={mover}
          onPointerUp={terminar}
          onPointerCancel={terminar}
        >
          {strokes.map((stroke, index) => (
            <polyline
              key={index}
              points={puntosSvg(stroke)}
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-ink"
            />
          ))}
        </svg>
        {!firmaTieneTrazo(strokes) && <p className="mt-2 text-[12px] text-ink-3">Dibuja al menos un trazo para continuar.</p>}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Boton tamano="sm" variante="fantasma" onClick={() => setStrokes([])}>Limpiar</Boton>
          <Boton tamano="sm" variante="secundaria" onClick={onCancelar}>Cancelar</Boton>
          <Boton tamano="sm" variante="primaria" disabled={!firmaTieneTrazo(strokes)} onClick={() => onConfirmar(strokes)}>
            {esCofirma ? 'Cofirmar inspección' : 'Firmar y enviar'}
          </Boton>
        </div>
      </div>
    </section>
  )
}
