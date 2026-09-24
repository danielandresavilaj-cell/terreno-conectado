# TEST PLAN — Plan de pruebas de validación

**Versión:** 1.0.0 · **Fecha:** 2026-09-14 · **Autor:** Raúl González (validación) · **Relacionado:** spec maestro §5–6, constitución Artículos III/IV/VII
**Evidencia APT:** "Plan de pruebas de validación" (informe §6) y soporte de la competencia "Realizar pruebas de certificación de productos y procesos".

## 1. Principio rector

Cada promesa del spec maestro tiene una prueba que la verifica (NFR-12). Las pruebas validan **comportamiento observable** (¿se pierde el dato? ¿se duplica? ¿cruza tenants?), no implementación. Trazabilidad: cada caso referencia IDs FR/NFR.

## 2. Niveles de prueba y herramientas

| Nivel | Herramienta | Qué cubre | Cuándo corre |
| :--- | :--- | :--- | :--- |
| Unit | Vitest | Lógica de cola de sync, compresión de foto, upsert/conflictos, validaciones | Cada push (CI) |
| Integración API | Vitest + Testcontainers (Postgres real con RLS) | Endpoints, idempotencia, políticas RLS, auth | Cada push (CI) |
| E2E | Playwright (Chromium, perfil mobile) | Flujos completos con `context.setOffline(true/false)` | Nightly + pre-deploy (CI) |
| Caos offline | Playwright + scripts de corte aleatorio | Escenarios §4 | Semanal y antes de la demo |
| Adversarial cross-model | Modelo de IA ≠ implementador + suite guiada por spec | Ataque a invariantes §5 | Al cierre de cada módulo |
| Rendimiento | Lighthouse CI + k6 básico | NFR-07, NFR-03 | Pre-deploy |
| Manual documentado | Protocolo en vivo (demo) | Criterios de aceptación §13 del spec maestro | Fases 2 y 3 |

## 3. Matriz de cobertura requisito → prueba

| Requisito | Prueba | Nivel |
| :--- | :--- | :--- |
| FR-011/014, NFR-01 | Capturar en modo avión, cerrar/reabrir app, verificar persistencia IndexedDB | E2E |
| FR-012 | Foto de 8 MP → verificar dimensiones ≤1280px y tamaño comprimido antes de encolar | Unit + E2E |
| FR-016 | Desactivar red → encolar → reactivar: sync inicia sola sin clic | E2E |
| FR-020 | Batch con dependencias (inspección + respuestas + hallazgo + foto) sube en orden | Unit + Integración |
| FR-021, NFR-04 | Reenviar el mismo batch 3 veces → contar filas: cero duplicados | Integración |
| FR-022 | Fallar red a mitad de subida → backoff observado (1s,2s,4s…), sin intervención | E2E |
| FR-023 | Editar misma inspección en 2 contextos offline → LWW aplica + CONFLICT_RECORD con ambas versiones | Integración + E2E |
| FR-024 | Tras sync: SYNC_LOG completo y `synced_at - captured_at` registrado | Integración |
| FR-025, NFR-05 | JWT tenant A intenta batch con `tenant_id` B → 4xx + AUDIT_LOG de incidente | Integración |
| FR-002, NFR-05 | Usuario tenant A consulta todos los endpoints de lectura → jamás aparece dato B (fixture B sembrada) | Integración (RLS, Testcontainers) |
| FR-005 | 5 logins fallidos → bloqueo temporal 15 min | Integración |
| FR-031/032 | Ciclo draft→submitted; ítem `nok` exige hallazgo cuando la plantilla lo configura | Unit + E2E |
| FR-040/043, NFR-03 | Sync de dato → visible en dashboard; medir delta ≤ 60 s (primer lote) | E2E + cronometrado manual en demo |
| FR-052, NFR-09 | `/health` responde 200 con estado de DB; uptime monitor lo consume | Integración + manual |
| NFR-02 | Script: 200 registros + 100 fotos en offline simulado de 72 h (reloj adelantado) → sync completo sin pérdida | Caos |
| NFR-07 | Lighthouse CI mobile ≥ 80; interacción de formulario < 200 ms | Rendimiento |

## 4. Pruebas de caos offline-first (protocolo)

Escenarios ejecutados con Playwright (offline automático) y manualmente en la demo (modo avión real del teléfono):

1. **Corte a mitad de sync:** offline aleatorio durante la subida de un batch grande → al reconectar: cero pérdida, cero duplicado (idempotencia).
2. **Doble envío:** forzar reintento de un lote ya procesado (replay de red) → filas idénticas.
3. **Edición concurrente:** mismo registro en dos dispositivos offline → LWW + conflicto visible y auditado.
4. **Reinicio hostil:** matar la pestaña/app con outbox a medio escribir → al reabrir, datos íntegros (transacciones Dexie).
5. **Cola masiva:** escenario NFR-02 (72 h, 200 registros, 100 fotos).
6. **Token expirado en cola:** JWT expira mientras hay pendientes → refresh sin perder cola (FR-004).
7. **Cross-tenant hostil:** JWT A + payload B → rechazo + auditoría (FR-025).

**Criterio de éxito global:** los escenarios 1–7 con `0 pérdidas ∧ 0 duplicados ∧ 0 fugas cross-tenant`. Cualquier fallo bloquea la demo (Artículo III).

## 5. Testing adversarial cross-model (red-team)

- **Regla:** el modelo que implementó un módulo **no** es el que lo ataca (Q14/Artículo VII).
- **Insumo del atacante:** spec maestro + spec del módulo (no el código): debe romper las promesas, no buscar bugs de estilo.
- **Prompt base del red-team:** "Dado este spec, diseña y ejecuta la secuencia de acciones de usuario y de red que viole los invariantes: integridad (FR-021/023), aislamiento (FR-002/025), disponibilidad offline (FR-011/016). Prioriza estados frontera: cuotas llenas, timestamps iguales, UUIDs colisionados, lotes parciales, relojes desviados entre dispositivos."
- **Salida esperada:** informe por módulo con hallazgos (severidad, repro, requisito vulnerado) → issues en `tasks/` con fix + test de regresión.
- **Modelos sugeridos (opencode go):** implementa `kimi-k2.7-code` / `qwen3.8-flash` → ataca `qwen3.8-max` o `deepseek-v4-pro` (y viceversa).

## 6. Datos de prueba

- Semillas deterministas (`seed:demo`) — tenants A y B de data-model.md §5.
- Generación masiva con faker es-CL para caos y rendimiento.
- Fotos sintéticas de tamaños conocidos (1/5/12 MP) para FR-012.
- Nunca datos reales de empresas (informe APT §3.5: sin acceso a faenas reales).

## 7. Ambientes

| Ambiente | Propósito | Infra |
| :--- | :--- | :--- |
| local | dev + CI, Docker Compose idéntico al deploy | Máquina del integrante |
| CI | unit + integración (Testcontainers) + E2E nightly | GitHub Actions (minutos gratis) |
| demo | despliegue en VPS para validación en vivo | ADR-002 (≤ US$7/mes) |

## 8. Criterios de salida por fase (alineado al Gantt APT)

- **Fase 2 (sem. 13–16, "Pruebas de validación"):** matriz §3 ≥ 90% verde en CI; caos 1–7 pasando; informe de resultados por módulo.
- **Fase 3:** demo en vivo ejecuta §13 del spec maestro sin fallos; informe final cita resultados de este plan.

## Control de cambios

| Versión | Fecha | Cambio | Autor |
| :--- | :--- | :--- | :--- |
| 1.0.0 | 2026-09-14 | Plan inicial derivado del spec maestro v1.0.0 | Raúl González (con IA) |
