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
