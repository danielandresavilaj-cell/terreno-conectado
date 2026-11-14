import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import {
  avisarActualizacionDisponible,
  configurarActualizacionPwa,
  indicarActualizacionNoDisponible,
} from './lib/actualizacion-pwa'
import './index.css'

if ('serviceWorker' in navigator) {
  let activar: ReturnType<typeof registerSW> | null = null
  activar = registerSW({
    immediate: true,
    onNeedRefresh: avisarActualizacionDisponible,
    onRegisteredSW: (_url, registro) => {
      if (!registro || !activar) {
        indicarActualizacionNoDisponible()
        return
      }
      configurarActualizacionPwa({
        buscar: async () => {
          await registro.update()
        },
        aplicar: () => activar?.(true) ?? Promise.resolve(),
      })
    },
    onRegisterError: indicarActualizacionNoDisponible,
  })
} else {
  indicarActualizacionNoDisponible()
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
