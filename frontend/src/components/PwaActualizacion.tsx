import { useState, useSyncExternalStore } from 'react'
import {
  aplicarActualizacionPwa,
  buscarActualizacionPwa,
  estadoActualizacionPwa,
  suscribirActualizacionPwa,
} from '../lib/actualizacion-pwa'
import { Boton } from './ui'

/** Control manual de versiones para quien usa Terreno Conectado como PWA. */
export function PwaActualizacion() {
  const estado = useSyncExternalStore(suscribirActualizacionPwa, estadoActualizacionPwa, estadoActualizacionPwa)
  const [confirmando, setConfirmando] = useState(false)
  const buscando = estado.fase === 'buscando' || estado.fase === 'aplicando' || estado.fase === 'preparando'

  return (
    <section className="space-y-3" aria-live="polite">
      <div>
        <h2 className="text-[16px] font-semibold">Actualización de la app</h2>
        <p className="mt-1 text-[14px] text-ink-2 leading-relaxed">{estado.mensaje}</p>
      </div>

      {estado.fase === 'disponible' ? (
        confirmando ? (
          <div className="rounded-lg bg-s2 px-3 py-3 space-y-3">
            <p className="text-[13px] text-ink-2 leading-relaxed">
              La app se recargará para aplicar la versión nueva. Tus borradores y envíos pendientes siguen guardados en este teléfono.
            </p>
            <div className="flex flex-wrap gap-2">
              <Boton variante="primaria" onClick={() => void aplicarActualizacionPwa()}>
                Actualizar ahora
              </Boton>
              <Boton variante="fantasma" onClick={() => setConfirmando(false)}>
                Más tarde
              </Boton>
            </div>
          </div>
        ) : (
          <Boton variante="primaria" onClick={() => setConfirmando(true)}>
            Instalar actualización
          </Boton>
        )
      ) : estado.fase !== 'sin_soporte' ? (
        <Boton variante="secundaria" disabled={buscando} aria-busy={buscando} onClick={() => void buscarActualizacionPwa()}>
          {estado.fase === 'buscando' ? 'Buscando…' : 'Buscar actualización'}
        </Boton>
      ) : null}
    </section>
  )
}
