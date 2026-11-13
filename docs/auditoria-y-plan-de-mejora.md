# Auditoría de producto y plan de mejora — Terreno Conectado

| | |
| :--- | :--- |
| **Fecha** | 2026-11-13 |
| **Base auditada** | `main` en `c9ae938` (v1.3 + firma offline #193) |
| **Estado** | Fase 0 implementada (TSK-OFF-007/008/009). Fases 1–3 siguen siendo propuesta: cada ítem que cambie comportamiento necesita su FR/enmienda, tarea e issue (Art. II y X) |
| **Autor** | Daniel Ávila (con IA) |

## 1. Alcance y método

**Qué se revisó:** spec maestro, constitución, README, modelo de datos, las 13 pantallas y los componentes
del `frontend/`, el store, la configuración PWA, los controladores del backend (superficie de la API) y el
login de producción (`terrenoconectado.cl`) en viewport móvil.

**Qué NO se pudo hacer** (y limita la auditoría):

- No se recorrió la app autenticada: Docker no estaba corriendo y no hay `.env` local, así que no se levantó
  el backend; en producción no se ingresó con ninguna cuenta. Todo lo que está detrás del login se auditó
  **leyendo código**, no usando la app. Los hallazgos marcados *(verificar en dispositivo)* dependen de eso.
- No se corrieron `lint`, `typecheck`, `test` ni `e2e`. Esta auditoría es de producto y UX, no de calidad de código.
- No se midió Lighthouse ni rendimiento real en un Android de gama media.

**Skills usadas (vía `/find-skills`).** La CLI `npx skills find` devuelve vacío dentro del sandbox, así que se
consultó la API de skills.sh directamente. No se instaló ninguna skill (el sandbox no permite escribir en
`~/.claude/skills`); se usaron como lista de chequeo las guías públicas de las dos primeras:

| Skill | Instalaciones | Para qué sirve aquí | Instalar |
| :--- | ---: | :--- | :--- |
| `vercel-labs/agent-skills@web-design-guidelines` | 855 k | Checklist de interfaz (accesibilidad, formularios, táctil, navegación). **Usada.** | `npx skills add vercel-labs/agent-skills@web-design-guidelines -g -y` |
| `wondelai/skills@ux-heuristics` | 10 k | Heurísticas de Nielsen para evaluar flujos. **Usada.** | `npx skills add wondelai/skills@ux-heuristics -g -y` |
| `addyosmani/web-quality-skills@accessibility` | 69 k | Auditoría WCAG | `npx skills add addyosmani/web-quality-skills@accessibility -g -y` |
| `anthropics/skills@frontend-design` | 1,1 M | Dirección visual al rediseñar pantallas | `npx skills add anthropics/skills@frontend-design -g -y` |
| `kadajett/agent-nestjs-skills@nestjs-best-practices` | 31 k | Revisión del backend (fuera de esta auditoría) | `npx skills add kadajett/agent-nestjs-skills@nestjs-best-practices -g -y` |

No hay skills maduras para PWA offline-first (la mejor tiene 4 k instalaciones) ni para propuesta de valor
(3 k); esas partes se hicieron sin skill.

## 2. Diagnóstico en una página

**Lo que está bien y no hay que tocar.** El núcleo técnico cumple lo que promete: captura offline con
autoguardado, cola idempotente, RLS, conflictos auditados. La pantalla **Cola** está bien resuelta (habla
de "envíos", no de registros técnicos; explica qué pasa sin señal). El sistema de diseño tiene identidad
propia, tokens consistentes, modo claro/oscuro, `prefers-reduced-motion`, foco visible, botones de 44 px
y controles de chips en vez de desplegables para usar con guantes.

**El problema de fondo.** El producto hoy es un excelente **capturador** y un **consolidador** correcto,
pero el ciclo "dato → decisión → acción" que justifica la propuesta de valor se corta en tres puntos:

1. **La evidencia no se ve.** Las fotos de terreno no se muestran en ninguna pantalla de supervisión;
   sólo salen en los archivos exportados.
2. **El hallazgo no tiene dueño.** Un hallazgo sólo cambia de estado (abierto → en curso → resuelto); no
   tiene responsable, plazo, comentario ni evidencia de cierre, y el trabajador nunca vuelve a verlo.
3. **La bitácora no la lee nadie.** Se sincroniza al servidor pero no existe ninguna ruta ni pantalla que
   la muestre a otra persona: el turno siguiente no puede leer el relevo.

Además hay **defectos concretos** que un cliente real encontraría el primer día (turno "B" escrito a
mano, faena fija a la primera de la empresa, "editar hallazgo" que duplica) y una **capa de jerga
técnica** en la interfaz ("plantilla dinámica", "tenant", "revisión congelada", "caché") que no
corresponde a un trabajador de faena.

## 3. Hallazgos

Severidad: **A** = rompe la promesa o entrega datos erróneos · **M** = fricción seria · **B** = pulido.

### 3.1 Defectos funcionales

| # | Sev. | Hallazgo | Evidencia |
| :--- | :---: | :--- | :--- |
| D1 | A | **"Turno B" está escrito a mano.** Aparece en el encabezado de toda inspección, en el título de la bitácora y como etiqueta preseleccionada. No existe el concepto de turno en el modelo. | `frontend/src/screens/Captura.tsx:179`, `Bitacora.tsx:23,30,47` |
| D2 | A | **La faena del usuario es siempre la primera de la empresa.** El usuario no tiene faena asignada en el modelo (`USER` no tiene `site_id`) y la captura no ofrece elegirla. En una empresa con 2+ faenas, todas las inspecciones quedan en la primera y el trabajador sólo ve los formularios de esa. | `frontend/src/lib/store.tsx:241,822`; `data-model.md` §2.1 |
| D3 | A | **"Hallazgo registrado · ver y editar" no edita: crea otro.** El panel se abre vacío (se reinicia al abrir) y guardar siempre inserta un hallazgo nuevo con otro UUID. El supervisor ve duplicados. | `SheetHallazgo.tsx:44-53`, `store.tsx:920-951`, `FormRenderer.tsx:198-206` |
| D4 | M | **Un hallazgo se puede guardar sin descripción**, incluso crítico; queda como "Sin descripción". | `store.tsx:948` |
| D5 | M | **Sólo se puede registrar hallazgo si la plantilla lo exige.** Un NOK en un ítem sin `require_finding_on_nok` no ofrece la acción, y no hay hallazgo "directo" aunque el glosario del spec lo define. | `FormRenderer.tsx:96,188` |
| D6 | M | **La bitácora muestra un dato inventado**: cada entrada dice "· guardada en el dispositivo" en el lugar de la antigua geolocalización, aunque ya se haya sincronizado. | `store.tsx:261`, `Bitacora.tsx:192` |
| D7 | B | Mensaje de validación en voseo ("Debés registrar…") en una interfaz es-CL. | `frontend/src/lib/validar-envio-inspeccion.ts:26` |

### 3.2 UX de terreno (trabajador)

| # | Sev. | Hallazgo | Evidencia |
| :--- | :---: | :--- | :--- |
| U1 | A | **El botón Atrás de Android no navega.** La pantalla activa es un `useState`; no hay historial ni URL. En la PWA instalada, Atrás saca al usuario de la app en vez de volver a la pantalla anterior. El borrador no se pierde, pero es el gesto más usado en Android. | `store.tsx:302`; no hay `pushState`/`popstate` en `frontend/src` |
| U2 | A | **Enviar una inspección no confirma nada.** Tras firmar, el formulario simplemente vuelve a quedar vacío en 0 %. No hay "Inspección enviada", ni resumen, ni salto a la cola. El trabajador no sabe si funcionó. | `store.tsx:979-1001` |
| U3 | M | **Un solo borrador a la vez.** Para cambiar de formulario hay que terminar o descartar el actual. Quien inspecciona tres equipos en paralelo no puede. | `store.tsx:556-560`, `Formularios.tsx:41` |
| U4 | M | **La foto no se puede revisar.** Tras capturar sólo dice "Foto capturada" (o el nombre `evidencia-1731….jpg`); no hay miniatura ni vista previa. Sólo se admite una foto por ítem o hallazgo. | `Campos.tsx:311-326`, `SheetHallazgo.tsx:213-221` |
| U5 | M | **Cámara propia en vez de la nativa.** `getUserMedia` no da flash, enfoque táctil ni HDR; en faena (interior de equipo, noche) el flash importa. La cámara nativa vía `<input capture>` ya existe como opción secundaria "Seleccionar archivo". | `CamaraCaptura.tsx:72-75,173-182` |
| U6 | M | **Sin historial propio.** El trabajador sólo ve lo enviado en las últimas 24 h dentro de la cola; no puede consultar ni reexportar una inspección de la semana pasada. | `Cola.tsx:200-208` |
| U7 | M | **Jerga de implementación frente al trabajador**: "Captura con plantilla dinámica", "Plantilla del servidor / en caché", "Revisión congelada ausente", "Guardado en cola · online", "se comprime a 1280 px · q0.7 antes de encolar", "tope 25 MB", "se liberaron en esta pasada". | `Captura.tsx:174,187-192,372-378,407-413`, `SheetHallazgo.tsx:217-220` |
| U8 | M | **La acción principal es pequeña y está al fondo.** "Firmar y enviar" es un botón `sm` dentro de un panel al final del scroll, seguido de dos bloques sobre exportación. Debería ser el cierre visible del formulario. | `Captura.tsx:334-343` |
| U9 | M | **Firma sin contexto.** El diálogo no muestra quién firma ni qué firma (formulario, ítems respondidos, NOK, hallazgos). Para una "operación certificada", lo que se declara debería estar a la vista. | `FirmaCierre.tsx:89-96` |
| U10 | M | **En móvil no se ve quién soy ni en qué faena estoy** (nombre y faena se ocultan bajo `sm`), y la navegación son pestañas de 13 px con scroll horizontal arriba; la barra inferior sólo muestra estado. El pulgar no llega arriba con una mano. | `Shell.tsx:186-191,213-239,280-297` |
| U11 | B | La severidad viene preseleccionada en "media": sesga el registro. Mejor sin selección y obligatoria. | `SheetHallazgo.tsx:38,46` |
| U12 | B | Etiquetas de la bitácora fijas en el código; el panel de hallazgo no atrapa el foco (el de cámara sí). | `Bitacora.tsx:23`, `SheetHallazgo.tsx:100-103` |

### 3.3 Diseño visual

| # | Sev. | Hallazgo | Evidencia |
| :--- | :---: | :--- | :--- |
| V1 | A | **Texto secundario demasiado chico y con poco contraste para sol directo.** `label-inst` es de 10 px en `ink-3`, usado 106 veces; hay 100 usos más de 10–12 px. Contraste medido de `ink-3` en modo oscuro: **3,86:1** sobre panel y **3,09:1** sobre `s3` (AA pide 4,5:1 en texto de este tamaño). Contradice el objetivo que declara el propio `index.css` ("guantes y luz solar directa"). | `index.css:141-148`; tokens `:27` |
| V2 | M | **Bordes de campos casi invisibles.** `line-soft`/`line` dan 1,3–1,5:1 contra su fondo en ambos temas (WCAG 1.4.11 pide 3:1 en controles). En el login de producción los campos se distinguen sólo por un leve cambio de fondo. | `index.css:21-22,82-83` |
| V3 | M | **El modo oscuro es el predeterminado**, pero a pleno sol una pantalla clara se lee mejor. El modo claro ya existe y pasa AA (`ink-3` 5,4:1). Conviene seguir `prefers-color-scheme` o partir en claro para roles de terreno. | `frontend/index.html:2` |
| V4 | M | **Objetivos táctiles bajo 44 px fuera del botón base**: chips de etiquetas y faena de la bitácora (32 px), selector de período y campos de fecha del dashboard (32–36 px), "mostrar contraseña" (36 px), pestañas de navegación (~40 px). | `Bitacora.tsx:97,126`, `Dashboard.tsx:349,375`, `Login.tsx:202`, `Shell.tsx:222` |
| V5 | B | **Nombres inconsistentes para lo mismo**: Formularios / Plantillas / Inspección / Captura; Gerencia / Dashboard; "Equipo" contiene faenas; el asistente tiene un paso "Preview". | `Shell.tsx:32-150`, `Importar.tsx:66` |
| V6 | B | Diálogo nativo `window.confirm` en el editor (rompe el estilo) y desactivar una cuenta o cambiar su rol se ejecuta sin confirmación. | `Importar.tsx:831`, `Administracion.tsx:204,222` |
| V7 | B | Comentarios de código que aún hablan de "mockup" y "toggle de señal": confunden a quien llega al repo (y a un agente). | `Shell.tsx:4`, `App.tsx:31`, `lib/types.ts:2`, `lib/store.tsx:14` |

### 3.4 Supervisión y gerencia

| # | Sev. | Hallazgo | Evidencia |
| :--- | :---: | :--- | :--- |
| S1 | A | **Las fotos no se ven en pantalla.** El hallazgo muestra "foto 1280×960 · 120 KB" pero no la imagen; la API no tiene ruta de lectura de adjuntos y el único `<img>` del frontend es la miniatura de la cola local. La evidencia sólo existe en el Excel/PDF exportado. | `Dashboard.tsx:1097-1099`; controladores sin `GET` de adjuntos |
| S2 | A | **La bitácora es de sólo escritura.** `log_entry` aparece en el backend únicamente en la ingesta de sync; ni el dashboard ni otro dispositivo pueden leerla. | `backend/src/sync/sync.service.ts` es el único uso |
| S3 | A | **El hallazgo no tiene gestión**: sólo `status`. Sin responsable, plazo, comentario ni evidencia de cierre. | `backend/src/supervision/supervision.controller.ts:23,77` |
| S4 | M | **La métrica protagonista es técnica.** La fila principal muestra "Procesamiento p95" en segundos. A una gerencia le sirve más: hallazgos críticos abiertos y su antigüedad, cumplimiento del programa, tiempo captura → revisión, ítems que más fallan. No hay ninguna serie temporal. | `Dashboard.tsx:435-463` |
| S5 | M | **La tabla de inspecciones no funciona en teléfono** *(verificar en dispositivo)*: filas con ancho mínimo de 870 px; el encabezado tiene su propio contenedor con scroll y las filas no, así que se desalinean o desbordan. El supervisor "se mueve entre terreno y oficina" según el spec. | `Dashboard.tsx:690-706,816-819` |
| S6 | M | **Filtros partidos en tres lugares**: período arriba, faena/severidad/autor como columnas de tarjetas a mitad de página, y otros tres desplegables sobre la tabla. El filtro de autor existe dos veces con estados distintos. | `Dashboard.tsx:343-387,541-589,640-659` |
| S7 | B | Textos de cara al cliente con vocabulario interno: "Dashboard por tenant", "Datos visibles para tu tenant… el aislamiento es una regla de la base de datos". | `Dashboard.tsx:330,743-747` |

### 3.5 Administración y entrada al producto

| # | Sev. | Hallazgo | Evidencia |
| :--- | :---: | :--- | :--- |
| A1 | M | **Alta de usuarios de a uno**, con clave temporal que el admin debe copiar y entregar a mano. Una faena con 80 personas no se carga así. Sin recuperación de clave por correo (decisión de alcance vigente, §10 del spec). | `Administracion.tsx:149-183` |
| A2 | M | **Plantillas sin ciclo de vida visible**: la API no tiene archivar/eliminar/duplicar; la pantalla sólo asigna. No hay vista previa "como la verá el trabajador". | `backend/src/templates/templates.controller.ts` (rutas), `Plantillas.tsx` |
| A3 | M | **`terrenoconectado.cl` es directamente el login.** No hay una página que explique qué es, para quién, ni cómo pedir una prueba; en móvil ni siquiera se ve el lema (la columna de marca es sólo de escritorio). | `Login.tsx:83,138-150` |
| A4 | B | Empresa nueva parte vacía: sin formularios de ejemplo ni guía de primeros pasos (catálogo de plataforma, TSK-FORM-012, sigue en V2). | issue #45 |

## 4. Plan de mejora

Tamaños orientativos (estimación mía, sin validar con el equipo): **S** ≤ 1 día · **M** 2–4 días · **L** ≥ 1 semana.
"Enmienda" indica que cambia alcance o un FR y necesita PR `AMENDMENT-NNN` antes del código.

### Fase 0 — Corregir lo que hoy está mal (antes de mostrarlo a un cliente o al docente)

> **Hecha el 2026-11-13** en TSK-OFF-007 (0.1–0.4, 0.6), TSK-OFF-008 (0.5) y TSK-OFF-009 (0.7, 0.8).
> Al implementar 0.2 apareció un defecto más, también corregido: tras recargar la app, un ítem NOK
> se daba por "con hallazgo" aunque no lo tuviera y la inspección se podía enviar sin él.
> Validado con pruebas unitarias, lint, typecheck y build; el recorrido en un teléfono real sigue pendiente.

| # | Acción | Resuelve | Tam. | Enmienda |
| :--- | :--- | :--- | :---: | :---: |
| 0.1 | Quitar "Turno B": mostrar fecha real; las etiquetas de bitácora sin turno fijo | D1 | S | No |
| 0.2 | Editar hallazgo de verdad: cargar el existente y actualizarlo (mismo UUID, `client_version`+1) | D3 | M | No |
| 0.3 | Descripción obligatoria en hallazgos alta/crítica; severidad sin preselección | D4, U11 | S | Aclaración FR-032 |
| 0.4 | Pantalla de confirmación tras enviar: "Inspección enviada / guardada para enviar", resumen y botón "Nueva inspección" | U2 | S | No |
| 0.5 | Historial de navegación (`history.pushState` + `popstate`, o hash por pantalla) para que Atrás funcione | U1 | M | No |
| 0.6 | Quitar el texto "guardada en el dispositivo" de la bitácora y mostrar el estado real de sync | D6 | S | No |
| 0.7 | Pasada de textos: eliminar jerga (U7, S7), unificar nombres (V5), corregir voseo (D7) | U7, S7, V5, D7 | M | No |
| 0.8 | Subir `label-inst` a 12 px y `ink-3` a ≥ 4,5:1; bordes de campos a ≥ 3:1 | V1, V2 | S | No |

La 0.8 son cambios de tokens en `index.css`: afectan toda la app de una vez, hay que mirar cada pantalla después.

### Fase 1 — Terreno de verdad (lo que hace que el trabajador la prefiera al papel)

| # | Acción | Resuelve | Tam. | Enmienda |
| :--- | :--- | :--- | :---: | :---: |
| 1.1 | **Faena por usuario**: asignación usuario ↔ faena(s) en el modelo y selector de faena al iniciar una inspección | D2 | L | Sí (modelo + FR-034) |
| 1.2 | **Fotos**: cámara nativa como opción principal, miniatura con "ver / repetir / quitar", varias fotos por hallazgo | U4, U5 | M | Aclaración FR-012/037 |
| 1.3 | **Navegación inferior en móvil** con las 3–4 secciones del rol + estado de sync; nombre y faena visibles | U10, V4 | M | No |
| 1.4 | **Cierre de inspección**: botón grande fijo al pie, resumen antes de firmar (respondidos, NOK, hallazgos) y nombre del firmante en el diálogo | U8, U9 | M | No |
| 1.5 | **Hallazgo opcional en cualquier NOK** y hallazgo directo sin ítem | D5 | M | Aclaración FR-032 |
| 1.6 | **Varios borradores** en paralelo (lista "En curso" en Formularios) | U3 | L | Sí (spec 002) |
| 1.7 | **Mis inspecciones**: historial local de lo enviado (30 días) con reexportación | U6 | M | Aclaración spec 002 |
| 1.8 | Tema según el sistema, claro por defecto en roles de terreno | V3 | S | No |

1.1 es la más importante de la fase: sin ella el producto no sirve a una empresa con más de una faena.
1.6 toca el supuesto "un borrador" que atraviesa store, Dexie y los tests de caos; conviene hacerla
después de 1.1 y con su propio plan.

### Fase 2 — Cerrar el ciclo (dato → decisión → acción)

Aquí está la mayor ganancia de propuesta de valor. Coordinar con el issue abierto **#188 (TSK-OPS-004,
seguimiento operativo)**, que apunta en la misma dirección, para no duplicar diseño.

| # | Acción | Resuelve | Tam. | Enmienda |
| :--- | :--- | :--- | :---: | :---: |
| 2.1 | **Ver la evidencia** — ✅ hecha (TSK-REP-008, FR-062, Enmienda 008): ruta autenticada de lectura de adjuntos con RLS y fotos en el listado de hallazgos y el detalle de inspección. Sin auditoría por vista: se decidió no llenar `audit_log` con lecturas | S1 | M | Sí (FR nuevo) |
| 2.2 | **Hallazgo como acción correctiva**: responsable, plazo, comentario y foto de cierre; vencidos destacados | S3 | L | Sí (FR nuevos) |
| 2.3 | **Bajada de datos al dispositivo**: el trabajador recibe los hallazgos que le asignaron y puede cerrarlos offline. Es el primer flujo servidor → dispositivo fuera de plantillas; hay que definir conflictos | S3, U6 | L | Sí (spec 003) |
| 2.4 | **Bitácora legible**: vista por faena y fecha para supervisión y para el turno entrante | S2 | M | Sí (FR-033) |
| 2.5 | **Dashboard de decisiones**: críticos abiertos y antigüedad, tiempo captura → revisión, ítems que más fallan, tendencia semanal; latencia técnica a un bloque secundario; filtros en una sola barra; tabla que se apila en móvil | S4, S5, S6 | L | Aclaración spec 005 |

2.2 se apoya en el correo de la Enmienda 007 (TSK-OPS-003-E) para avisar asignaciones y vencimientos;
tiene sentido ordenarla después de esa tarea.

### Fase 3 — Entrada al producto y crecimiento

| # | Acción | Resuelve | Tam. | Enmienda |
| :--- | :--- | :--- | :---: | :---: |
| 3.1 | **Página de presentación** en la raíz (qué es, para quién, tres pruebas: sin señal, sin duplicados, datos aislados; contacto) y login en `/ingresar` | A3 | M | No |
| 3.2 | **Biblioteca de formularios listos** (camioneta, extintores, andamios, orden y aseo…) que una empresa nueva copia y edita | A4 | M | Reactivar TSK-FORM-012 |
| 3.3 | **Alta masiva de usuarios** desde una planilla | A1 | M | Aclaración FR-053 |
| 3.4 | **Recuperación de clave por correo** (hoy fuera de V1 por decisión explícita; reutiliza la outbox de la Enmienda 007) | A1 | M | Sí (§10) |
| 3.5 | Ciclo de vida de plantillas: archivar, duplicar, vista previa de trabajador | A2 | M | Aclaración spec 007 |
| 3.6 | Formularios con lógica: preguntas condicionales y puntaje de cumplimiento | — | L | Sí |

### Orden recomendado

1. **Fase 0 completa** — son correcciones, casi todas chicas, y varias se ven en la demo.
2. **1.1 (faena por usuario)** y **2.1 (ver fotos)** — los dos vacíos que más pesan frente a un cliente.
3. Terminar la **Enmienda 007** ya aprobada (QR, programación, correo), que habilita 2.2 y 3.4.
4. **2.2 → 2.3 → 2.5**, y Fase 3 según haya o no intención comercial después de la asignatura.

Con dos personas y el calendario académico (Art. X), la Fase 0 más 1.1 y 2.1 es un objetivo realista
antes del cierre; el resto es hoja de ruta posterior y conviene decirlo así en el informe final.

## 5. Cómo saber si mejoró

| Qué medir | Hoy | Meta |
| :--- | :--- | :--- |
| Contraste mínimo de texto en ambos temas | 3,09:1 | ≥ 4,5:1 |
| Tamaño mínimo de texto en pantallas de terreno | 10 px | ≥ 12 px (cuerpo ≥ 14 px) |
| Objetivos táctiles bajo 44 px en pantallas de terreno | ≥ 6 patrones | 0 |
| Cadenas con jerga técnica visibles para `field_worker` | ≥ 8 | 0 |
| Hallazgos alta/crítica sin descripción | posible | imposible |
| Tiempo captura → revisión (mediana) | no se mide | visible en el dashboard |
| Hallazgos críticos abiertos con responsable y plazo | 0 % (no existe) | 100 % |
| Prueba con 3 personas de terreno: completan una inspección con hallazgo y foto sin ayuda | no hecha | 3 de 3 |

La última fila es la que más información daría y la única que no se resuelve con código: ninguna
revisión de escritorio reemplaza ver a alguien de terreno usar la app con guantes.
