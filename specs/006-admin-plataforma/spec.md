# SPEC 006 — Administración plataforma

| | |
| :--- | :--- |
| **Estado** | ESQUELETO (detallar en ciclo del módulo, semanas 9–12) |
| **Autor** | Raúl González |
| **Padre** | specs/000-master/spec.md |
| **Depende de** | 001 (roles, platform_admin) |
| **Bloquea a** | QA/monitoreo (health), auditoría de la demo |

## Alcance heredado del spec maestro

Requisitos que este spec detallará: **FR-050 → FR-052** y soporte a **NFR-09**.

- Gestión de tenants por `platform_admin`: crear, asignar `tenant_admin` inicial, habilitar/suspender (FR-050).
- Audit log append-only de operaciones críticas: creación de tenant, cambios de rol, conflictos de sync, intentos cross-tenant (FR-051).
- Endpoint `/health` (uptime, versión, estado DB) consumible por monitoreo (FR-052).
- Gestión de usuarios del tenant (tenant_admin): alta/baja, cambio de rol, reset de contraseña.

## Secciones a completar en el ciclo del módulo

- [x] **Contrato `/health` (definido en TSK-WS-012):** `GET /health`, público y sin sesión (excluido del prefijo `/api/v1`). Respuesta JSON `{status, uptime_s, version, db}`: `200 "ok"/"up"` con ping a PostgreSQL (`SELECT 1`); `503 "degraded"/"down"` si la DB no responde. Consumible por Uptime Kuma/betterstack (research.md §6). Logs estructurados JSON por evento (`ts/level/message/context`) con `request_id` y `tenant_id` en cada línea (NFR-09).
- [ ] Panel admin: alcance mínimo (¿UI o solo API + seed scripts para la demo?)
- [ ] Modelo del audit log y política de retención
- [ ] Procedimiento de alta de tenant (checklist operativo documentado)
- [ ] Criterios de aceptación y pruebas (test-plan.md §3: FR-052)
- [ ] Plan técnico → `plans/006-admin-plataforma/plan.md`

## Control de cambios

| Versión | Fecha | Cambio | Autor |
| :--- | :--- | :--- | :--- |
| 0.1.1 | 2026-10-08 | Contrato `/health` detallado e implementado en TSK-WS-012 (200/503, shape, logs JSON NFR-09) | Daniel Ávila |
| 0.1.0 | 2026-09-14 | Esqueleto inicial desde spec maestro v1.0.0 | Raúl González (con IA) |
