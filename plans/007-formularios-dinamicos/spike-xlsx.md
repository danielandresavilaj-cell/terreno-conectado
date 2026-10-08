# SPIKE — Escolta de `.xlsx`: ExcelJS vs SheetJS CE

**Versión:** 0.1.0 · **Fecha:** 2026-10-08 · **Autor:** Raúl González (con IA)
**Padre:** `plans/007-formularios-dinamicos/plan.md` §3.2 · **ADR:** ADR-003 decisión d4 (elección diferida a spike)
**Dispara:** TSK-FORM-005 (importador) y TSK-FORM-010 (export rellenado) · **Cierra:** enmienda a ADR-003

> **Qué es:** procedimiento ejecutable para elegir la escolta de `.xlsx` (leer/parsear y escribir/rellenar el documento original) en V1. Si el resultado cambia la elección, se registra como **enmienda a ADR-003** antes de codificar TSK-FORM-005/010.

## 1. Candidatas (ADR-003 d4)

| | **ExcelJS** | **SheetJS CE** |
| :--- | :--- | :--- |
| Read/write `.xlsx` | Sí | Sí |
| Peso de bundle | Más pesado | Liviano |
| Fidelidad de estilos al rellenar | Alta (conserva workbook) | Parcial |
| Licencia | MIT | Apache-2.0 (CE, sin las features Pro) |
| Comunidad/estabilidad | Activa | Madura (mantenimiento lento en CE) |

Elección **no cerrada**: este spike la decide con evidencia.

## 2. Criterios del spike (heredados del ADR-003 d4)

1. **Bundle ≤ ~500 KB** (gzip, solo lo que entra al bundle de producción del cliente).
2. **Fidelidad de estilos al rellenar el original:** conservar bordes, negritas, ancho de columnas, celdas fusionadas y tipos de celda; el artefacto debe abrir sin advertencias en Excel.
3. **Ejecución en worker/offline:** parseo y generación corren sin red y dentro de un Web Worker (no bloquea el hilo principal en equipos de campo).
4. **Licencia compatible:** MIT / Apache-2.0 aceptadas; sin features comerciales bloqueadas detrás de licencia paga.

## 3. Libro de prueba de referencia

Un mismo `.xlsx` de referencia (estructura representativa de import y export) con:

- Hoja con **fila de encabezado** (negrita, fondo, bordes) y **columnas tipadas**: texto, numérico, fecha, hora, selección única, selección múltiple, ok/nok/na, foto (URL/adjunto) — espeja los 8 tipos de FR-036.
- **Celdas fusionadas** en la fila de título y **anchos de columna** personalizados.
- **≥ 200 filas de datos** (volumen terreno realista) y 1 celda destino a rellenar con un valor de respuesta.

Este libro se versiona bajo `shared/fixtures/xlsx/spike-referencia.xlsx` y sirve a la vez como fixture de TSK-FORM-005/011.

## 4. Harness de medición (procedimiento)

| Paso | Acción | Salida |
| :--- | :--- | :--- |
| 1 | Instalar ambas candidatas en `shared/` como dependencias de dev | `package.json` |
| 2 | Script de benchmark: parse del libro de referencia + rellenar la celda destino + export a buffer | tabla de métricas |
| 3 | Medir **bundle gzip** de cada una (solo el módulo importado, build de producción) | KB |
| 4 | Medir **tiempo de parse** (ms) y **pico de memoria** (MB) | ms / MB |
| 5 | Correr dentro de **Web Worker** en la PWA (sin red, modo avión simulado) | OK/fail |
| 6 | Abrir el `.xlsx` exportado en Excel y verificar la **fidelidad de estilos** (checklist 5) | OK/fail |
| 7 | Verificar **licencia** de la elegida y del árbol de dependencias | OK |

**Scripts:** `npm run spike:xlsx` (benchmark) · `npm run spike:xlsx:report` (genera `spike-xlsx-result.md` con la tabla de métricas).

## 5. Checklist de fidelidad (paso 6)

- [ ] Abre sin advertencias de reparación en Excel
- [ ] Encabezado conserva negrita + fondo + bordes
- [ ] Anchos de columna preservados
- [ ] Fusión de celdas del título preservada
- [ ] Tipos de celda rellenados correctos (numérico ≠ texto)
- [ ] Hoja "Evidencias" agregada sin romper el resto del libro

## 6. Formato de resultado → decisión

| Criterio (peso) | ExcelJS | SheetJS CE | Ganador |
| :--- | :---: | :---: | :---: |
| Bundle ≤ ~500 KB gzip (30%) | KB=… | KB=… | |
| Fidelidad de estilos (30%) | /6 | /6 | |
| Worker + offline (20%) | OK/fail | OK/fail | |
| Licencia compatible (10%) | MIT | Apache-2.0 | |
| Parse rápido + memoria (10%) | ms/MB | ms/MB | |

La elegida se fija en TSK-FORM-005 y **se reutiliza igual para el export** (TSK-FORM-010, FR-019/044); el generador vive en `shared/` para que cliente y servidor produzcan el mismo artefacto (ADR-003 d5). El resultado se registra como **enmienda a ADR-003** con la tabla de métricas adjunta.

## Control de cambios

| Versión | Fecha | Cambio | Autor |
| :--- | :--- | :--- | :--- |
| 0.1.0 | 2026-10-08 | Procedimiento del spike xlsx (ADR-003 d4): criterios, libro de referencia, harness y formato de decisión | Raúl González (con IA) |