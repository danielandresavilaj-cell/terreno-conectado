/** Descarga un texto como archivo, sin arrastrar el módulo de exportación (ExcelJS). */
export function descargarTexto(texto: string, fileName: string, mime = 'text/csv;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([texto], { type: mime }))
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    a.click()
  } finally {
    URL.revokeObjectURL(url)
  }
}
