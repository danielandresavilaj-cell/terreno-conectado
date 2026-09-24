# SPEC 001 — Autenticación y tenancy

| | |
| :--- | :--- |
| **Estado** | ESQUELETO (detallar en ciclo del módulo, semanas 5–8) |
| **Autor** | Raúl González |
| **Padre** | specs/000-master/spec.md |
| **Depende de** | — (primer módulo: todo lo demás lo consume) |
| **Bloquea a** | 002, 003, 004, 005, 006 |

## Alcance heredado del spec maestro

Requisitos que este spec detallará: **FR-001 → FR-006** y soporte a **NFR-05, NFR-06**.

- Login email/contraseña → JWT (access 15 min + refresh) con claims `user_id`, `tenant_id`, `rol`.
- Roles: `field_worker`, `supervisor`, `tenant_admin`, `platform_admin` (matriz de permisos por endpoint — **pendiente de detallar**).
- RLS como aislamiento primario; `SET LOCAL app.tenant_id` por transacción.
- Rate-limit de login (FR-005), refresh sin perder cola local (FR-004).
- Tenant demo sembrado (FR-006).

## Secciones a completar en el ciclo del módulo

- [ ] Matriz rol × recurso × acción (CRUD por endpoint)
- [ ] Flujo de refresh token y almacenamiento seguro en PWA
- [ ] Esquema de hash y política de contraseñas
- [ ] Endpoints (contratos): `POST /auth/login`, `POST /auth/refresh`, `GET /me`
- [ ] Criterios de aceptación y casos de prueba (→ test-plan.md §3)
- [ ] Plan técnico → `plans/001-auth-tenancy/plan.md`; tareas → `tasks/001-*/tasks.md`

## Control de cambios

| Versión | Fecha | Cambio | Autor |
| :--- | :--- | :--- | :--- |
| 0.1.0 | 2026-09-14 | Esqueleto inicial desde spec maestro v1.0.0 | Raúl González (con IA) |
