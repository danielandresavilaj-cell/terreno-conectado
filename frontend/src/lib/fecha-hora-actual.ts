/** Fecha y hora locales para una inspección de terreno.
 *
 * `toISOString()` usaría UTC y puede guardar el día equivocado cerca de la
 * medianoche chilena. Los inputs `date` y `time` esperan estas formas locales.
 */
export function fechaHoraLocal(ahora = new Date()): { fecha: string; hora: string } {
  const dos = (valor: number) => String(valor).padStart(2, '0')
  return {
    fecha: `${ahora.getFullYear()}-${dos(ahora.getMonth() + 1)}-${dos(ahora.getDate())}`,
    hora: `${dos(ahora.getHours())}:${dos(ahora.getMinutes())}`,
  }
}
