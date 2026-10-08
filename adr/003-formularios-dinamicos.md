# ADR-003 — Formularios dinámicos: formato interno, import/export de documentos y política de IA

**Estado:** PROPUESTO (2026-10-07) — aprobación de ambos integrantes pendiente en el PR (formalidad; la decisión técnica es completa)
**Fecha:** 2026-10-07 · **Decisores:** Daniel Ávila, Raúl González
**Relacionado:** spec maestro §5 (Enmienda 002 — FR-007–009, 018–019, 027–029, 036–039, 044–049) y §10; `data-model.md` (entidades TEMPLATE_*); specs 002/003/004; módulo 007 (issue #29)

## Contexto

El módulo 007 (formularios dinámicos desde documentos) permite a cada tenant subir un documento `.xlsx` estructurado y, con **revisión humana obligatoria**, generar una **plantilla versionada**; la captura en terreno es data-driven (8 tipos de campo, FR-036), se asigna por faena/rol (FR-008/009) y se puede exportar el **documento original rellenado + hoja Evidencias** tanto en el dispositivo (FR-019) como desde el dashboard (FR-044–046).

Restricciones que pesan en la decisión:

- **Artículo I** — todo el flujo de captura y export de terreno opera 100% sin red.
- **Artículo V** — equipo de 2 personas en calendario académico: cada dependencia nueva se justifica por escrito y la complejidad que no podamos mantener no entra.
- **Artículo IX** — la IA, si existe, es acotada, auditable y sin datos en tránsito innecesarios.
- **Artículo X** — el calendario manda: el import de `.xlsx` estructurado entra en V1 (Enmienda 002); OCR/docx/PDF/IA quedan en V2 opcional.

## Decisión

1. **Formato interno de plantilla: JSON propio, validado con Zod en runtime.** El schema TypeScript en `shared/` es la única fuente de verdad, compartido frontend/backend. Se descarta JSON Schema + ajv: estándar bien documentado pero agrega ceremonia y toolchain extra sin beneficio real para un equipo de 2 (Art. V). El JSON de plantilla es legible, versionable y la base para render (decisión 2) y conversión `.xlsx` (decisiones 3–5).
2. **Renderer propio minimal, data-driven por `response_type`.** El frontend renderiza los formularios a partir del JSON de la plantilla con los 8 tipos V1 (FR-036: texto, numérico, fecha, hora, selección única, selección múltiple, ok/nok/na, foto). Se descarta un motor de formularios de terceros (react-jsonschema-form): pesado, limita los tipos custom y agrega fricción al modo offline (Art. I, Art. V).
3. **`.xlsx` primero (V1), importación asistida con revisión humana.** Entrada: `.xlsx` estructurado con convención documentada en el spec 007 (fila de encabezado + columnas tipadas y obligatorias). El import recorre `TEMPLATE_IMPORT` (`uploaded → parsed → proposed → confirmed/failed`, FR-029) y el `tenant_admin` revisa y confirma antes de publicar (nunca publica automático). docx/PDF/OCR quedan en V2 (§10 de la Enmienda 002).
4. **Escolta de xlsx: decisión diferida a un spike del TSK de import.** Candidatas: **ExcelJS** y **SheetJS CE** (ambas con read/write de `.xlsx`; difieren en peso de bundle, velocidad de parseo y fidelidad de estilos al rellenar). Criterio del spike: bundle ≤ ~500 KB, fidelidad de estilos al rellenar el original, ejecución en worker/offline y licencia CE compatible. Si el spike cambia la elección, se registra como enmienda a este ADR.
5. **Export en dispositivo (Art. I).** La generación del `.xlsx` original rellenado + hoja "Evidencias" corre **en el cliente** (FR-019); el servidor produce el mismo artefacto para la descarga del supervisor y los lotes (FR-044–046). Se comparte el máximo código posible entre ambos generadores (módulo en `shared/`), con estilos mínimos (los estilos complejos de Excel original no se replican en V1 — se documenta como evolución).
6. **Política de IA (V2 opcional).** Feature flag `ai` **off por defecto**; si se activa, corre **solo en backend** y únicamente **propone mapeos de columnas** en la revisión humana del import; el `tenant_admin` conserva la decisión final (FR-048). Cero IA en el dispositivo y cero IA sobre datos de inspección; el demo es autosuficiente sin llamadas externas (Art. VI).
7. **Versionado y sync.** `TEMPLATE_REVISION` inmutable con ciclo `draft → published → archived` (FR-049). Sincronización por **delta** con `GET /api/v1/templates?since=<template_version>` (FR-027). Las inspecciones **congelan** su `template_version` al iniciarse (FR-028/038): un cambio de plantilla nunca re-encuadra una inspección en curso.

## Alternativas consideradas

| Alternativa | Veredicto | Motivo |
| :--- | :--- | :--- |
| JSON Schema + ajv | Descartada | Ceremonia y toolchain extra; Zod tipado con TS es suficiente (Art. V) |
| react-jsonschema-form / Formik | Descartadas | Motor de formularios de terceros: peso, curva y límites para los 8 tipos offline (Art. I, V) |
| XML / formato binario propio | Descartado | Sin ventaja frente a JSON; `.xlsx` ya es el formato de intercambio con el cliente |
| Import de PDF/docx/OCR en V1 | Diferido a V2 | OCR no garantiza calidad en el calendario académico (Art. X); Enmienda 002 lo deja explícito |
| Fidelidad total de estilos al rellenar `.xlsx` | Diferida | Estilos complejos fuera de V1; artefacto válido con estilos mínimos + hoja Evidencias |

## Consecuencias

**Positivas:** cero dependencias pesadas de formularios; schema compartido y tipado (TS + Zod); flujo de captura y export 100% offline; IA segmentada, reversible y sin datos de inspección; numeración FR intacta (Enmienda 002).
**Negativas/riesgos:** el renderer propio es más código a mantener (se acota a 8 tipos y a la validación Zod como contrato); la fidelidad de estilos del `.xlsx` rellenado es limitada en V1 (evolución documentada); la hoja Evidencias embebida vs referenciada según tamaño (FR-046) es una decisión de implementación menor que se resolverá en el TSK.
**Neutral:** la escolta de xlsx se decide por spike y cualquier cambio queda registrado como enmienda a este ADR.

---

**Firmas:** Raúl González (2026-10-07) · Daniel Ávila (pendiente — aprobación del PR).