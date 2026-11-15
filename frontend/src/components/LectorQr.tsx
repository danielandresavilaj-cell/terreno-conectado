/* Lector de QR con la cámara — TSK-OPS-003-C, tramo 3 (FR-061).
 *
 * Pantalla completa, como `CamaraCaptura`: el permiso se pide sólo al pulsar
 * "Escanear QR", el stream existe mientras el lector está abierto y Atrás o
 * Escape lo cierran. Cada ~200 ms se toma un cuadro reducido del centro del
 * video y se decodifica en el teléfono (`lib/qr-lector.ts`, cargado al abrir);
 * no se sube ninguna imagen. Si la cámara no está disponible, la persona
 * vuelve a escribir el código a mano.
 */
import { useEffect, useRef, useState } from 'react'
import { useCapaAtras } from '../lib/useCapaAtras'
import { mensajeErrorCamara } from './CamaraCaptura'

const LADO_MAX = 640
const INTERVALO_MS = 200

export function LectorQr({ alLeer, alCerrar }: { alLeer: (texto: string) => void; alCerrar: () => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const cancelar = useRef<HTMLButtonElement>(null)
  const vivo = useRef(true)
  const [estado, setEstado] = useState<'iniciando' | 'buscando' | 'error'>('iniciando')
  const [mensaje, setMensaje] = useState('')

  const detener = () => {
    stream.current?.getTracks().forEach((t) => t.stop())
    stream.current = null
    if (video.current) video.current.srcObject = null
  }

  const cerrar = () => {
    vivo.current = false
    detener()
    alCerrar()
  }
  useCapaAtras(true, cerrar)

  useEffect(() => {
    vivo.current = true
    const previo = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    queueMicrotask(() => cancelar.current?.focus())
    let temporizador: ReturnType<typeof setTimeout> | undefined
    const lienzo = document.createElement('canvas')

    const arrancar = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setEstado('error')
        setMensaje('Este navegador no permite abrir la cámara desde la aplicación. Escribe el código a mano.')
        return
      }
      try {
        const [nuevo, { leerQr }] = await Promise.all([
          navigator.mediaDevices.getUserMedia({
            audio: false,
            video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          }),
          import('../lib/qr-lector'),
        ])
        if (!vivo.current) {
          nuevo.getTracks().forEach((t) => t.stop())
          return
        }
        stream.current = nuevo
        if (video.current) {
          video.current.srcObject = nuevo
          await video.current.play()
        }
        setEstado('buscando')
        const ctx = lienzo.getContext('2d', { willReadFrequently: true })
        const buscar = () => {
          if (!vivo.current) return
          const v = video.current
          if (ctx && v && v.videoWidth && v.videoHeight) {
            // Recorte cuadrado del centro (donde está el visor), reducido.
            const lado = Math.min(v.videoWidth, v.videoHeight)
            const destino = Math.min(lado, LADO_MAX)
            lienzo.width = destino
            lienzo.height = destino
            ctx.drawImage(v, (v.videoWidth - lado) / 2, (v.videoHeight - lado) / 2, lado, lado, 0, 0, destino, destino)
            const texto = leerQr(ctx.getImageData(0, 0, destino, destino).data, destino, destino)
            if (texto) {
              vivo.current = false
              detener()
              navigator.vibrate?.(60)
              alLeer(texto)
              return
            }
          }
          temporizador = setTimeout(buscar, INTERVALO_MS)
        }
        buscar()
      } catch (error) {
        detener()
        setEstado('error')
        setMensaje(`${mensajeErrorCamara(error).replace(' o selecciona un archivo', '').replace(' o seleccionar un archivo', '')} También puedes escribir el código a mano.`)
      }
    }
    void arrancar()

    return () => {
      vivo.current = false
      if (temporizador) clearTimeout(temporizador)
      detener()
      document.body.style.overflow = overflow
      if (previo?.isConnected) previo.focus()
    }
    // El lector se monta una vez por apertura; `alLeer` cambia con cada render.
  }, [])

  return (
    <div
      className="fixed inset-0 z-50 bg-black text-white"
      role="dialog"
      aria-modal="true"
      aria-label="Escanear QR"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          cerrar()
        }
      }}
    >
      <video ref={video} autoPlay playsInline muted className="absolute inset-0 h-full w-full object-cover" />

      {estado === 'buscando' && (
        <div className="absolute inset-0 grid place-items-center pointer-events-none" aria-hidden>
          <div className="h-[min(70vw,320px)] w-[min(70vw,320px)] rounded-2xl border-[3px] border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
        </div>
      )}
      {estado === 'iniciando' && (
        <p role="status" aria-live="polite" className="absolute inset-0 grid place-items-center text-[14px]">
          Abriendo cámara…
        </p>
      )}
      {estado === 'error' && (
        <div className="absolute inset-0 grid place-items-center p-8 text-center">
          <p role="alert" className="max-w-sm text-[14px] leading-relaxed">
            {mensaje}
          </p>
        </div>
      )}

      <div
        className="absolute inset-x-0 top-0 flex items-center justify-between gap-3 bg-gradient-to-b from-black/70 to-transparent px-4 pb-6"
        style={{ paddingTop: 'max(12px, env(safe-area-inset-top))' }}
      >
        <button ref={cancelar} type="button" onClick={cerrar} className="h-11 rounded-[10px] px-3 text-[15px] font-medium">
          Cancelar
        </button>
        <p className="text-[15px] font-semibold">Escanear QR</p>
        <span className="w-[76px]" aria-hidden />
      </div>

      {estado === 'buscando' && (
        <p
          role="status"
          aria-live="polite"
          className="absolute inset-x-0 bottom-0 px-6 pt-8 text-center text-[14px] bg-gradient-to-t from-black/70 to-transparent"
          style={{ paddingBottom: 'max(20px, env(safe-area-inset-bottom))' }}
        >
          Apunta al QR del equipo o lugar. Se abre solo al leerlo.
        </p>
      )}
    </div>
  )
}
