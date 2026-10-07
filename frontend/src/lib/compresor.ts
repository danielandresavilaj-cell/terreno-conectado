/**
 * Compresión de fotos en el dispositivo — FR-012.
 *
 * La cámara de un teléfono de gama media produce fotos de 8–12 MP (3–6 MB).
 * Antes de encolar, la imagen se reescala a `maxLado` px en el lado mayor y se
 * recodifica como JPEG con `calidad`. Esto corta el peso ~20× y define el
 * ancho/alto que se documentan en `ATTACHMENT` (data-model §2.2) y en el outbox.
 *
 * Decisiones de implementación:
 * · Se usa `HTMLImageElement` + `URL.createObjectURL` (soporte universal);
 *   el objeto URL se revoca siempre, también en el camino de error.
 * · El canvas aplica `imageSmoothingQuality: 'high'` al reducir: la diferencia
 *   se nota en texto/barriers en la foto, no en dimensiones.
 * · El tamaño original se lee con `URL.createObjectURL` de `File` (confiable en
 *   Android); el escalado se hace con ratios enteros del lado mayor, sin forzar
 *   al cuadrado.
 *
 * Nota: `comprimirImagen` también devuelve un fallback: si `createObjectURL`
 * o `decode` no están disponibles (entorno raro), se devuelve el blob original
 * sin tocar, y la UI muestra la foto "sin comprimir". La capa de sync no
 * depende de esta función, solo del blob.
 */

export interface ImagenComprimida {
  blob: Blob
  ancho: number
  alto: number
  kb: number
}

/** FR-012: configuración por defecto (configurable por feature flag). */
export const FOTO_MAX_LADO = 1280
export const FOTO_CALIDAD = 0.7

const JPEG_MIME = 'image/jpeg'

/**
 * Reescala y recodifica `file` a JPEG ≤`maxLado` px (lado mayor) con `calidad`.
 * Devuelve ancho/alto finales (tras rotación EXIF aplicada por el navegador).
 */
export async function comprimirImagen(
  file: File,
  opts: { maxLado?: number; calidad?: number } = {},
): Promise<ImagenComprimida> {
  const maxLado = opts.maxLado ?? FOTO_MAX_LADO
  const calidad = opts.calidad ?? FOTO_CALIDAD

  const img = new Image()
  const url = URL.createObjectURL(file)
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('No se pudo decodificar la imagen'))
      img.src = url
    })

    const { naturalWidth, naturalHeight } = img
    if (!naturalWidth || !naturalHeight) {
      throw new Error('Imagen sin dimensiones')
    }

    const escala = Math.min(1, maxLado / Math.max(naturalWidth, naturalHeight))
    const ancho = Math.max(1, Math.round(naturalWidth * escala))
    const alto = Math.max(1, Math.round(naturalHeight * escala))

    const canvas = document.createElement('canvas')
    canvas.width = ancho
    canvas.height = alto
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D no disponible')

    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, 0, 0, ancho, alto)

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, JPEG_MIME, calidad),
    )
    if (!blob) throw new Error('Falló la codificación JPEG')

    return { blob, ancho, alto, kb: Math.round(blob.size / 1024) }
  } finally {
    URL.revokeObjectURL(url)
  }
}