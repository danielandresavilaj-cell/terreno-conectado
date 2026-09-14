# CONSTITUCIÓN DEL PROYECTO
## Terreno Conectado, Decisiones en Tiempo Real

**Versión:** 1.0.0 · **Ratificada:** 2026-09-14 · **Firmantes:** Daniel Ávila, Raúl González (pendiente contraparte)

Esta constitución define los principios innegociables del proyecto. Todo spec, plan, task, PR y decisión de infraestructura debe cumplirlos. Una decisión que viole un principio requiere una enmienda explícita a esta constitución (PR numerado, justificación, firma de ambos integrantes) — nunca una excepción silenciosa.

---

## Artículo I — Offline-first es la promesa, no una característica

Toda funcionalidad de captura en terreno DEBE operar al 100% sin conexión de red. La nube es un complemento para consolidar y decidir, jamás una dependencia para trabajar.

**Criterio de aceptación:** cualquier flujo de campo (crear inspección, registrar hallazgo con foto, escribir bitácora) funciona en modo avión, y el dato sobrevive a cerrar y reabrir la aplicación. Si un PR rompe esto, se revierte.

## Artículo II — El spec precede al código

Ninguna tarea de implementación se ejecuta sin un requisito trazable (FR/NFR) en un spec. El ciclo por módulo es siempre `spec → plan → tasks → código → tests → evidencia`. Los specs congelados solo cambian por enmienda numerada.

**Criterio de aceptación:** cada task en `tasks/` referencia al menos un ID de requisito; cada commit referencia al menos un task; cada PR que cambia comportamiento referenciado en un spec incluye la actualización del spec en el mismo PR.

## Artículo III — Integridad de datos por sobre latencia y conveniencia

La sincronización DEBE ser idempotente: reintentos no duplican, fallos no pierden. Ante conflicto, resolución determinista y auditada — nunca sobrescritura silenciosa.

**Criterio de aceptación:** las pruebas de caos del `test-plan.md` (corte de red a mitad de sync, doble envío, edición concurrente) pasan con cero pérdida y cero duplicación. Es la promesa central del proyecto ante el docente y ante un cliente real.

## Artículo IV — Aislamiento multi-tenant por diseño

Cada tabla de dominio lleva `tenant_id`. La capa de aislamiento es Row-Level Security de PostgreSQL, no filtros en el código de aplicación (que son defensa adicional, no la defensa). Un tenant jamás ve datos de otro.

**Criterio de aceptación:** test de intrusión cross-tenant en CI: consultas autenticadas como tenant A intentando leer/escribir datos de tenant B son rechazadas a nivel de base de datos.

## Artículo V — Simplicidad como presupuesto

Somos dos personas en ~11 semanas efectivas con otras asignaturas en paralelo. Monolito + PWA + un solo lenguaje (TypeScript). Cada dependencia nueva se justifica por escrito en `research.md`. La complejidad que no podamos mantener no entra.

**Criterio de aceptación:** el stack real coincide con el ADR-001; desviaciones requieren ADR nuevo.

## Artículo VI — Presupuesto y aprendizaje antes que provisionamiento

La infraestructura de demo cuesta ≤ US$7/mes. Antes de que cualquier IA o script cree VPS, bases de datos, redes o dominios, el equipo DEBE entender y aprobar el diseño: cada decisión de infraestructura vive primero en un ADR (qué es, para qué sirve, cuánto cuesta, qué alternativa se descartó y por qué).

**Criterio de aceptación:** no existe recurso de infraestructura activo sin ADR aprobado que lo respalde. El equipo puede explicar sin notas: qué es el VPS, cómo entra el tráfico (DNS → TLS → reverse proxy → contenedor), dónde vive la base de datos y cuánto paga al mes.

## Artículo VII — Se prueba lo que se promete

El plan de pruebas cubre cada promesa del spec maestro: offline, sincronización, integridad, aislamiento, rendimiento en gama media. El testing adversarial usa un modelo de IA **distinto** al que implementó, atacando los invariantes del spec. Probar es evidencia académica (competencia de certificación) y práctica de ingeniería a la vez.

**Criterio de aceptación:** cada NFR del spec maestro tiene al menos una prueba automatizada o un protocolo manual documentado en `test-plan.md`.

## Artículo VIII — Documentación concurrente, evidencia mapeada

La documentación avanza con el trabajo, no después. Toda evidencia exigida por la asignatura (modelo de datos, plan de pruebas, boceto de flujo, prototipo, informe final) está mapeada a un archivo de este repo en la tabla del spec maestro §12. Cero trabajo duplicado entre SDD y APT.

**Criterio de aceptación:** la tabla de mapeo evidencia→artefacto está actualizada en cada cierre de fase.

## Artículo IX — Seguridad desde el piso

TLS en todo tráfico (Caddy automático), contraseñas hasheadas (bcrypt/argon2), JWT con expiración y claim de tenant, secretos fuera del repo (`.env` versionado solo como `.env.example`), OWASP Top 10 como checklist de revisión de PRs.

**Criterio de aceptación:** auditoría de secretos en CI; ningún secreto en historial git.

## Artículo X — El calendario manda, el alcance se ajusta

El Gantt de la asignatura (18 semanas, fases F1/F2/F3) no se modifica. Si el tiempo aprieta, se recorta alcance por decisión explícita registrada en el spec maestro §10 (límites) — nunca se recorta calidad de lo que sí se entrega (Artículos I, III, IV).

**Criterio de aceptación:** todo recorte de alcance queda como enmienda al spec maestro con justificación.

---

## Procedimiento de enmienda

1. PR titulado `AMENDMENT-NNN: <resumen>`.
2. Justificación: qué principio se cambia, por qué, qué costo tiene.
3. Requiere aprobación de ambos integrantes.
4. Bump de versión de la constitución (semver: MAJOR = principio eliminado/redefinido, MINOR = principio nuevo, PATCH = redacción).

| Versión | Fecha | Cambio |
| :--- | :--- | :--- |
| 1.0.0 | 2026-09-14 | Ratificación inicial |
