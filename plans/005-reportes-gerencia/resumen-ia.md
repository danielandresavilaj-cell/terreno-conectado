# PLAN — Resumen de Gerencia con IA (TSK-REP-014)

**Versión:** 0.2.0 · **Fecha:** 2026-11-15 · **Autor:** Daniel Ávila (con IA)
**Requisito:** FR-068 (Enmienda 009) · **Spec:** `specs/005-reportes-gerencia/spec.md` §7 · **ADR:** `adr/005-ia-para-importar.md` (Enmienda 1)

## 1. Objetivo

Gerencia lee el panel en segundos: un botón pide a la IA un resumen de tres partes —un titular, 2 a 4 puntos con cifras y la acción más urgente— para la faena y el período del filtro. La IA redacta cifras que el panel ya calcula; no decide nada. Cada resumen se guarda para reutilizarlo y queda como historial (por ejemplo, el resumen de la semana anterior se redacta una vez y lo ve todo el equipo).

## 2. Diseño

| Pieza | Dónde | Qué hace |
| :--- | :--- | :--- |
| `datosParaResumen` | `backend/src/dashboard/resumen-ia.datos.ts` | Toma el `DashboardSummary` y arma lo único que sale del sistema: período (días en hora de Chile), nombre de la faena (o "todas") y cifras. Descarta autores e ids. En un período cerrado omite lo que se mide "a hoy" (tendencia, vencidos). También `alcanceResumen` (clave del filtro) y `huellaCifras`. Funciones puras, con test sin base de datos. |
| `RedactorResumen` / `RedactorClaude` | `backend/src/dashboard/resumen-ia.ts` | Provider de Nest (`REDACTOR_RESUMEN`). Llama a Claude con salida estructurada (`titular`, `puntos`, `atencion`), esfuerzo bajo y el modelo de `IA_MODELO`. Nunca lanza: un fallo de la API vuelve como mensaje en español. Los tests inyectan uno falso. |
| `ResumenIAService` | `backend/src/dashboard/resumen-ia.service.ts` | Roles del dashboard; busca el último resumen guardado del filtro y compara la huella de las cifras (igual = se devuelve sin llamar; distinta = desactualizado); guarda cada resumen nuevo en `resumen_ia`; tope diario por empresa (`IA_TOPE_RESUMEN_DIARIO`, 20) contado en `audit_log`; historial. |
| Tabla `resumen_ia` | `backend/db/migrations/1730000024000_resumen_ia.js` | Resúmenes guardados con RLS: alcance, período, si estaba cerrado, huella, contenido, modelo, tokens y quién lo pidió. Actualizar agrega una fila. |
| Endpoints | `dashboard.controller.ts` | `GET /dashboard/resumen-ia?site_id&desde&hasta` → `{ disponible, restantes_hoy, tope_diario, guardado }` (no llama a la IA); `POST /dashboard/resumen-ia` con `{ site_id?, desde?, hasta? }` → el resumen (guardado o nuevo, con `desde_cache` y `desactualizado`); `GET /dashboard/resumen-ia/historial?site_id` → últimos 20. |
| Tipos | `shared/src/dashboard.ts` | `ResumenIA`, `EstadoResumenIA`, `ConsultaResumenIA` e `HistorialResumenIA`, compartidos con el frontend. |
| `ResumenIA` | `frontend/src/components/dashboard/ResumenIA.tsx` | Bajo los indicadores de Gerencia. Muestra al abrir el último resumen guardado del filtro; ofrece "Resumir con IA" si no hay y "Actualizar resumen" si quedó desactualizado; lista "Resúmenes anteriores". Sin red el botón queda deshabilitado. El texto lleva la marca "Generado con IA". |
| Período "Semana anterior" | `frontend/src/lib/periodos.ts` | Lunes 00:00 a domingo 23:59 de la semana pasada, en la hora local: el resumen semanal que se redacta una vez. |

## 3. Privacidad y costo

- Sale: período, nombre de la faena y cifras agregadas. No sale: personas, autores, textos de hallazgos o bitácora, fotos.
- Costo por resumen del orden de USD 0,001 con el modelo por omisión; el tope diario y los resúmenes guardados evitan gastos repetidos (NFR-08). Se genera a pedido, no con un proceso programado: no se redactan resúmenes que nadie lee.

## 4. Pruebas

- `backend/test/resumen-ia-datos.spec.ts` (sin Docker): qué entra y qué no entra en los datos, días en hora de Chile, períodos cerrados, clave del filtro y huella estables, salida del modelo validada y redactor sin clave apagado.
- `backend/test/resumen-ia.spec.ts` (Testcontainers, redactor falso): roles, `503` sin IA, resumen guardado y auditado, reutilización sin llamar ni contar, desactualizado y actualización, historial y su filtro por faena, período cerrado, `429` al alcanzar el tope, aislamiento por empresa (RLS) y error de la API como `502` sin guardar.
- `frontend/test/resumen-ia.test.ts` y `exportar-inspecciones.test.ts`: qué botón se ofrece y cuándo, pie y nombres de período, y la semana anterior.

## 5. Fuera de alcance

Resúmenes programados o enviados por correo (se descartó un proceso semanal automático porque redactaría resúmenes que nadie lee), preguntas libres sobre los datos y cualquier envío de texto de terreno a la IA (eso exige otra enmienda del ADR-005).
