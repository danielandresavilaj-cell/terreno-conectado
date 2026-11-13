# TASKS — Módulo 006: Administración de plataforma y cuentas

**Versión:** 0.1.1 · **Fecha:** 2026-11-13 · **Autor:** Daniel Ávila (con IA)
**Spec:** `specs/006-admin-plataforma/spec.md` (§5b Enmienda 003) · **Requisitos:** FR-050…055

> **Regla (Artículo II):** cada task referencia al menos un requisito; cada commit referencia al menos un task.

## Contexto

El ciclo original del módulo 006 dejó la API de plataforma (tenants, admin inicial, audit-log) sin pantalla, y no existía forma de crear trabajadores, supervisores ni faenas. Con la Enmienda 003 la v1 deja de ser una demo con cuentas compartidas: cada empresa gestiona sus cuentas con clave temporal y el primer administrador de plataforma se crea con un comando en el servidor.

## Tareas

| ID | Tarea | Requisito(s) | Depende de | Criterio de aceptación | Estado |
| :--- | :--- | :--- | :--- | :--- | :--- |
| TSK-ADM-001 | **Cuentas reales**: módulo `users` (cuentas y faenas del `tenant_admin`, RLS, auditoría), `GET /admin/tenants`, admin inicial con clave temporal, `bootstrap-admin` interactivo; pantallas **Equipo** y **Empresas** | FR-050, FR-051, FR-053, FR-054, FR-055 | TSK-AUTH-010 | `backend/test/users.spec.ts` verde (aislamiento cross-tenant incluido); `frontend/test/clave-temporal.test.ts` verde | ✅ Hecho |
| TSK-DEMO-001 | **Sin modo demo**: fuera cuentas y clave demo del login y del bundle, interruptor de señal simulado, limpieza de datos de prueba y plantilla demo; seed sólo para desarrollo/tests; compose de producción sin `seed`/`config` | Enmienda 003 | TSK-ADM-001 | `grep -r TcDemo frontend/dist` vacío; E2E adaptado a la red real; `infra/OPERACION.md` describe el alta del primer admin | ✅ Hecho |
| TSK-ADM-002 | **Alta masiva de cuentas** desde una planilla pegada o `.csv` | FR-053 | TSK-ADM-001 | Vista previa con filas válidas y rechazadas con motivo; crea con la API existente; descarga de claves temporales en `.csv`. `frontend/test/alta-masiva.test.ts` verde | ✅ Hecho |

## Control de cambios

| Versión | Fecha | Cambio | Autor |
| :--- | :--- | :--- | :--- |
| 0.1.1 | 2026-11-13 | Se agrega TSK-ADM-002 (alta masiva) | Daniel Ávila (con IA) |
| 0.1.0 | 2026-11-11 | Creación con TSK-ADM-001 y TSK-DEMO-001 (Enmienda 003) | Daniel Ávila (con IA) |
