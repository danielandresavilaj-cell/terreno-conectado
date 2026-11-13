import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useCapaAtras } from '../lib/useCapaAtras'

type EstadoCamara = 'iniciando' | 'lista' | 'error'

export function mensajeErrorCamara(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      return 'No se autorizó el uso de la cámara. Puedes permitirlo en el navegador o seleccionar un archivo.'
    }
    if (error.name === 'NotFoundError' || error.name === 'OverconstrainedError') {
      return 'No encontramos una cámara disponible en este dispositivo.'
    }
  }
  return 'No se pudo iniciar la cámara. Prueba nuevamente o selecciona un archivo.'
}

/** Devuelve el índice al que debe volver Tab al llegar al borde del diálogo. */
export function focoEnDialogo(
  tecla: string,
  retrocede: boolean,
  indiceActivo: number,
  cantidad: number,
): number | null {
  if (tecla !== 'Tab' || cantidad === 0 || indiceActivo < 0) return null
  if (retrocede && indiceActivo === 0) return cantidad - 1
  if (!retrocede && indiceActivo === cantidad - 1) return 0
  return null
}

/** Cámara efímera: el stream sólo existe mientras el cuadro está abierto. */
export function CamaraCaptura({
  abierta,
  alCerrar,
  alCapturar,
}: {
  abierta: boolean
  alCerrar: () => void
  alCapturar: (foto: File) => void
}) {
  const video = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const archivo = useRef<HTMLInputElement>(null)
  const dialogo = useRef<HTMLElement>(null)
  const cancelar = useRef<HTMLButtonElement>(null)
  const activador = useRef<HTMLElement | null>(null)
  const abiertaActual = useRef(abierta)
  abiertaActual.current = abierta
  const [estado, setEstado] = useState<EstadoCamara>('iniciando')
  const [mensaje, setMensaje] = useState('')

  const detener = () => {
    stream.current?.getTracks().forEach((track) => track.stop())
    stream.current = null
    if (video.current) video.current.srcObject = null
  }

  const cerrar = () => {
    detener()
    alCerrar()
  }

  // TSK-OFF-008: el botón Atrás del teléfono cierra la cámara.
  useCapaAtras(abierta, cerrar)

  const iniciar = async () => {
    detener()
    setEstado('iniciando')
    setMensaje('')
    if (!navigator.mediaDevices?.getUserMedia) {
      setEstado('error')
      setMensaje('Este navegador no permite abrir la cámara desde la aplicación.')
      return
    }
    try {
      const nuevo = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      })
      if (!abiertaActual.current) {
        nuevo.getTracks().forEach((track) => track.stop())
        return
      }
      stream.current = nuevo
      if (video.current) {
        video.current.srcObject = nuevo
        await video.current.play()
      }
      setEstado('lista')
    } catch (error) {
      detener()
      setEstado('error')
      setMensaje(mensajeErrorCamara(error))
    }
  }

  useEffect(() => {
    if (!abierta) return
    activador.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    void iniciar()
    // Un diálogo debe recibir el foco; de lo contrario el lector de pantalla y
    // el teclado siguen interactuando con la captura que quedó detrás.
    queueMicrotask(() => cancelar.current?.focus())
    return () => {
      detener()
      if (activador.current?.isConnected) activador.current.focus()
      activador.current = null
    }
  }, [abierta])

  if (!abierta) return null

  const alTeclado = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      cerrar()
      return
    }
    const focos = dialogo.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [href], select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )
    if (!focos?.length) return
    const destino = focoEnDialogo(
      event.key,
      event.shiftKey,
      Array.from(focos).indexOf(document.activeElement as HTMLElement),
      focos.length,
    )
    if (destino !== null) {
      event.preventDefault()
      focos[destino].focus()
    }
  }

  const tomar = () => {
    const origen = video.current
    if (!origen || !origen.videoWidth || !origen.videoHeight) {
      setEstado('error')
      setMensaje('La cámara todavía no está lista. Espera un momento e intenta de nuevo.')
      return
    }
    const canvas = document.createElement('canvas')
    canvas.width = origen.videoWidth
    canvas.height = origen.videoHeight
    canvas.getContext('2d')?.drawImage(origen, 0, 0, canvas.width, canvas.height)
    canvas.toBlob((blob) => {
      if (!blob) {
        setEstado('error')
        setMensaje('No pudimos preparar la fotografía. Intenta otra vez.')
        return
      }
      detener()
      alCapturar(new File([blob], `evidencia-${Date.now()}.jpg`, { type: 'image/jpeg' }))
      alCerrar()
    }, 'image/jpeg', 0.92)
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4" role="dialog" aria-modal="true" aria-label="Tomar fotografía" onKeyDown={alTeclado}>
      <section ref={dialogo} className="w-full max-w-lg rounded-2xl border border-line bg-s1 p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-[15px] font-semibold">Tomar foto</p>
            <p className="text-[13px] text-ink-2">La foto queda guardada en este teléfono.</p>
          </div>
          <button ref={cancelar} type="button" onClick={cerrar} className="h-11 px-3 text-[14px] text-ink-2 hover:text-ink">Cancelar</button>
        </div>
        <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-black">
          <video ref={video} autoPlay playsInline muted className="h-full w-full object-cover" />
          {estado === 'iniciando' && <p role="status" aria-live="polite" className="absolute inset-0 grid place-items-center text-[13px] text-white">Abriendo cámara…</p>}
          {estado === 'error' && (
            <div className="absolute inset-0 grid place-items-center p-6 text-center">
              <p role="alert" className="text-[13px] leading-relaxed text-white">{mensaje}</p>
            </div>
          )}
        </div>
        <input ref={archivo} type="file" accept="image/*" aria-label="Seleccionar fotografía desde archivos" className="hidden" onChange={(event) => {
          const foto = event.target.files?.[0]
          event.target.value = ''
          if (!foto) return
          detener()
          alCapturar(foto)
          alCerrar()
        }} />
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={() => archivo.current?.click()} className="h-11 rounded-[10px] border border-campo px-4 text-[14px] font-medium hover:border-line-strong">Seleccionar archivo</button>
          {estado === 'error' && <button type="button" onClick={() => void iniciar()} className="h-11 rounded-[10px] border border-campo px-4 text-[14px] font-medium hover:border-beam">Reintentar cámara</button>}
          <button type="button" disabled={estado !== 'lista'} onClick={tomar} className="h-11 rounded-[10px] bg-beam px-4 text-[14px] font-semibold text-on-beam disabled:cursor-not-allowed disabled:opacity-45">Capturar foto</button>
        </div>
      </section>
    </div>
  )
}
