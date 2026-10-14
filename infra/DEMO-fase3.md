# Guion de la demo — Fase 3 (§9 del spec maestro)

Runbook para **ensayar y ejecutar** el guion del MVP (`specs/000-master/spec.md` §9) sobre el
entorno desplegado (ADR-002) y verificar los **criterios de aceptación** §13. Se usa **una vez
provisionado el VPS** (tras el HITO 2).

> **Criterio de éxito (§13):** el §9 corre completo **sin intervención manual sobre la red**
> (modo avión real del dispositivo), con `0 pérdidas ∧ 0 duplicados ∧ 0 fugas cross-tenant`
> (Artículo III), el dashboard refleja el dato **≤ 60 s** tras reconexión y cada evidencia §12
> existe y es navegable.

## 1. Precondiciones

- **URL desplegada** con DNS y TLS OK (pasos 1–7 del README → *Despliegue*): `https://<DOMAIN>`.
- **Semilla aplicada** (`… --profile tools run --rm seed`).
- **Dos dispositivos** (o un móvil + un navegador de escritorio) que puedan entrar en **modo avión**
  real. Un tercero (o una ventana) para el tenant B (paso 5).
- **Health OK**: `curl -s https://<DOMAIN>/health` → `{"status":"ok","db":"up"}`.
- **Cuentas demo** (password `DEMO_PASSWORD`, p. ej. `TcDemo2026!`):

  | Tenant | Rol | Usuario | Para qué |
  | :--- | :--- | :--- | :--- |
  | A — Minera El Cobre SpA | `field_worker` | `trabajador@minera.cl` | pasos 1–3, 6 |
  | A — Minera El Cobre SpA | `supervisor` | `supervisor@minera.cl` | paso 4, 6 |
  | B — Constructora Andes SpA | `supervisor` | `supervisor@andes.cl` | paso 5 (aislamiento) |

- Plantilla sembrada del tenant A: **"Chequeo de seguridad minera"** (revisión publicada, 8 tipos de campo).

## 2. Pre-flight (antes de la demo)

- [ ] `docker compose -f docker-compose.prod.yml ps` → `caddy`, `frontend`, `backend`, `db` **running**; `db` **healthy**.
- [ ] `curl -fsS https://<DOMAIN>/health` → `{"status":"ok","db":"up"}`.
- [ ] Login de las tres cuentas en los dispositivos que se van a usar (evita sorpresas de tecleo en vivo).
- **Reset en limpio** (opcional, recomendado antes del ensayo): destruye datos y vuelve a sembrar.
  ```bash
  cd /opt/terreno/infra
  docker compose -f docker-compose.prod.yml down -v           # ⚠️ borra pgdata
  docker compose -f docker-compose.prod.yml up -d
  docker compose -f docker-compose.prod.yml --profile tools run --rm migrate
  docker compose -f docker-compose.prod.yml --profile tools run --rm seed
  ```
- **Evidencias de respaldo** listas (capturas de un ensayo previo) por si falla la red del aula.

## 2.5 Orden de dispositivos

| Dispositivo | Sesión | Rol en la demo |
| :--- | :--- | :--- |
| **D1** (móvil, el que entra en modo avión) | `trabajador@minera.cl` | captura offline (pasos 2–3) |
| **D2** (pantalla grande/proyector) | `supervisor@minera.cl` | dashboard (paso 4) |
| **D3** (opcional) | `supervisor@andes.cl` | aislamiento (paso 5) |
| **D1** + **D4** (segundo dispositivo A) | `trabajador@minera.cl` | conflicto (paso 6) |

---

## 3. Guion (§9)

### Paso 1 — Login y app operativa offline

- **Acción (D1):** iniciar sesión como `trabajador@minera.cl`. Verificar que carga la plantilla
  *Chequeo de seguridad minera*.
- **Esperado:** la PWA queda operativa (FR-006); el catálogo de plantillas se cachea por tenant.
- **Evidencia:** captura del panel de cuenta + plantilla visible.
- **Plan B:** si no carga la plantilla, refrescar una vez **antes** de entrar en modo avión.

### Paso 2 — Captura en modo avión real (el corazón)

- **Acción (D1):** activar **modo avión** en el dispositivo (no basta con DevTools offline).
  - Crear una **inspección** desde plantilla.
  - Responder el checklist; marcar al menos un ítem **`nok`**.
  - Registrar un **hallazgo** con **foto comprimida** (FR-012).
  - Escribir una **entrada de bitácora**.
  - **Cerrar la app y reabrirla:** todo sigue ahí.
- **Esperado:** sin red, la captura y la compresión funcionan en cliente; los registros viven en
  IndexedDB y sobreviven al cierre/reapertura (Artículo I, criterio de aceptación de la Constitución).
- **Evidencia:** captura en modo avión mostrando los datos tras reabrir + el contador de pendientes > 0.
- **Plan B:** pantalla de respaldo con la captura ya hecha (documentar como evidencia §12).

### Paso 3 — Sincronización automática al reconectar

- **Acción (D1):** desactivar **modo avión** (recuperar señal real). **No tocar ninguna opción de red
  en la app.**
- **Esperado:** la cola drena **sola** (FR-021/022); el contador de pendientes baja a **0** y los
  registros pasan a `synced`. Idempotencia: reintentos no duplican.
- **Evidencia:** capturas *antes* (pendientes > 0) y *después* (0, `synced`).
- **Plan B:** si un registro queda `syncing`, esperar el backoff (≤ 30 s por el `AbortController`);
  la cola debe recuperarse sola (H2/H3 del test-plan).

### Paso 4 — El supervisor lo ve en ≤ 60 s

- **Acción (D2):** con la sesión de `supervisor@minera.cl` ya abierta, refrescar/observar el
  **dashboard**. Cronometrar desde el fin del paso 3.
- **Esperado:** aparece la **inspección** nueva y el **hallazgo `nok` destacado** (FR del módulo 005)
  en **≤ 60 s**.
- **Evidencia:** captura del dashboard con la inspección + medición del tiempo (cronómetro en pantalla).
- **Plan B:** refrescar el dashboard manualmente y anotar la latencia real.

### Paso 5 — Aislamiento multi-tenant (en vivo)

- **Acción (D3):** iniciar sesión como `supervisor@andes.cl` (tenant B) y abrir el dashboard / listados.
- **Esperado:** **cero** datos de Minera El Cobre (FR-002, NFR-05). El usuario B sólo ve su tenant.
- **Evidencia:** captura del dashboard vacío de B (o sólo con datos de B) mientras D2 muestra los de A.
- **Plan B:** prueba equivalente por API con el test-plan (`backend/test/rls.spec.ts`) ya en verde.

### Paso 6 — Conflicto entre dispositivos (LWW + auditoría)

- **Acción (D1 + D4, misma inspección del paso 2):**
  - Entrar en **modo avión** en ambos.
  - Cada uno edita **la misma inspección** con valores distintos.
  - Reconectar ambos.
- **Esperado:** LWW aplica (gana la marca de tiempo más reciente); el **conflicto queda visible y
  auditado** (FR-023, vista de conflictos + `audit_log`).
- **Evidencia:** captura de la vista de conflictos con la versión ganadora y la perdedora.
- **Plan B:** escenario de caos 3 del test-plan (ya en verde) como respaldo.

---

## 4. Mapeo a los criterios de aceptación (§13)

| # §13 | Cómo se demuestra |
| :--- | :--- |
| 1. §9 completo sin tocar la red | pasos 1–6 con **modo avión real** en D1/D4 |
| 2. Caos: 0 pérdidas / 0 duplicados | paso 3 (idempotencia) + test-plan §4 (1–7, en verde) |
| 3. Intrusión cross-tenant rechazada y auditada | paso 5 + caos 7 (`e2e-caos-integridad.spec.ts`) |
| 4. Dashboard ≤ 60 s tras reconexión | paso 4 (cronometrado) |
| 5. Evidencias §12 navegables desde el README | capturas de cada paso + enlaces del README |

## 5. Reset entre ensayos

El estado de las inspecciones **no** lo limpia el seed (hace `ON CONFLICT DO NOTHING`). Para un ensayo
en limpio, recrear la base:

```bash
cd /opt/terreno/infra
docker compose -f docker-compose.prod.yml down -v      # ⚠️ borra el volumen pgdata
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml --profile tools run --rm migrate
docker compose -f docker-compose.prod.yml --profile tools run --rm seed
```

> En el ensayo (no en la demo en vivo) se puede usar un **tenant recién creado** para no arrastrar datos.

## 5.1 Registro de ensayos

| Fecha | Ensayador | §9 1–6 | §13 1–5 | Incidencias |
| :--- | :--- | :--- | :--- | :--- |
| _(pendiente, tras HITO 2)_ | | | | |

## 6. Contingencias

- **Sin TLS / DNS**: usar `http://<IP>` con `DOMAIN=:80` temporalmente (Caddy sirve HTTP); avisar.
- **Red del aula caída**: las capturas offline funcionan igual (es lo que se demuestra); para los
  pasos 4–6 usar el **hotspot del móvil** del presentador.
- **Fallo en el paso 4/6**: mostrar el dashboard/conflicto con evidencia de respaldo y continuar; el
  criterio Artículo III ya está respaldado por la suite de caos en verde.
- **Reset de último minuto**: `down -v` + `migrate` + `seed` (≈ 1 min).
