/* Caché en memoria de fotos de evidencia — TSK-REP-008 (FR-062).
 *
 * El panel de supervisión se refresca cada 30 s y la misma foto aparece en el
 * listado de hallazgos y en el detalle de su inspección: sin caché, cada
 * refresco volvería a bajar las mismas imágenes. Se guarda el `Blob` (no una
 * URL de objeto): cada miniatura crea y libera su propia URL, así que no queda
 * memoria retenida cuando la pantalla se cierra.
 *
 * Sin React ni DOM: se prueba en `test/fotos.test.ts`.
 */

export interface CacheFotos {
  /** La foto `id`, bajándola sólo si no está (o si la descarga anterior falló). */
  pedir(id: string): Promise<Blob>
  tamano(): number
}

export function crearCacheFotos(bajar: (id: string) => Promise<Blob>, tope = 40): CacheFotos {
  const fotos = new Map<string, Promise<Blob>>()
  return {
    pedir(id) {
      const guardada = fotos.get(id)
      if (guardada) {
        // Reinsertar la deja como la más reciente: se descarta la que hace más no se usa.
        fotos.delete(id)
        fotos.set(id, guardada)
        return guardada
      }
      const descarga = bajar(id).catch((err: unknown) => {
        // Un fallo no se recuerda: el próximo intento vuelve a pedirla.
        if (fotos.get(id) === descarga) fotos.delete(id)
        throw err
      })
      fotos.set(id, descarga)
      if (fotos.size > tope) {
        const masAntigua = fotos.keys().next().value
        if (masAntigua !== undefined) fotos.delete(masAntigua)
      }
      return descarga
    },
    tamano: () => fotos.size,
  }
}
