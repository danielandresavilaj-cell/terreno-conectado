# PLAN — Presentación con una empresa de demostración

**Versión:** 0.3.0 · **Fecha:** 2026-11-18 · **Autor:** Daniel Ávila (con IA)
**Objetivo:** presentar https://terrenoconectado.cl en ~2 días con una empresa ficticia que se vea en operación real, cuentas para cada rol y la alerta desde la bitácora.

## 1. Qué encontré al revisar

| Tema | Estado | Qué significa para la demo |
| :--- | :--- | :--- |
| Roles | `field_worker`, `supervisor`, `tenant_admin`, `platform_admin` | **No existe un rol "gerente"**: la pestaña Gerencia la ven supervisión y administración. Para la persona "gerente" se usa una cuenta `tenant_admin` (o `supervisor`). |
| Pantallas por rol | Trabajador: Formularios, Inspección, Bitácora, Hallazgos, Cola. Supervisión: + Gerencia, Conflictos. Administración: Gerencia, Equipo, Conflictos, Plantillas, Importar, Hallazgos, Cola. Plataforma: Empresas | Todo lo necesario para la historia de la demo ya existe. |
| Sin implementar | Programar inspecciones, QR de activos y avisos por correo (TSK-OPS-003-C/D/E) | **No prometerlo en la presentación.** |
| "Empresa Piloto" (prod) | Tiene un usuario de prueba con nombre poco presentable, 69 % de lotes con error y 2 equipos sin sincronizar | **No usarla para la demo.** Crear una empresa nueva y, antes de presentar, renombrar o desactivar ese usuario porque aparece en la vista de plataforma. |
| Hallazgo sin inspección | El contrato de sync ya acepta `inspection_id: null` | La alerta desde la bitácora es viable sin rehacer la sincronización. Falta saber su faena: Gerencia la saca de la inspección. |
| Fechas pasadas | El servidor acepta `captured_at` antiguos y no limita la velocidad de lotes | Se puede cargar historia de varias semanas: tendencias, "Semana anterior" y resúmenes con IA tienen sentido. |
| Espera sin señal | Se calcula entre `queued_at` y `sent_at` | El script debe simular esperas realistas (minutos a horas), no semanas. |
| Firma y cofirma | Cerrar exige firma del inspector; `reviewed` exige cofirma si la plantilla la pide | El script firma con trazos generados y cofirma como supervisión. |
| Fotos | Se suben como adjuntos en el lote | Para que se vea real conviene usar fotos de verdad (ver decisión 3). |

## 2. Mejora: reportar una alerta desde la bitácora (TSK-DOM-009, FR-069, Enmienda 010)

**Comportamiento:** en "Nueva entrada" de la bitácora, un interruptor "Reportar una alerta" muestra severidad (baja, media, alta, crítica), una descripción (obligatoria en alta y crítica, como hoy) y una foto opcional. Al guardar se encolan la entrada y el hallazgo vinculado; funciona sin señal y se sincroniza solo (Art. I). Supervisión lo ve en Gerencia y lo gestiona como cualquier hallazgo: asignar responsable, plazo, avance y cierre. La entrada muestra un distintivo "Alerta" y el hallazgo dice que viene de la bitácora.

**Cambios:**
- Migración 025: `finding.log_entry_id` (FK nullable a `log_entry`) y `finding.site_id` (faena del hallazgo cuando no viene de una inspección).
- Sync: `SyncFindingPayload` acepta `log_entry_id` y `site_id` opcionales; validación y upsert (idempotente como siempre).
- Consultas (~15 en `dashboard.service`, `supervision-dashboard.service`, `supervision.service`, `inspection-export.service`): faena = `COALESCE(inspección.site_id, finding.site_id)`.
- Frontend: formulario de bitácora, distintivo en la lista, origen en "Hallazgos" y en el detalle de Gerencia.
- Docs: spec maestro (Enmienda 010, FR-069), spec 002 y 004, `data-model.md`, `test-plan.md`, tarea.
- Pruebas: unitarias del formulario y la cola, integración de sync (idempotencia, RLS, faena correcta) y de Gerencia.

**Tamaño:** medio día con PR, CI y deploy. Va **antes** de cargar la empresa, para que la demo traiga alertas desde la bitácora.

## 3. Empresa de demostración

**Ficticia** (nombres inventados, ninguna empresa real). Propuesta:

- Empresa **Minera Cordillera Austral SpA**, 3 faenas: Faena Cerro Plata, Planta Llano Seco y Obra Camino del Cobre.
- **9 cuentas** con correos `@demo.terrenoconectado.cl` (no necesitan buzón): 1 administración ("gerente"), 2 supervisión, 6 trabajadores repartidos por faena.
- **5 formularios publicados y asignados** por faena y rol: chequeo de seguridad diario, inspección de andamios, equipos móviles, extintores y control de EPP. Uno requiere cofirma.
- **6 semanas de historia** hasta el día de la presentación:
  - ~120 inspecciones (borradores, en curso, enviadas, revisadas), firmadas, con fotos en las respuestas de foto.
  - ~40 hallazgos de todas las severidades: abiertos, asignados con plazo (algunos vencidos), en avance, "listos para revisar" y resueltos con nota.
  - ~150 entradas de bitácora (relevo, seguridad, clima, incidencias), algunas con alerta.
  - 2–3 conflictos de edición para mostrar en Conflictos, con uno ya revisado.
  - 4–6 resúmenes con IA (semanas anteriores) para el historial.
  - Un equipo sin sincronizar hace más de 24 h, para mostrar esa alerta.

**Cómo se carga:** `infra/tools/demo-datos.mjs`, un script que **usa la misma API que la app**: crea la empresa como administrador de plataforma y entra con cada cuenta para crear faenas, cuentas, formularios, inspecciones, bitácoras, hallazgos, revisiones y cofirmas. Pasa por las validaciones, el aislamiento (RLS) y la auditoría. No usa la semilla de desarrollo ni inserta directo en la base de datos (Enmienda 003).

**Contraseñas:** el script genera una por cuenta y las guarda en un archivo local ignorado por Git (`.demo-cuentas.local.json`). No van al repo ni a la app (Art. IX).

**Quién lo corre:**
1. Ensayo local completo con Docker (Postgres real), donde reviso cada rol en el navegador y corrijo lo que se vea mal.
2. **En producción lo corres tú** con tu cuenta de administrador de plataforma (la credencial la escribes tú en tu terminal; yo no ingreso contraseñas en producción).

## 4. Revisión por rol antes de presentar

Con la empresa cargada (local y luego producción), recorrido en teléfono (375 px) y escritorio:

1. **Trabajador:** formularios asignados, inspección completa con foto y firma **en modo avión**, bitácora con alerta, "Hallazgos" asignados (empezar y reportar), cola sincronizando al volver la señal.
2. **Supervisión:** Gerencia (indicadores, tendencias, bloques de supervisión, resumen con IA), revisar y cofirmar, asignar un hallazgo, cerrar uno reportado, Conflictos.
3. **Administración ("gerente"):** Gerencia con "Semana anterior" y su resumen, exportar PDF y Excel, Equipo, Plantillas, importar un Excel (con IA opcional).
4. **Plataforma:** lista de empresas y salud.

Todo lo que se vea vacío, roto o poco claro se corrige con PR y deploy antes de presentar.

## 5. Calendario (≈2 días)

| Bloque | Trabajo |
| :--- | :--- |
| Día 1, mañana | Alerta desde la bitácora: spec, código, pruebas, PR, CI, deploy. |
| Día 1, tarde | Script de carga + ensayo local + revisión por rol + correcciones. |
| Día 2, mañana | Tú corres el script en producción; revisamos juntos cada rol en producción (teléfono y escritorio). |
| Día 2, tarde | Guion de la presentación (qué mostrar con cada cuenta, en qué orden, momento "modo avión") y margen para imprevistos. |

## 6. Riesgos

- **Oracle gratuito:** la VM podría ser reclamada por inactividad; justo antes de presentar, revisar `demo-health.yml` y la página.
- **Docker local apagado:** sin Docker no hay ensayo ni pruebas de integración locales; dependería solo del CI.
- **La alerta desde la bitácora** toca sync y Gerencia: va con pruebas de integración y CI verde antes del deploy; si no alcanza, la demo funciona igual sin ella.
- **Tope de IA:** 20 resúmenes diarios por empresa; el script usa unos 6.

## 7. Decisiones (resueltas por Daniel Ávila, 2026-11-15)

1. Empresa nueva (no se toca "Empresa Piloto").
2. La persona "gerente" es una cuenta de administración (`tenant_admin`).
3. Fotos reales con licencia libre (se pide permiso antes de cada descarga); el script funciona igual sin fotos.
4. Nombres aprobados. Formularios desde el catálogo (TSK-FORM-025).

## 8. Script y cómo correrlo (TSK-DEMO-002)

`infra/tools/demo-datos.mjs` usa sólo la API. Crea la empresa, 3 faenas, 9 cuentas (con su faena), 8 formularios del catálogo publicados y asignados (andamios y trabajo en altura con cofirma), 4 activos con QR y **8 semanas** de historia (llena el gráfico de Gerencia): ~300 inspecciones firmadas (algunas abiertas por QR), ~170 hallazgos con foto opcional (asignados, en curso, listos para revisar, vencidos y cerrados con nota), bitácora con relevos y alertas, revisiones y cofirmas de supervisión, 3 conflictos (uno revisado) y hasta 4 resúmenes con IA de semanas anteriores. El azar es reproducible: cada corrida da los mismos números.

**Ensayo local con fotos (2026-11-15):** 208 fotos guardadas (respuestas y hallazgos) y visibles por la API de Gerencia, 49 inspecciones abiertas por QR, 26 alertas desde la bitácora; corre en ~25 s. **Primer ensayo:** stack E2E con `E2E_KEEP_ALIVE=1`; 4.181 registros sin fallos; Gerencia con 6 por revisar, 8 urgentes y 2 vencidos en la semana; el trabajador ve en el teléfono sus hallazgos asignados (también los de la bitácora).

**En producción (lo corre Daniel en su terminal):**

1. `npm ci` y `npm run build --workspace @terreno/shared`.
2. `node infra/tools/demo-datos.mjs --api https://terrenoconectado.cl/api/v1 --fotos .demo-fotos` (8 fotos de dominio público o CC0, créditos en `infra/tools/demo-fotos-creditos.md`; la carpeta está fuera de Git).
3. Escribir el correo y la clave del administrador de plataforma cuando los pide (no se ven ni quedan en el historial).
4. Las cuentas, sus claves y los códigos QR quedan en `.demo-cuentas.local.json` (ignorado por Git, permisos 600).

**Antes de presentar: refrescar con lo de los últimos días (TSK-DEMO-003).** La empresa se cargó el 15-11 y sus datos envejecen: el jueves "7 días" mostraría poca actividad y lo pendiente parecería abandonado. `--continuar` no crea nada ni cambia claves, nombres o QR impresos: usa las cuentas de `.demo-cuentas.local.json` (no pide la cuenta de plataforma), agrega la actividad desde la última carga hasta ahora (inspecciones firmadas, hallazgos, bitácora y alertas), revisa lo enviado hace más de 2 días, cierra parte de lo vencido y de lo ya reportado de antes y, si hay IA, pide el resumen de la semana anterior. Deja la hora en `ultima_carga`, así que se puede correr la noche anterior y otra vez la mañana de la presentación:

```bash
node infra/tools/demo-datos.mjs --api https://terrenoconectado.cl/api/v1 --fotos .demo-fotos --continuar
```

Ensayo local (empresa cargada con `--ahora 2026-11-15T17:43:00-03:00` y continuada el 17-11): los días 16 y 17 pasaron de 0 a 6 y 8 inspecciones, "por revisar" de 20 a 14, plazos vencidos de 4 a 2 y la bitácora de 7 días de 14 a 24 entradas, en menos de un segundo.

**Borrar y cargar de cero (alternativa, no recomendada):** la API no borra empresas. Habría que borrarla con la cuenta dueña de la base en la VM (`DELETE FROM tenant WHERE id = …`; casi todas las tablas caen en cascada y `audit_log` queda con `tenant_id` nulo), las fotos quedarían huérfanas en el volumen y la nueva carga trae claves y QR nuevos (reimprimir etiquetas).

**Límites conocidos:** la "espera sin señal" y "Equipos sin sincronizar" se calculan con la hora real de llegada al servidor, así que no se pueden fechar hacia atrás; los resúmenes con IA requieren la clave en el servidor (sin ella, el script sigue).
