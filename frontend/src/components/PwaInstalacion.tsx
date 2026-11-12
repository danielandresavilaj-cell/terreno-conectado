import { useEffect, useState } from 'react'
import { Boton } from './ui'

interface EventoInstalacion extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

declare global {
  interface WindowEventMap {
    beforeinstallprompt: EventoInstalacion
    appinstalled: Event
  }

  interface Navigator {
    standalone?: boolean
  }
}

export function instruccionesInstalacion(esIos: boolean) {
  return esIos
    ? 'En Safari, toca Compartir y luego “Añadir a pantalla de inicio”.'
    : 'Abre el menú del navegador y elige “Instalar aplicación”.'
}

function yaEstaInstalada() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true
}

/** Acción visible de instalación, con alternativa clara cuando no hay prompt nativo. */
export function PwaInstalacion() {
  const [evento, setEvento] = useState<EventoInstalacion | null>(null)
  const [mostrarAyuda, setMostrarAyuda] = useState(false)
  const [instalada, setInstalada] = useState(yaEstaInstalada)

  useEffect(() => {
    const alPedirInstalacion = (event: EventoInstalacion) => {
      event.preventDefault()
      setEvento(event)
    }
    const alInstalar = () => {
      setInstalada(true)
      setEvento(null)
      setMostrarAyuda(false)
    }
    window.addEventListener('beforeinstallprompt', alPedirInstalacion)
    window.addEventListener('appinstalled', alInstalar)
    return () => {
      window.removeEventListener('beforeinstallprompt', alPedirInstalacion)
      window.removeEventListener('appinstalled', alInstalar)
    }
  }, [])

  if (instalada) return null

  const instalar = async () => {
    if (!evento) {
      setMostrarAyuda((actual) => !actual)
      return
    }
    await evento.prompt()
    const eleccion = await evento.userChoice
    if (eleccion.outcome === 'accepted') setInstalada(true)
    setEvento(null)
  }

  const esIos = /iPad|iPhone|iPod/.test(navigator.userAgent)

  return (
    <div className="mt-5 rounded-xl border border-line-soft bg-s1 px-3.5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] leading-relaxed text-ink-2">
          Instálala para abrirla como aplicación y seguir trabajando sin señal.
        </p>
        <Boton type="button" tamano="sm" variante="secundaria" onClick={() => void instalar()}>
          Instalar app
        </Boton>
      </div>
      {mostrarAyuda && (
        <p role="status" className="mt-2 text-[12px] leading-relaxed text-ink-2">
          {instruccionesInstalacion(esIos)}
        </p>
      )}
    </div>
  )
}
