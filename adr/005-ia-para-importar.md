# ADR-005: Servicio de IA externo para importar plantillas

**Estado:** PROPUESTO. Lo aplica el PR de TSK-FORM-021 y queda pendiente que Raúl González ratifique la Enmienda 006.
**Fecha:** 2026-11-11 · **Decisores:** Daniel Ávila (con IA)

## Contexto

El import de plantillas usa reglas (Enmiendas 002 y 005): lee Excel, Word y PDF con texto. Hay tres casos que las reglas no resuelven:

1. un **PDF escaneado** no trae texto;
2. una **foto de una pauta en papel**, que es lo más común en faena;
3. pautas desordenadas, donde la heurística se equivoca de tipo o de sección.

El OCR estaba en V2. Para la demo y para el uso real, armar un formulario a partir de una foto vale más que cualquier otra mejora del import.

## Decisión

Agregar un **motor de IA opcional**, solo en el backend, que llama a la API de Claude (Anthropic) con salida estructurada. Por defecto usa el modelo `claude-haiku-5-5`, configurable con `IA_MODELO`.

- La IA **propone y nunca guarda**. Su salida pasa por el mismo `templateImportProposalSchema` que las reglas, y un `tenant_admin` la revisa y la confirma en el asistente (FR-029/048).
- **Está apagada por defecto.** Se activa solo si el servidor tiene `ANTHROPIC_API_KEY`; sin la clave, la app funciona igual que antes.
- **Solo se envía la pauta en blanco.** Nunca se envían inspecciones, respuestas, hallazgos ni fotos de terreno.
- **El costo tiene tres topes:**
  - el modelo pequeño: menos de USD 0,005 por pauta;
  - `IA_TOPE_DIARIO`: 20 análisis por empresa cada 24 h, contados desde `audit_log`;
  - el límite de gasto mensual de la cuenta de API.
- **Los tests no llaman a la API.** `AnalizadorIA` es un provider de Nest, y la CI inyecta un analizador falso.

## Alternativas evaluadas

| Opción | Costo | Por qué no |
| :--- | :--- | :--- |
| Tesseract (OCR) en la VM + reglas | 0 | Extrae texto, pero no entiende la pauta: con fotos torcidas o tablas sin bordes, el resultado es pobre |
| Modelo abierto local (Ollama) en la VM | 0 | La VM de Oracle no tiene GPU: tarda minutos por página, compite por RAM con PostgreSQL y la calidad es menor |
| Claude Opus 5.5 | ~30× Haiku | Es mejor en documentos muy complejos, pero el costo no se justifica en pautas de inspección. Se puede cambiar con `IA_MODELO` |
| Usar la suscripción a Claude de un integrante | — | No incluye uso de la API, y sus términos no permiten usarla desde un servidor |
| No hacerlo | 0 | Las pautas en papel y los escaneados quedan fuera |

## Consecuencias

- **Dependencia nueva:** `@anthropic-ai/sdk`, solo en el backend (research.md).
- **Requiere internet y una cuenta de API con crédito.** Si no hay crédito o la API está caída, el import queda `failed` con un mensaje en español y el usuario sigue con las reglas. La captura en terreno no depende de la IA (Art. I).
- **Datos que salen del sistema:** la pauta en blanco va a Anthropic. Hay que declararlo en el informe y a cada empresa cliente.
- **Cambiar de modelo** se hace con una variable de entorno, sin tocar código. Cambiar de proveedor exige solo otra implementación de `AnalizadorIA`.

## Enmienda 1 (2026-11-15): resumen de Gerencia (FR-068, TSK-REP-014)

**Estado:** PROPUESTA por Daniel Ávila (con IA), pendiente de ratificación de Raúl González.

La misma decisión se extiende a un segundo uso: redactar en lenguaje simple las cifras del panel de Gerencia.

- **Qué se envía:** sólo las cifras agregadas que el panel ya calcula (inspecciones por estado, hallazgos por severidad, urgentes, vencidos, conflictos pendientes, sincronizaciones y tendencia de 8 semanas), el nombre de la faena y el período. **No se envían** nombres de personas ni autores, textos de hallazgos o bitácora, ni fotos. La regla "sólo sale la pauta en blanco" pasa a ser "sólo salen pautas en blanco y cifras agregadas".
- **Propone y no guarda:** el resumen se muestra marcado "generado con IA" y no modifica ningún dato de negocio.
- **Costo:** mismo modelo (`IA_MODELO`, `claude-haiku-5-5` por omisión), esfuerzo bajo y salida corta: del orden de USD 0,001 por resumen. Tope propio por empresa, `IA_TOPE_RESUMEN_DIARIO` (20 cada 24 h por omisión), contado desde `audit_log` (`dashboard_resumen_ia`), separado del tope del import para que un uso no deje sin cupo al otro.
- **Se guarda y se reutiliza:** cada resumen queda en la tabla `resumen_ia` (migración 024, RLS) con la huella de las cifras que se enviaron. El mismo filtro muestra el último guardado sin llamar a la IA; sólo se redacta otro si las cifras cambiaron. Un período cerrado no envía lo que se mide "a hoy" (tendencia, plazos vencidos), así que su resumen sólo cambia si llegan datos sincronizados tarde. Se guarda texto redactado, no datos nuevos: lo que sale hacia la IA no cambia.
- **Tests:** como el import, el redactor es un provider de Nest (`REDACTOR_RESUMEN`) y la CI inyecta uno falso.
- **Declaración:** el informe y el aviso a cada empresa cliente deben mencionar que las cifras agregadas del panel se envían a Anthropic cuando alguien pide el resumen.
