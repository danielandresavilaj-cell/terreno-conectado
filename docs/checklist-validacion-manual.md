# Checklist de validación manual — Terreno Conectado (V1)

Guía **paso a paso** para que una persona valide a mano que la V1 funciona en
**todos los perfiles** y en **todos los modos** (online, offline, reconexión,
aislamiento multi-tenant y PWA instalable).

Complementa, no reemplaza:
[`test-plan.md`](../test-plan.md) (cobertura automatizada y caos) y
[`docs/informe-pruebas-validacion.md`](informe-pruebas-validacion.md) (resultados
automáticos). Aquí todo se hace **a mano, sobre la app corriendo**.

- **Trazabilidad:** issue [#130](https://github.com/danielandresavilaj-cell/terreno-conectado/issues/130) · TSK-DOCS-002. Evidencia de apoyo del spec maestro §13 y §9.
- **Alcance:** V1 actual (Fase 2 consolidada). No incluye features nuevas ni la V2 (#45).

---

## Leyenda

| Símbolo | Significado |
| :-- | :-- |
| ⭐ | **Humo**: subconjunto mínimo, hazlo primero (≈10 min). |
| 🔶 | **Avanzado**: cuesta más reproducirlo a mano (cuota, revisión congelada, caos). Puedes saltarlo si ya confías en la suite automática. |
| ✔ | Casilla de resultado: hazla `[x]` si coincide con lo esperado, o anota el desvío. |

**Modos:** 🟢 Online · 📴 Offline (toggle "Sin señal") · 🔄 Reconexión/sync ·
🧩 Cross-tenant (aislamiento) · 📲 PWA.

---

## 0. Preparación

### 0.1 Levantar el entorno

Requisitos: Node ≥ 22.12, Docker Desktop corriendo.

```bash
# 1) Base local (Postgres 16)
docker compose -f infra/docker-compose.yml up -d

# 2) Migraciones y datos demo (los runners NO autocargan el .env de la raíz)
#    Migrar (desde la raíz del repo):
node --env-file=.env node_modules/node-pg-migrate/bin/node-pg-migrate.js -m backend/db/migrations up
#    Seed (desde backend/, usa el .env de la raíz):
cd backend && node --env-file=../.env -r ts-node/register db/seed.ts && cd ..

# 3) Levantar API y PWA
npm run dev:backend     # NestJS  -> http://localhost:3000
npm run dev:frontend    # Vite    -> http://localhost:5173
```

- **Comprobar que la API está viva:** `curl http://localhost:3000/health` →
  `{"status":"ok","db":"up"}`. (La ruta es `/health`, **no** `/api/v1/health`.)
- `npm run dev:backend` lee `backend/.env`; si falla con
  `Configuration key "DATABASE_URL" does not exist`, crea el enlace local
  `backend/.env -> ../.env` (está en `.gitignore`).
- **Abrir la app:** navegador en `http://localhost:5173`. Para los casos 📲
  (PWA) usa `npm run build` + `npm run preview` (ver §3).

### 0.2 Cuentas demo

Password: el valor de **`DEMO_PASSWORD`** de tu `.env` (toma la plantilla de
`.env.example`). La pantalla de Login tiene tarjetas que la autocompletan — no
hace falta escribirla.

| Tenant | Perfil (`rol`) | Usuario |
| :-- | :-- | :-- |
| A · Minera El Cobre SpA | `field_worker` | `trabajador@minera.cl` |
| A · Minera El Cobre SpA | `supervisor` | `supervisor@minera.cl` |
| A · Minera El Cobre SpA | `tenant_admin` | `admin@minera.cl` |
| B · Constructora Andes SpA | `field_worker` | `trabajador@andes.cl` |
| B · Constructora Andes SpA | `supervisor` | `supervisor@andes.cl` |
| — (plataforma) | `platform_admin` | `admin@terreno.local` |

### 0.3 Datos que deja el seed

- **Faena A:** "Faena El Roble" (minería) · **Faena B:** "Obra Costanera" (obra).
- **Plantilla A (publicada):** "Chequeo de seguridad minera" · v1 — trae los **8
  tipos de campo**: `ok_nok_na`, `numeric`, `date`, `time`, `select_single`,
  `select_multiple`, `text`, `photo`.
- **Plantilla B (publicada):** "Inspección de obra" · v1.
- Ambas quedan **asignadas a la faena del tenant** para `field_worker` y
  `supervisor`.
- **Importante:** las plantillas del seed **no provienen de un `.xlsx`**, así que
  **no tienen documento original**. Los casos de **export** (FR-019/044/045) sólo
  se pueden probar **después de importar** una plantilla con el wizard
  (casos AD-08…AD-17). Para eso usa el archivo de muestra
  `shared/fixtures/xlsx/spike-referencia.xlsx`.

### 0.4 Cómo activar cada modo

- **📴 Offline:** en la barra superior, el interruptor **"En línea" / "Sin señal"**
  (aria-label "Desactivar señal (demo)"). Simula pérdida de red.
- **🔄 Reconexión:** vuelve a ponerlo en **"En línea"**. En la pantalla **Cola**
  aparece además el botón **"Simular llegada de señal"** (sólo cuando estás
  offline). El sync también reacciona a los eventos reales del navegador
  (`navigator.onLine`), así que el **modo avión real** sirve igual.
- **🧩 Cross-tenant:** entra y sal con las cuentas de A y de B.
- **📲 PWA:** sólo con el build de producción (ver §3, X-07).

### 0.5 Cómo registrar resultados

1. Copia la tabla de **§5** (o duplica las que necesites).
2. Marca `✔ = OK` cuando el resultado esperado se cumpla; si no, `✔ = KO` y abre
   un defecto con la plantilla de §5.2.
3. Guarda una captura por caso KO (y por los casos ⭐). Súbelas a
   `docs-evidencia/` si vas a anexar evidencia al informe.

### 0.6 Fricción conocida (NO es bug)

- **Inspección → "Guardar borrador"** no hace nada visible a propósito: el
  borrador se **autoguarda** en cada cambio (FR-014).
- **Conflictos → "Marcar como revisado"** es **sólo de la sesión** (no persiste en
  servidor todavía).
- **`platform_admin` no tiene pantalla de administración** en el frontend: entra
  directo a Gerencia y sus funciones de admin se prueban **por API** (2.4-B).
- El navegador móvil (360 px) no muestra las 5 pestañas a la vez; hay scroll
  horizontal en la barra. Es esperado.

---

## 1. ⭐ Humo (~10 min, 1 dispositivo)

Objetivo: el camino vertical completo (§9 del spec) en una sola pasada.

**Usuario:** `trabajador@minera.cl` (tenant A).

| # | Caso | Modo | Pasos | Resultado esperado | ✔ |
| :-- | :-- | :-- | :-- | :-- | :-: |
| H-01 | Iniciar sesión | 🟢 | Click en la tarjeta "Pedro Trabajador" → **Entrar**. | Entra y cae en **Inspección** ("Chequeo de seguridad minera"). | [ ] |
| H-02 | Cortar la señal | 📴 | Interruptor de la barra → **"Sin señal"**. | El chip del periodo pasa a "Sin señal"; la app sigue usable. | [ ] |
| H-03 | Capturar con hallazgo | 📴 | Responde un `OK` (p. ej. "Barriers…"), un **`NOK`** en "Señalización…" → **Registrar hallazgo** (Severidad Alta + descripción) → **Guardar hallazgo**; completa obligatorios (Temperatura, Fecha, Turno). | El ítem NOK queda con hallazgo; el progreso avanza; chip "Guardado en dispositivo". | [ ] |
| H-04 | Adjuntar foto | 📴 | En "Evidencias" → **Tomar foto** (✓) captura. | Se muestra la miniatura; sube el contador de fotos. | [ ] |
| H-05 | Enviar | 📴 | **Enviar inspección**. | La inspección pasa a **En cola**; el contador **"Pendientes"** sube. | [ ] |
| H-06 | Bitácora | 📴 | Pestaña **Bitácora** → **Nueva entrada** → escribe algo, elige un tag y la faena → **Guardar entrada**. | La entrada aparece en la línea de tiempo. | [ ] |
| H-07 | Persistencia | 📴 | Recarga la pestaña (F5). | Sigue todo: borrador, pendientes y bitácora (FR-011/014). | [ ] |
| H-08 | Reconectar | 🔄 | Interruptor → **"En línea"**. | La cola se drena **sola** sin tocar nada; "Pendientes" → 0; " Todo sincronizado" (FR-016). | [ ] |
| H-09 | Supervisor ve el dato | 🟢 | **Salir** → entra "Sofía Supervisora". | En **Gerencia** suben las métricas y aparece el hallazgo; **Latencia media** dentro del objetivo (≤ 60 s, NFR-03). | [ ] |
| H-10 | Aislamiento | 🧩 | **Salir** → entra "Bárbara Trabajadora" (`trabajador@andes.cl`). | Ve **"Inspección de obra"** (tenant B), **nunca** la plantilla ni los datos de A. | [ ] |

Si los 10 pasan, la V1 está funcionalmente sana. El resto del documento es
cobertura por perfil y modo.

---

## 2. Por perfil

### 2.1 `field_worker` — trabajador de terreno (tenant A)

**Usuario:** `trabajador@minera.cl`. **Pestañas esperadas:** Inspección, Bitácora,
Cola (y **no** Gerencia, Conflictos, Plantillas ni Importar).

#### A) Sesión y navegación

| # | Caso | Modo | Pasos | Resultado esperado | ✔ |
| :-- | :-- | :-- | :-- | :-- | :-: |
| FW-01 | Login correcto | 🟢 | Cuenta demo "Pedro Trabajador" → **Entrar**. | Entra; pantalla inicial **Inspección**. | [ ] |
| FW-02 | Login incorrecto | 🟢 | Escribe un correo válido y contraseña errónea → **Entrar**. | Mensaje "Correo o contraseña incorrectos…" (401). No entra. | [ ] |
| FW-03 | Autocompletar demo | 🟢 | Click en la tarjeta demo. | Correo y contraseña se rellenan solos. | [ ] |
| FW-04 | Mostrar/ocultar clave | 🟢 | Botón del ojo en "Contraseña". | Alterna entre texto y puntos (`aria-label` Mostrar/Ocultar). | [ ] |
| FW-05 | Pestañas del rol | 🟢 | Observa la barra de pestañas. | Solo **Inspección, Bitácora, Cola**. No aparecen las de admin/gerencia. | [ ] |
| FW-06 | Logout | 🟢 | **Salir**. | Vuelve a Login; se limpia la sesión. | [ ] |

#### B) Inspección — tipos de campo y validación

| # | Caso | Modo | Pasos | Resultado esperado | ✔ |
| :-- | :-- | :-- | :-- | :-- | :-: |
| FW-07 | Render de los 8 tipos | 🟢 | Recorre la plantilla A. | Se ven: `ok_nok_na`, `numeric` (Temperatura °C), `date` (Fecha del chequeo), `time` (Hora de inicio), `select_single` (Turno), `select_multiple` (EPP), `text` (Observaciones), `photo` (Foto) — FR-036. | [ ] |
| FW-08 | Validación en dispositivo (numeric) | 🟢 | En "Temperatura en el punto de medida (°C)" escribe **99** (máx 45) e intenta avanzar/enviar. | Se **rechaza en el dispositivo**; no entra a la cola (FR-039). | [ ] |
| FW-09 | Valor en rango (numeric) | 🟢 | Corrige a **25**. | Se acepta y persiste (contraste de FW-08). | [ ] |
| FW-10 | Validación (date) | 🟢 | En "Fecha del chequeo" pon una fecha fuera de 2026. | Se rechaza (min `2026-01-01`, máx `2026-12-31`). | [ ] |
| FW-11 | text max_length | 🟢 | Pega > 500 caracteres en "Observaciones del supervisor". | Se limita/rechaza según `max_length: 500`. | [ ] |
| FW-12 | select_single / multiple | 🟢 | Elige Turno = Nocturno y marca EPP (Casco, Botas). | Se mantienen las selecciones; multiple admite varias. | [ ] |
| FW-13 | NOK exige hallazgo | 🟢 | Marca **NOK** en un ítem con `require_finding_on_nok` y trata de enviar sin hallazgo. | **Bloquea** el envío (o exige el hallazgo) — FR-032. | [ ] |
| FW-14 | Hallazgo completo | 🟢 | Registra hallazgo: Severidad **Crítica** + descripción → **Guardar hallazgo**. | Queda asociado al ítem; cuenta en "…con hallazgo". | [ ] |
| FW-15 | Enviar inspección | 🟢 | Completa obligatorios → **Enviar inspección**. | Estado pasa a **submitted**; aparece en Cola (FR-031). | [ ] |

#### C) Inspección — modos offline y sync

| # | Caso | Modo | Pasos | Resultado esperado | ✔ |
| :-- | :-- | :-- | :-- | :-- | :-: |
| FW-16 | Captura sin red | 📴 | Sin señal, responde ítems y observa el chip. | Chip **"Guardado en dispositivo"**; nada se marca como sincronizado (FR-011). | [ ] |
| FW-17 | Persistencia del borrador | 📴 | F5 con el borrador a medias. | El borrador conserva las respuestas (FR-014). | [ ] |
| FW-18 | Plantilla en caché | 📴 | Arranca con señal, luego apaga y reabre la pestaña. | La plantilla se renderiza igual (caché, FR-018). | [ ] |
| FW-19 | Envío offline → cola | 📴 | **Enviar inspección** sin señal. | Queda **En cola**, no se marca sincronizada. | [ ] |
| FW-20 | Drenado automático | 🔄 | Reactiva la señal. | La cola sube **sin** pulsar "sincronizar"; contador → 0 (FR-016). | [ ] |
| FW-21 | Reintento manual | 🟢 | En Cola, con un ítem fallido, usa el botón de reintento (`aria-label="Reintentar …"`). | Reintenta con backoff; el estado se actualiza. | [ ] |

#### D) Bitácora

| # | Caso | Modo | Pasos | Resultado esperado | ✔ |
| :-- | :-- | :-- | :-- | :-- | :-: |
| FW-22 | Nueva entrada | 🟢 | Pestaña Bitácora → **Nueva entrada** → texto + tag (p. ej. "Clima") + faena → **Guardar entrada**. | La entrada aparece en la línea de tiempo con hora y autor. | [ ] |
| FW-23 | Entrada offline | 📴 | Sin señal, crea otra entrada. | Se guarda "en el dispositivo"; sube al reconectar. | [ ] |
| FW-24 | Botón deshabilitado | 🟢 | Abre el formulario sin texto. | **Guardar entrada** deshabilitado hasta escribir. | [ ] |

#### E) Cola y almacenamiento

| # | Caso | Modo | Pasos | Resultado esperado | ✔ |
| :-- | :-- | :-- | :-- | :-- | :-: |
| FW-25 | Filtros de cola | 🟢 | Alterna **Todos / En cola / Fallidos**. | Lista y contadores cambian; "Sin registros en este filtro." cuando corresponde. | [ ] |
| FW-26 | "Simular llegada de señal" | 📴 | Sin señal, en Cola, pulsa **Simular llegada de señal** (sólo visible offline). | Activa online y drena la cola (FR-016). | [ ] |
| FW-27 | 🔶 Cuota (FR-017) | 🟢 / 📴 | Captura muchas fotos hasta llenar el navegador (o usa herramientas de dev) y observa. | Aparece el toast **"Almacenamiento local al N%"** con **"Sincronizar ahora"/"Después"**; el panel de cuota de Cola muestra el % y las fotos pendientes. | [ ] |
| FW-28 | 🔶 Revisión congelada (FR-028) | — | Requiere que el `tenant_admin` publique una nueva revisión mientras hay un borrador en curso. Diferible a la suite E2E. | El turno queda congelado en su revisión; ofrece **Descartar borrador**. | [ ] |

#### F) Export local en el dispositivo (FR-019)

> Sólo funciona con una plantilla **importada** (con original `.xlsx`). Con las
> plantillas del seed el botón queda deshabilitado.

| # | Caso | Modo | Pasos | Resultado esperado | ✔ |
| :-- | :-- | :-- | :-- | :-- | :-: |
| FW-29 | Export deshabilitado sin original | 🟢 | Con la plantilla del seed, mira el panel "Exportar .xlsx". | Botón **deshabilitado** (la revisión no proviene de import). | [ ] |
| FW-30 | Export habilitado con original | 📴 | Requiere AD-08…AD-17 (import). Con esa plantilla asignada, captura y pulsa **Exportar .xlsx** sin red. | Genera el `.xlsx` con las respuestas + hoja "Evidencias" **sin red** (FR-019). | [ ] |

---

### 2.2 `supervisor` — supervisor (tenant A)

**Usuario:** `supervisor@minera.cl`. **Pestañas esperadas:** Inspección, Bitácora,
Cola, Gerencia, Conflictos.

#### A) Gerencia / Dashboard (FR-040/041/042/043)

| # | Caso | Modo | Pasos | Resultado esperado | ✔ |
| :-- | :-- | :-- | :-- | :-- | :-: |
| SU-01 | Pantalla inicial | 🟢 | Inicia sesión. | Cae en **Gerencia** (no en Inspección). | [ ] |
| SU-02 | Métricas base | 🟢 | Observa las tarjetas. | "Latencia media", "Latencia p95", "Hallazgos urgentes", "Inspecciones" con datos del seed. | [ ] |
| SU-03 | Objetivo de latencia | 🟢 | Mira "Latencia p95". | Pie "objetivo NFR-03: 60 s" visible; el valor ≤ 60 s tras sincronizar. | [ ] |
| SU-04 | Períodos | 🟢 | Alterna **24 h / 7 días / 30 días**. | Los números/cards se recalculan por período. | [ ] |
| SU-05 | Filtro Faena | 🟢 | Filtro "Faena" → "Faena El Roble". | La lista "Hallazgos filtrados" se limita a esa faena. | [ ] |
| SU-06 | Filtro Severidad | 🟢 | Filtro "Severidad" → "Crítica". | Sólo hallazgos Crítica. | [ ] |
| SU-07 | Filtro Autor (FR-041) | 🟢 | Filtro "Autor" → elige un autor con actividad. | Sólo hallazgos de ese `executed_by`; el conteo "Hallazgos filtrados · N" baja. | [ ] |
| SU-08 | Combinación de filtros | 🟢 | Combina Faena + Severidad + Autor. | Resultado coherente (intersección); ninguno rompe la pantalla. | [ ] |
| SU-09 | Export CSV con datos (FR-042) | 🟢 | Con hallazgos visibles, pulsa **CSV**. | Descarga `.csv` con cabeceras y una fila por hallazgo. | [ ] |
| SU-10 | Export CSV sin datos | 🟢 | Filtra hasta 0 hallazgos (p. ej. Autor sin actividad). | Botón **CSV deshabilitado**. | [ ] |
| SU-11 | Auto-refresh (FR-043) | 🟢 | Captura desde otra cuenta y espera ~30 s. | La pantalla se refresca sola ("Auto-refresh cada 30 s"). | [ ] |
| SU-12 | Offline muestra última lectura | 📴 | Sin señal, abre Gerencia. | Muestra la última lectura + nota "Sin señal: se muestra la última lectura…". | [ ] |

#### B) Exportar inspecciones (FR-044/045/046)

> Requiere plantilla **importada** (AD-08…AD-17) y al menos una inspección enviada
> de esa plantilla.

| # | Caso | Modo | Pasos | Resultado esperado | ✔ |
| :-- | :-- | :-- | :-- | :-- | :-: |
| SU-13 | Tabla de inspecciones | 🟢 | Baja hasta "Inspecciones del período". | Tabla con `Faena · Plantilla · Ejecutado por · Estado · Resp. · Fecha` y botón **Descargar** por fila. | [ ] |
| SU-14 | Export individual (FR-044) | 🟢 | Pulsa **Descargar** en una fila. | Genera el `.xlsx` rellenado + hoja "Evidencias" (botón muestra "Generando…"). | [ ] |
| SU-15 | 🔶 Export ZIP del lote (FR-045/046) | 🟢 | Pulso **Exportar ZIP del período**. | Genera un `.zip` de todas las inspecciones del período; reporta el estado del lote. | [ ] |

#### C) Conflictos (FR-051)

| # | Caso | Modo | Pasos | Resultado esperado | ✔ |
| :-- | :-- | :-- | :-- | :-- | :-: |
| SU-16 | Ver conflictos | 🟢 | Pestaña **Conflictos** → **Refrescar**. | Lista de conflictos con "Versión ganadora" (Vigente) y "Versión descartada". | [ ] |
| SU-17 | Vacío | 🟢 | En un tenant sin conflictos. | "Sin conflictos registrados en este tenant…". | [ ] |
| SU-18 | Marcar revisado | 🟢 | Pulsa **Marcar como revisado**. | Badge "Revisado" en la tarjeta (sólo sesión — recordar §0.6). | [ ] |

#### D) Repite flujos operativos

| # | Caso | Modo | Pasos | Resultado esperado | ✔ |
| :-- | :-- | :-- | :-- | :-- | :-: |
| SU-19 | Captura como supervisor | 🟢 | Pestañas Inspección/Bitácora. | También puede capturar y bitacorear (mismos flujos que 2.1). | [ ] |
| SU-20 | Cola como supervisor | 🟢 | Pestaña Cola. | Ve pendientes y puede reintentar. | [ ] |

---

### 2.3 `tenant_admin` — administrador de empresa (tenant A)

**Usuario:** `admin@minera.cl`. **Pestañas esperadas:** Gerencia, Conflictos, Cola,
Plantillas, Importar (y **no** Inspección ni Bitácora).

#### A) Plantillas — asignación por faena/rol (FR-008/009)

| # | Caso | Modo | Pasos | Resultado esperado | ✔ |
| :-- | :-- | :-- | :-- | :-- | :-: |
| AD-01 | Pantalla inicial | 🟢 | Inicia sesión. | Cae en **Gerencia**. | [ ] |
| AD-02 | Pestañas del rol | 🟢 | Revisa la barra. | Gerencia, Conflictos, Cola, Plantillas, Importar. | [ ] |
| AD-03 | Listado de plantillas | 🟢 | Pestaña **Plantillas**. | Aparece "Chequeo de seguridad minera" v1 (publicada). | [ ] |
| AD-04 | Buscar | 🟢 | Escribe en **Buscar plantilla…**. | Filtra por nombre en vivo. | [ ] |
| AD-05 | Filtro por rol | 🟢 | Alterna **Todas / Trabajador / Supervisor**. | Cambia el conjunto listado. | [ ] |
| AD-06 | Asignar a faena | 🟢 | En fila "Trabajador", pulsa **+ Faena El Roble**. | Pasa a **✓ Faena El Roble**; sube el contador de asignaciones. | [ ] |
| AD-07 | Desasignar | 🟢 | Vuelve a pulsar **✓ Faena El Roble**. | Vuelve a **+ Faena El Roble**. | [ ] |

#### B) Importar — wizard de 5 pasos (módulo 007)

Archivo de muestra: **`shared/fixtures/xlsx/spike-referencia.xlsx`**.

| # | Caso | Modo | Pasos | Resultado esperado | ✔ |
| :-- | :-- | :-- | :-- | :-- | :-: |
| AD-08 | Paso 1 · Subir | 🟢 | **Importar** → elige el `.xlsx` de muestra. | "Analizando el archivo…" y avanza a **Preview** (parseo local, ADR-003). | [ ] |
| AD-09 | Paso 2 · Preview | 🟢 | Observa el resumen y la tabla. | Chips "{n} secciones / ítems / filas"; columnas `Ítem · Tipo · Requerido · Props · Muestra · Origen` (solo lectura). | [ ] |
| AD-10 | Paso 3 · Editar | 🟢 | **Editar propuesta**; cambia "Nombre de la plantilla"; ajusta un "Tipo de campo" y un "Requerido". | Los cambios se reflejan; los selectores de props cambian según el tipo. | [ ] |
| AD-11 | Validación de nombre | 🟢 | Borra el nombre y mira **Continuar**. | **Continuar deshabilitado** hasta poner nombre. | [ ] |
| AD-12 | Quitar ítem | 🟢 | Pulsa el botón de quitar de un ítem. | Desaparece de la lista; puedes seguir. | [ ] |
| AD-13 | Paso 4 · Borrador | 🟢 | **Guardar borrador**. | "Borrador guardado" con Revisión/Template/Estado. | [ ] |
| AD-14 | Paso 5 · Confirmar requerido | 🟢 | **Continuar a publicar** y mira **Publicar versión** sin marcar la casilla. | **Publicar deshabilitado** hasta marcar "Confirmo publicar…". | [ ] |
| AD-15 | Publicar | 🟢 | Marca la casilla → **Publicar versión**. | Pantalla de éxito: "Publicada", "Versión N · estado published…". | [ ] |
| AD-16 | Volver a Gerencia | 🟢 | **Volver a Gerencia**. | Vuelve al dashboard sin errores. | [ ] |

#### C) Efecto cross-perfil y export

| # | Caso | Modo | Pasos | Resultado esperado | ✔ |
| :-- | :-- | :-- | :-- | :-- | :-: |
| AD-17 | La plantilla llega al terreno | 🧩 | Asigna la plantilla nueva a "Faena El Roble" (rol Trabajador), luego entra como `trabajador@minera.cl` y sincroniza. | El trabajador la ve en Inspección y puede capturar (FR-008/009). | [ ] |
| AD-18 | Export habilitado (FR-019) | 📴 | Con esa plantilla importada y un borrador, entra como trabajador y pulsa **Exportar .xlsx** sin red. | Genera el `.xlsx` rellenado en el dispositivo (ya **no** está deshabilitado). | [ ] |
| AD-19 | Cola y conflictos | 🟢 | Pestañas Cola y Conflictos. | Accesibles con datos coherentes del tenant A. | [ ] |

---

### 2.4 `platform_admin` — administración de plataforma (spec 006)

**Usuario:** `admin@terreno.local`. **Pestañas esperadas:** sólo **Gerencia**.

#### A) UI (lo que hay hoy)

| # | Caso | Modo | Pasos | Resultado esperado | ✔ |
| :-- | :-- | :-- | :-- | :-- | :-: |
| PA-01 | Login de plataforma | 🟢 | Cuenta demo "Operación Plataforma" → **Entrar**. | Entra; cae en **Gerencia** titulada "Operación Plataforma". | [ ] |
| PA-02 | Sin panel por tenant | 🟢 | Observa el cuerpo de Gerencia. | Panel **"Panel por tenant no disponible"**: explica que la sesión de plataforma no pertenece a ningún tenant. | [ ] |
| PA-03 | Sin datos de tenant | 🟢 | Revisa métricas/listas. | **No** muestra datos de A ni de B. | [ ] |
| PA-04 | Sin pestañas de admin | 🟢 | Revisa la barra. | Sólo **Gerencia** (no hay consola de admin en UI). | [ ] |

#### B) API de administración (curl) — sin UI

> Requiere que la API esté en `http://localhost:3000`. Define, en tu terminal,
> `BASE=http://localhost:3000/api/v1`. La contraseña demo sale de tu `.env`
> (**no** la escribas en claro en el repo). En Windows usa `curl` de Git Bash o
> PowerShell con `Invoke-RestMethod`.

| # | Caso | Modo | Pasos | Resultado esperado | ✔ |
| :-- | :-- | :-- | :-- | :-- | :-: |
| PA-05 | Token de plataforma | 🟢 | `curl -s $BASE/auth/login -H 'Content-Type: application/json' -d '{"email":"admin@terreno.local","password":"<DEMO_PASSWORD>"}'` | Devuelve `{ access_token, user }`; `user.rol = platform_admin`. Guarda el token. | [ ] |
| PA-06 | Audit log | 🟢 | `curl -s "$BASE/admin/audit-log" -H "Authorization: Bearer $TOKEN"` | `200` con `{ items, limit, offset }` (puede venir vacío). | [ ] |
| PA-07 | Crear tenant | 🟢 | `curl -s $BASE/admin/tenants -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"name":"Demo QA","slug":"demo-qa"}'` | `201` con `{ id, name:"Demo QA", slug:"demo-qa", status:"active", … }`. | [ ] |
| PA-08 | Asignar admin | 🟢 | `curl -s $BASE/admin/tenants/<ID>/admins -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"email":"qa@demo-qa.cl","full_name":"QA","password":"una-clave-de-12+"}'` | `201` al crear (o `200` si ya existía). Devuelve el usuario `tenant_admin`. | [ ] |
| PA-09 | Suspender tenant | 🟢 | `curl -s -X PATCH $BASE/admin/tenants/<ID> -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"status":"suspended"}'` | `200` con `status:"suspended"`. | [ ] |
| PA-10 | Reactivar tenant | 🟢 | Repite con `{"status":"active"}`. | `200` con `status:"active"`. | [ ] |
| PA-11 | Validación (slug) | 🟢 | Crea un tenant con slug inválido (mayúsculas/espacios). | `400` con detalle legible ("slug inválido…"). | [ ] |
| PA-12 | 403 a rol no-plataforma | 🧩 | Con el token de `supervisor@minera.cl`, llama `GET $BASE/admin/audit-log`. | `403` "Sólo platform_admin puede administrar la plataforma". | [ ] |
| PA-13 | Rastro de auditoría | 🟢 | Tras PA-07/09, repite `GET $BASE/admin/audit-log?limit=20`. | Aparecen entradas con `action`/`entity`, `actor_id` del admin y `tenant_id` del nuevo tenant (FR-051). | [ ] |

---

### 2.5 Tenant B — aislamiento (Regional `🧩`)

**Objetivo:** comprobar que B nunca ve datos de A (Art. IV: RLS, no filtros de app).

| # | Caso | Modo | Pasos | Resultado esperado | ✔ |
| :-- | :-- | :-- | :-- | :-- | :-: |
| TB-01 | Captura con plantilla B | 🧩 | Login `trabajador@andes.cl`. | Ve **"Inspección de obra"** (no "Chequeo de seguridad minera"). | [ ] |
| TB-02 | Ítems de B | 🧩 | Recorre la plantilla. | Ítems de obra ("Profundidad medida (m)", "Turno", "EPP en uso", "Foto del estado de la excavación"…). | [ ] |
| TB-03 | Gerencia de B | 🧩 | Login `supervisor@andes.cl` → Gerencia. | Sólo datos de B ("Obra Costanera"). Ningún hallazgo/inspección de A. | [ ] |
| TB-04 | Sujeto de aislamiento por API | 🧩 | Con token de B: `curl -s $BASE/dashboard/summary -H "Authorization: Bearer $TB_TOKEN"`. | Devuelve sólo datos de B (sin filas de A). | [ ] |
| TB-05 | Plantillas de B | 🧩 | `curl -s $BASE/templates -H "Authorization: Bearer $TB_TOKEN"`. | Sólo "Inspección de obra"; no aparece la de A. | [ ] |
| TB-06 | Sin pestañas cruzadas | 🧩 | Revisa la barra con la cuenta de B. | No hay forma de ver Gerencia/Plantillas de A desde B. | [ ] |

---

## 3. Modos / flujos transversales

Casos que cruzan perfiles o atacan invariantes (la mayoría 🔶, difíciles a mano).
Referencia: `test-plan.md` §4 (caos 1–7).

| # | Caso | Modo | Pasos | Resultado esperado | ✔ |
| :-- | :-- | :-- | :-- | :-- | :-: |
| X-01 | 🔶 Idempotencia (caos 2) | 🔄 | Con un lote en cola, fuerza reintentos (corta/restaura la señal varias veces). | El lote sube **sin duplicar** filas (FR-021, NFR-04). | [ ] |
| X-02 | 🔶 LWW / conflicto (caos 3) | 🔄 | Dos ventanas/dispositivos offline editan el **mismo** registro; reconecta ambas. | Gana el mayor `captured_at`; **las dos versiones** quedan en Conflictos (FR-023). | [ ] |
| X-03 | 🔶 Token expirado en cola (caos 6) | 🔄 | Deja cola pendiente, invalida/expira el token (espera > 15 min), reconecta. | La cola **no se pierde**; se drena al volver a iniciar sesión (FR-004). | [ ] |
| X-04 | 🔶 Cross-tenant hostil (caos 7) | 🧩 | Por API: usa el JWT de A con un payload que referencia ids de B en `POST $BASE/sync/batch`. | **Rechazo**, sin fuga, y **rastro en `audit_log`** (FR-025). | [ ] |
| X-05 | RLS transversal | 🧩 | Recorre endpoints de B (`/sites`, `/dashboard/findings`, `/conflicts`) con token de B. | Nunca aparece una fila de A, en ningún endpoint. | [ ] |
| X-06 | Health | 🟢 | `curl http://localhost:3000/health`. | `{"status":"ok","db":"up"}`. | [ ] |
| X-07 | 📲 PWA instalable | 📲 | `npm run build` y `npm run preview`; abre `http://localhost:4173` en Chrome. | Se ofrece "Instalar"; en DevTools, `manifest.webmanifest` (`application/manifest+json`) y `sw.js` (`text/javascript`) responden; `display: standalone`. | [ ] |
| X-08 | 🔶 Lighthouse Performance | 📲 | Sobre el preview, corre Lighthouse (móvil). | Performance ≥ 80 (NFR-07). | [ ] |
| X-09 | Modo avión real | 📴 | Activa el modo avión del equipo (sin tocar el toggle), captura, desactívalo. | Igual que el toggle: guarda offline y drena al reconectar (FR-016). | [ ] |
| X-10 | 🔶 Cola masiva (caos 5, NFR-02) | 🔄 | Encola ~200 registros (script/repetición) y reconecta. | Suben íntegros y sin duplicar (NFR-02). Idealmente vía suite E2E. | [ ] |

---

## 4. Matriz rápida rol × pantalla

Marca "OK" si el acceso coincide con lo esperado (`—` = no debe aparecer).

| Pantalla | `field_worker` | `supervisor` | `tenant_admin` | `platform_admin` |
| :-- | :--: | :--: | :--: | :--: |
| Inspección (captura) | OK | OK | — | — |
| Bitácora | OK | OK | — | — |
| Cola | OK | OK | OK | — |
| Gerencia (dashboard) | — | OK | OK | OK |
| Conflictos | — | OK | OK | — |
| Plantillas | — | — | OK | — |
| Importar | — | — | OK | — |

Resultado: [ ] OK · [ ] KO (anotar abajo)

---

## 5. Registro de resultados

### 5.1 Tabla de resultados

| Caso | Resultado | Evidencia | Notas |
| :-- | :--: | :-- | :-- |
| H-01 | [ ] OK / [ ] KO | | |
| H-02 | [ ] OK / [ ] KO | | |
| … | | | |
| (añade una fila por caso KO y por los no obvios) | | | |

**Resumen:** casos ejecutados: ___ · OK: ___ · KO: ___ · % OK: ___

### 5.2 Plantilla de defecto

```
### F-<nn> — <título corto>
- Caso: <ID del checklist>        - Perfil: <rol>      - Modo: <online/offline/…>
- Entorno: <SO> · <navegador> · backend <commit> · frontend <build>
- Pasos: 1) … 2) …
- Esperado: …
- Obtenido: …
- Evidencia: <captura/consola>
- Sospecha / FR relacionada: <FR-xxx>
```

### 5.3 Cómo cerrar la validación

- [ ] Todos los casos ⭐ (H-01…H-10) en OK.
- [ ] Todos los casos de §2 en OK (los 🔶 pueden quedar pendientes si ya están verdes en la suite automática).
- [ ] Aislamiento (2.5) y cross-tenant (X-04, X-05) en OK.
- [ ] Todo KO registrado con defecto `F-<nn>` y enlazado a un issue.
- [ ] Resultado volcado a `docs/informe-pruebas-validacion.md` (o al informe final Fase 3).

---

_Última actualización: V1 (main `c7f616b`). Si cambia el comportamiento de un
flujo, actualiza este checklist en el mismo PR (Art. VIII)._
