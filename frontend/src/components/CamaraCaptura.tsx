import { useEffect, useRef, useState } from 'react'

type EstadoCamara = 'iniciando' | 'lista' | 'error'

export function mensajeErrorCamara(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      return 'No se autorizó el uso de la cámara. Podés permitirlo en el navegador o seleccionar un archivo.'
    }
    if (error.name === 'NotFoundError' || error.name === 'OverconstrainedError') {
      return 'No encontramos una cámara disponible en este dispositivo.'
    }
  }
  return 'No se pudo iniciar la cámara. Probá nuevamente o seleccioná un archivo.'
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
  const abiertaActual = useRef(abierta)
  abiertaActual.current = abierta
  const [estado, setEstado] = useState<EstadoCamara>('iniciando')
  const [mensaje, setMensaje] = useState('')

  const detener = () => {
    stream.current?.getTracks().forEach((track) => track.stop())
    stream.current = null
    if (video.current) video.current.srcObject = null
  }

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
    void iniciar()
    return detener
  }, [abierta])

  if (!abierta) return null

  const cerrar = () => {
    detener()
    alCerrar()
  }

  const tomar = () => {
    const origen = video.current
    if (!origen || !origen.videoWidth || !origen.videoHeight) {
      setEstado('error')
      setMensaje('La cámara todavía no está lista. Esperá un momento e intentá de nuevo.')
      return
    }
    const canvas = document.createElement('canvas')
    canvas.width = origen.videoWidth
    canvas.height = origen.videoHeight
    canvas.getContext('2d')?.drawImage(origen, 0, 0, canvas.width, canvas.height)
    canvas.toBlob((blob) => {
      if (!blob) {
        setEstado('error')
        setMensaje('No pudimos preparar la fotografía. Intentá otra vez.')
        return
      }
      detener()
      alCapturar(new File([blob], `evidencia-${Date.now()}.jpg`, { type: 'image/jpeg' }))
      alCerrar()
    }, 'image/jpeg', 0.92)
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4" role="dialog" aria-modal="true" aria-label="Tomar fotografía">
      <section className="w-full max-w-lg rounded-2xl border border-line bg-s1 p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-[15px] font-semibold">Tomar foto</p>
            <p className="text-[12px] text-ink-3">La imagen se guarda en este dispositivo y se comprime antes de enviarse.</p>
          </div>
          <button type="button" onClick={cerrar} className="h-10 px-3 text-[13px] text-ink-2 hover:text-ink-1">Cancelar</button>
        </div>
        <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-black">
          <video ref={video} autoPlay playsInline muted className="h-full w-full object-cover" />
          {estado === 'iniciando' && <p className="absolute inset-0 grid place-items-center text-[13px] text-white">Abriendo cámara…</p>}
          {estado === 'error' && (
            <div className="absolute inset-0 grid place-items-center p-6 text-center">
              <p className="text-[13px] leading-relaxed text-white">{mensaje}</p>
            </div>
          )}
        </div>
        <input ref={archivo} type="file" accept="image/*" className="hidden" onChange={(event) => {
          const foto = event.target.files?.[0]
          event.target.value = ''
          if (!foto) return
          detener()
          alCapturar(foto)
          alCerrar()
        }} />
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={() => archivo.current?.click()} className="h-11 rounded-[10px] border border-line-soft px-4 text-[13px] font-medium hover:border-line">Seleccionar archivo</button>
          {estado === 'error' && <button type="button" onClick={() => void iniciar()} className="h-11 rounded-[10px] border border-line-soft px-4 text-[13px] font-medium hover:border-beam">Reintentar cámara</button>}
          <button type="button" disabled={estado !== 'lista'} onClick={tomar} className="h-11 rounded-[10px] bg-beam px-4 text-[13px] font-semibold text-s0 disabled:cursor-not-allowed disabled:opacity-45">Capturar foto</button>
        </div>
      </section>
    </div>
  )
}
