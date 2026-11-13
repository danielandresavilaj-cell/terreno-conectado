/* Foto de evidencia en supervisión — TSK-REP-008 (FR-062).
 *
 * Miniatura que se baja sólo cuando entra en pantalla y, al tocarla, se abre a
 * tamaño completo. La imagen no se puede poner en un `<img src>` directo: la
 * sesión viaja en la cabecera `Authorization`, no en una cookie, así que los
 * bytes se piden con el cliente de la API y se muestran desde una URL de objeto
 * que se libera al desmontar.
 *
 * MOVIMIENTO: ninguno. Es evidencia que se inspecciona; aparece y ya.
 */

import { useEffect, useRef, useState } from 'react'
import { getFotoAdjunto } from '../lib/api'
import { crearCacheFotos } from '../lib/fotos'
import { useCapaAtras } from '../lib/useCapaAtras'

const cache = crearCacheFotos(getFotoAdjunto)

type Estado = 'esperando' | 'cargando' | 'lista' | 'error'

export function FotoEvidencia({ id, etiqueta }: { id: string; etiqueta: string }) {
  const marco = useRef<HTMLButtonElement>(null)
  const [visible, setVisible] = useState(false)
  const [estado, setEstado] = useState<Estado>('esperando')
  const [url, setUrl] = useState<string | null>(null)
  const [intento, setIntento] = useState(0)
  const [abierta, setAbierta] = useState(false)

  // Sólo se baja lo que la persona llega a ver: un listado largo de hallazgos
  // no dispara decenas de descargas al abrir el panel.
  useEffect(() => {
    const el = marco.current
    if (!el || visible) return
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }
    const observador = new IntersectionObserver(
      (entradas) => {
        if (entradas.some((e) => e.isIntersecting)) setVisible(true)
      },
      { rootMargin: '200px' },
    )
    observador.observe(el)
    return () => observador.disconnect()
  }, [visible])

  useEffect(() => {
    if (!visible) return
    let vivo = true
    let creada: string | null = null
    setEstado('cargando')
    cache.pedir(id).then(
      (blob) => {
        if (!vivo) return
        creada = URL.createObjectURL(blob)
        setUrl(creada)
        setEstado('lista')
      },
      () => {
        if (vivo) setEstado('error')
      },
    )
    return () => {
      vivo = false
      if (creada) URL.revokeObjectURL(creada)
      setUrl(null)
    }
  }, [id, visible, intento])

  return (
    <>
      <button
        ref={marco}
        type="button"
        onClick={() => {
          if (estado === 'error') setIntento((n) => n + 1)
          else if (estado === 'lista') setAbierta(true)
        }}
        aria-label={estado === 'error' ? `${etiqueta}: no se pudo cargar, reintentar` : `${etiqueta}: ver en grande`}
        aria-busy={estado === 'cargando'}
        className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-campo bg-s3 grid place-items-center cursor-pointer"
      >
        {url ? (
          <img src={url} alt="" width={64} height={64} className="h-full w-full object-cover" />
        ) : estado === 'error' ? (
          <span className="px-1 text-center text-[11px] leading-tight text-failed">Reintentar</span>
        ) : (
          <svg width="20" height="20" viewBox="0 0 17 17" fill="none" aria-hidden className="text-ink-3">
            <path d="M2.5 4.5h3l1.2-1.6h3.6l1.2 1.6h3v9h-12v-9Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
            <circle cx="8.5" cy="8.8" r="2.3" stroke="currentColor" strokeWidth="1.3" />
          </svg>
        )}
      </button>
      {abierta && url && <VisorFoto url={url} etiqueta={etiqueta} alCerrar={() => setAbierta(false)} />}
    </>
  )
}

function VisorFoto({ url, etiqueta, alCerrar }: { url: string; etiqueta: string; alCerrar: () => void }) {
  const cerrar = useRef<HTMLButtonElement>(null)
  useCapaAtras(true, alCerrar)

  useEffect(() => {
    const previo = document.activeElement instanceof HTMLElement ? document.activeElement : null
    cerrar.current?.focus()
    const alTeclado = (e: KeyboardEvent) => {
      if (e.key === 'Escape') alCerrar()
    }
    window.addEventListener('keydown', alTeclado)
    return () => {
      window.removeEventListener('keydown', alTeclado)
      if (previo?.isConnected) previo.focus()
    }
  }, [alCerrar])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={etiqueta}
      onClick={alCerrar}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/85 p-4 overscroll-contain"
    >
      <img
        src={url}
        alt={etiqueta}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[80dvh] max-w-full rounded-lg object-contain"
      />
      <button
        ref={cerrar}
        type="button"
        onClick={alCerrar}
        className="h-11 px-5 rounded-[10px] bg-s1 border border-campo text-[14px] font-medium text-ink cursor-pointer"
      >
        Cerrar
      </button>
    </div>
  )
}
