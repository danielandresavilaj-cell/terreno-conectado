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
- [x] Flujo de refresh token y almacenamiento seguro en PWA — **decidido 2026-10-06, ver "Decisión D5" abajo**
- [ ] Esquema de hash y política de contraseñas
- [ ] Endpoints (contratos): `POST /auth/login`, `POST /auth/refresh`, `GET /me`
- [ ] Criterios de aceptación y casos de prueba (→ test-plan.md §3)
- [ ] Plan técnico → `plans/001-auth-tenancy/plan.md`; tareas → `tasks/001-*/tasks.md`

## Decisión D5 — Refresh token en la PWA (2026-10-06)

**Decisión:** cookie **httpOnly** (`Secure`, `SameSite=Strict`, `Path=/api/v1/auth`) con **rotación y detección de reuso**, access token (15 min) **solo en memoria**, y protección CSRF por **double-submit** (header `X-CSRF-Token` espejo de una cookie legible por JS).

**Por qué sobre las otras opciones (issue #11):**
- El despliegue es **same-origin**: Caddy sirve `/` (frontend) y `/api/*` (backend) en el mismo dominio (ADR-002 §A.1). Eso elimina el principal argumento en contra de la cookie httpOnly: no hay CORS con credenciales entre sitios.
- El refresh token jamás es legible desde JavaScript → mitiga el robo por XSS (NFR-06). En *storage cifrado* la clave termina en el cliente, así que el beneficio frente a httpOnly es marginal.
- *Solo service worker* no cubre las peticiones que la app hace sin pasar por el SW y complica el ciclo de vida; se descarta.

**Flujo que implementa TSK-WS-003:**
1. `POST /auth/login` → devuelve access token (15 min, en memoria) + cookie `rt` httpOnly + cookie CSRF legible.
2. `POST /auth/refresh` exige header `X-CSRF-Token`; rota `rt` en cada uso. Si se presenta un `rt` ya rotado → se revoca toda la familia de tokens (detección de robo) y se registra en `AUDIT_LOG`.
3. **FR-004 — la cola offline no depende del token:** el outbox vive en Dexie y sobrevive expiración/cierre. Al reconectar con el access expirado: silent refresh (cookie) → luego flush de la cola. Si el refresh también expiró → login local bloquea solo el envío, **nunca la captura** (Art. I).
4. Cubierto por el caos escenario 6 (token expirado con cola pendiente) de test-plan.md §4.

**Autoría y ratificación:** decidido por Daniel Ávila (2026-10-06) con análisis asistido por IA. Queda pendiente la ratificación de Raúl González en la revisión del PR que introduce este cambio; si disiente, se reabre el issue #11 y se documenta la alternativa.

## Control de cambios

| Versión | Fecha | Cambio | Autor |
| :--- | :--- | :--- | :--- |
| 0.1.0 | 2026-09-14 | Esqueleto inicial desde spec maestro v1.0.0 | Raúl González (con IA) |
| 0.1.1 | 2026-10-06 | Decisión D5 (refresh token): cookie httpOnly + rotación + CSRF double-submit, access en memoria (issue #11) | Daniel Ávila (con IA) |
