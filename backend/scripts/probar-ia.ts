/**
 * Prueba manual del import con IA contra la API REAL — TSK-FORM-021.
 *
 * Gasta crédito de la cuenta (menos de un centavo por archivo con Haiku), así
 * que NO corre en CI ni en `npm test`. Uso, con la clave en `.env` o en el
 * entorno del proceso:
 *
 *   npm run probar-ia --workspace @terreno/backend -- ruta/a/pauta.pdf [otra.jpg …]
 *
 * Imprime la propuesta resumida, las advertencias, el modelo y los tokens.
 */
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { detectarFormato } from '@terreno/shared/importar'
import { AnalizadorClaude } from '../src/templates/importar-ia'

async function main(): Promise<void> {
  const archivos = process.argv.slice(2)
  if (archivos.length === 0) throw new Error('Indica al menos un archivo (PDF, Word o foto).')
  const ia = new AnalizadorClaude()
  if (!ia.disponible()) throw new Error('Falta ANTHROPIC_API_KEY en el entorno.')
  for (const ruta of archivos) {
    const bytes = new Uint8Array(readFileSync(ruta))
    const formato = detectarFormato(bytes)
    if (!formato) {
      console.log(`✗ ${ruta}: formato no reconocido`)
      continue
    }
    const t0 = Date.now()
    const r = await ia.analizar({ bytes, formato, nombre_archivo: basename(ruta) })
    const s = ((Date.now() - t0) / 1000).toFixed(1)
    console.log(`\n${r.resultado.ok ? '✓' : '✗'} ${ruta} · ${r.modelo} · ${r.tokens_entrada}+${r.tokens_salida} tokens · ${s} s`)
    if (!r.resultado.ok) {
      console.log(`  ${r.resultado.error}`)
      continue
    }
    for (const sec of r.resultado.propuesta.secciones) {
      console.log(`  ## ${sec.titulo}`)
      for (const it of sec.items) console.log(`   - ${it.prompt} [${it.response_type}${it.props.options ? `: ${it.props.options.join(' / ')}` : ''}]`)
    }
    for (const a of r.resultado.propuesta.advertencias ?? []) console.log(`  ! ${a}`)
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
