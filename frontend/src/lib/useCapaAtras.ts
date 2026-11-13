import { useEffect, useRef } from 'react'
import { registrarCapa } from './navegacion'

/**
 * TSK-OFF-008: mientras `abierta` sea true, el botón Atrás cierra esta capa
 * (panel, cámara, firma) en vez de cambiar de pantalla. Ver `lib/navegacion.ts`.
 */
export function useCapaAtras(abierta: boolean, cerrar: () => void): void {
  const ultimo = useRef(cerrar)
  ultimo.current = cerrar
  useEffect(() => {
    if (!abierta) return
    return registrarCapa(() => ultimo.current())
  }, [abierta])
}
