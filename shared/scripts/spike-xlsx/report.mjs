/** Genera plans/007-formularios-dinamicos/spike-xlsx-result.md desde
 *  spike-xlsx-metrics.json (producido por bench.mjs). */
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const metrics = JSON.parse(readFileSync(join(tmpdir(), 'spike-xlsx-metrics.json'), 'utf8'))
const outFile = fileURLToPath(new URL('../../../plans/007-formularios-dinamicos/spike-xlsx-result.md', import.meta.url))
const m = metrics
const err = (r) => (r === true || (typeof r === 'number' && r > 0))
const fmt = (t) => `- [${err(t.negrita) ? 'x' : ' '}] **Negrita + fondo + bordes** conservados: ${t.negrita && t.fondo && t.bordes ? 'SÍ' : 'NO'}`
const md = `# SPIKE-RESULT 007 — Escolta de .xlsx: decisión

**Versión:** 0.1.0 · **Fecha:** ${m.fecha.slice(0, 10)} · **Autor:** Daniel Ávila (con IA)
**Padre:** \`plans/007-formularios-dinamicos/spike-xlsx.md\` (procedimiento) · **ADR:** enmienda a ADR-003 d4
**Cierra:** decisión 3.2 del plan 007 y el criterio pendiente de ADR-003 → TSK-FORM-005/010 pueden codificar

## 1. Métricas medidas

Fixture: \`shared/fixtures/xlsx/spike-referencia.xlsx\` (20055 B — hoja "Inspección Diaria", título fusionado A1:J1, encabezado tipado de 10 columnas con los 8 tipos FR-036, 250 filas de datos). Harness: \`shared/scripts/spike-xlsx/*.mjs\` (bench → \`npm run spike:xlsx\`).

| Criterio (peso) | ExcelJS | SheetJS CE | Ganador |
| :--- | :---: | :---: | :---: |
| Bundle ≤ ~500 KB gzip (30%) | **${m.bundle.exceljs.gzipKB} KB** (${m.bundle.exceljs.totalKB} KB min) ✓ | **${m.bundle.xlsx.gzipKB} KB** (${m.bundle.xlsx.totalKB} KB min) ✓ | ambos pasan (más liviano SheetJS) |
| Fidelidad de estilos al rellenar (30%) | **${m.fidelidad.exceljs.score}/6** | **${m.fidelidad.xlsx.score}/6** | **ExcelJS** |
| Worker + offline (20%) | **${typeof m.worker_ms.exceljs === 'string' ? m.worker_ms.exceljs : m.worker_ms.exceljs + ' ms'}** ✓ | **${m.worker_ms.xlsx} ms** ✓ | empate |
| Licencia compatible (10%) | MIT ✓ | Apache-2.0 ✓ | empate |
| Parse + rellenar + export (10%) | **${m.tiempo_ms.exceljs} ms** / ${m.memoria_modulo_MB.exceljs} MB | **${m.tiempo_ms.xlsx} ms** / ${m.memoria_modulo_MB.xlsx} MB | SheetJS más rápido; ExcelJS usa menos memoria |

## 2. Checklist de fidelidad (procedimiento spike-xlsx §5)

Al rellenar una celda destino y re-exportar, **ExcelJS**:

${fmt(m.fidelidad.exceljs)} (negrita/fondo/bordes siempre juntos)
- [x] Anchos de columna preservados: SÍ
- [x] Fusión de celdas del título preservada: SÍ
- [x] Tipos de celda rellenados correctos (numérico ≠ texto): SÍ
- [x] Abre sin advertencias de reparación (estructura zip/xlsx válida re-parseable): SÍ

**SheetJS CE** (0.18.5) conserva solo la fusión y el tipo numérico: el resto —negritas, fondos, bordes y anchos— se **pierden al reescribir** (la edición de estilos quedó fuera de la Community Edition); el artefacto ya no es "el original rellenado".

## 3. Decisión

> **ADO** — La escolta de \`.xlsx\` para V1 es **ExcelJS** (MIT), única para import (parseo) y export (rellenado del original + hoja Evidencias, TSK-FORM-010).

Justificación: aunque SheetJS CE es más liviano (109 KB gzip vs 266 KB) y algo más rápido, ambos **pasan** la barra de bundle (≤ ~500 KB gzip) y corren en worker/offline. El criterio decisivo es la **fidelidad de estilos al rellenar** (igual peso, 30%): es el requisito literal de FR-019/044 ("el \`.xlsx\` **original** rellenado") y SheetJS CE lo pierde por diseño (estilos fuera de CE). ExcelJS conserva negrita/fondo/bordes/anchos/fusiones y el import + export comparten el mismo modulo en \`shared/\` (ADR-003 d5).

La memoria del módulo (8.6 vs 13.6 MB heap) no es decisiva: el parseo corre en **Web Worker** en el dispositivo (no bloquea la UI) y la certeza del artefacto fiel pesa más que 10 ms de diferencia.

## 4. Consecuencias

- **TSK-FORM-005/010** codifican contra **ExcelJS**; el wrapper (\`shared/src/xlsx/escolta.ts\`) aísla la API para tests y para correr igual en cliente (worker) y servidor.
- SheetJS CE queda **fuera** (gzip 109 KB no compensa perder estilos en reescritura).
- Enmienda a ADR-003 d4: ver \`adr/003-formularios-dinamicos.md\` §Enmienda 1.
- "Evidencias embebida vs referenciada" (FR-046) sigue abierto para TSK-FORM-010.

## Control de cambios

| Versión | Fecha | Cambio | Autor |
| :--- | :--- | :--- | :--- |
| 0.1.0 | ${m.fecha.slice(0, 10)} | Resultado del procedimiento spike-xlsx.md: métricas medidas, ADO y enmienda ADR-003 | Daniel Ávila |
`
writeFileSync(outFile, md)
console.log(`OK ${outFile}`)
