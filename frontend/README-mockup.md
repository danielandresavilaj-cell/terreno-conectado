# Mockup funcional y animado — Terreno Conectado

Prototipo navegable de la PWA para validar el diseño antes de escribir la lógica de negocio.
**Los botones reaccionan y las transiciones se ven, pero no hay persistencia, API, IndexedDB ni
cola real.** El único ciclo simulado de verdad es el de la cola de sincronización
(`pending → syncing → synced`), porque es el momento que demuestra la propuesta de valor
(spec maestro §9, paso 3) y sin él el mockup no cuenta la historia. Desde TSK-WS-004 es
**instalable** (manifest + service worker) y funciona sin red tras la primera carga (FR-010).

## Correr

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # bundle de producción en dist/ (genera sw.js + manifest.webmanifest)
```

## Recorrido de demo (guion del spec maestro §9)

1. **Login** — elige una de las 4 cuentas demo. `Carla Ñanco` es el trabajador de terreno;
   `Tomás Ibáñez`, el supervisor; `Bernardita Ruiz`, la admin de empresa. Escribe cualquier
   contraseña de 4+ caracteres.
2. **Captura** — responde ítems del checklist. Marca `NOK` en un ítem que pida hallazgo
   obligatorio y se abre el panel de registro con severidad y foto.
3. **Cola** — abajo a la derecha está el interruptor **Sin señal / En línea**. Actívalo y la
   cola se drena sola: verás las filas pasar a *Sincronizando* y luego a *Sincronizado*,
   con el barrido de confirmación y la latencia por registro.
4. **Gerencia** — dashboard con la latencia captura→disponibilidad p50/p95, inspecciones por
   estado, hallazgos por severidad y filtros por faena/severidad.
5. **Conflictos** — las dos versiones de un registro editado en paralelo, con LWW aplicado.

Los permisos se reflejan en la navegación: el trabajador no ve *Gerencia*, el admin de
plataforma solo ve *Gerencia*.

## Pantallas y requisitos que cubren

| Pantalla | FR / NFR representados |
| :--- | :--- |
| Login | FR-001, FR-003, FR-005 (rate-limit visible), FR-006 (tenant demo) |
| Captura | FR-011, FR-012 (compresión de foto), FR-014 (autoguardado), FR-030, FR-031, FR-032 (hallazgo en `nok`) |
| Bitácora | FR-033, FR-034 (faena + geolocalización) |
| Cola | FR-013 (4 estados + contador), FR-016 (disparo por `online`), FR-017 (aviso de cuota), FR-020, FR-021, FR-022 (backoff), FR-024 (latencia) |
| Gerencia | FR-035 (destacado alta/crítica), FR-040, FR-041, FR-042 (CSV), FR-043, NFR-03 |
| Conflictos | FR-023 (LWW + ambas versiones), FR-051 (audit log) |

## Identidad visual

Ingeniería de diseño en torno al contexto real del proyecto — faenas mineras en la Atacama,
con guantes, polvo y luz solar directa:

- **Superficies de grafito cálido** con frente de texto muy brillante: el contraste alto-claro
  sobre fondo oscuro se lee mejor bajo el sol que el reverso.
- **Ámbar sodio** como acento primario (los focos de faena), **cobre** como secundario.
- **Tipografía**: Archivo (rotulación industrial, signage) + IBM Plex Mono para etiquetas y
  cifras de telemetría. Se evita Inter a propósito: es el default que hace que todo se vea generado.
- **Targets táctiles de 44–48 px** y separación amplia, porque el usuario lleva guantes (spec 002,
  "UX de captura con guantes/luz solar").

## Criterios de movimiento

El movimiento está justificado caso por caso, no aplicado por omnímodo. Resumen:

| Interacción | Duración / curva | Por qué |
| :--- | :--- | :--- |
| Presión de botón | `scale(0.97)`, 160 ms ease-out | Retroalimentación pura; se usa cientos de veces al día |
| `ok` / `nok` / `n/a` | spring 260 ms, bounce 0.22 | Es la interacción central del producto; debe sentirse como respuesta física |
| Cambio de estado de la cola | color, 200 ms CSS | Las filas cambian en cadena; con keyframes parpadearían |
| Confirmación de sincronizado | barrido 700 ms, una vez | Comunica "esto acaba de pasar" sin comparar el badge |
| Panel de hallazgo | spring 420 ms, origen en el disparador | El origen en el espacio evita perder el hilo |
| Cifras del dashboard | count-up 550 ms | Explicación: son magnitudes medidas, no literales |
| Barras de gráficas | `scaleX` 620 ms, stagger 60 ms | La cascada permite comparar longitudes |
| Cierre de panel | 200 ms ease-out | Sale más rápido que entra: la salida no debe hacer esperar |
| Toggle de señal | pop + knob con `layout` | Acción manual y rara; su efecto es el mensaje central del producto |

Lo que **no** anima, por decisión:

- **Nada iniciado por teclado.** El foco es instantáneo; esas acciones se repiten sin parar.
- **Filtros y navegación entre secciones.** Un slide daría la sensación errónea de historial.
- **Perpetuos salvo el pulso de "sincronizando".** Un dial girando en un dashboard que se mira
  fijamente compite con los números.
- **Hover con `transform`.** En táctil el hover se dispara en el tap y produce falsos positivos.
- **Stagger en listas que se desplazan.** En scroll se siente como retraso.
- **Intercambio animado de versiones en un conflicto.** LWW es determinista; animar el swap
  sugeriría que el usuario puede intervenir la decisión.

Además: solo se animan `transform` y `opacity`; ninguna entrada arranca en `scale(0)`;
nunca se usa `ease-in`; y todo respeta `prefers-reduced-motion` conservando el color y la
opacidad que ayudan a comprender.

## Estructura

```
src/
  App.tsx                 Permisos por rol + routing del mockup
  index.css               Tokens de diseño (@theme) y keyframes
  lib/
    types.ts              Tipos del dominio (espejo de data-model.md)
    seed.ts               Datos semilla es-CL del tenant demo
    motion.ts             Tokens de movimiento compartidos
    store.tsx             Estado del mockup + ciclo de la cola
  components/
    Shell.tsx             Barra superior, navegación, interruptor de señal
    ui.tsx                Botón y Tarjeta (primitivas de presión/selección)
    Badges.tsx            BadgeSync (FR-013) y BadgeSev (FR-032)
    CountUp.tsx           Contador y barra de crecimiento
    SheetHallazgo.tsx     Panel modal de hallazgo (FR-032)
  screens/
    Login.tsx  Captura.tsx  Bitacora.tsx  Cola.tsx  Dashboard.tsx  Conflictos.tsx
```

## Qué falta para el producto real

Todo lo que el mockup no es, y que el ciclo `spec → plan → tasks → código → tests → evidencia`
de la constitución exige antes de implementarse: Dexie e IndexedDB, Workbox y service worker,
compresión de imagen en canvas, cola idempotente con backoff, endpoints NestJS, RLS en
PostgreSQL, y la suite de pruebas del `test-plan.md` (caos offline, intrusión cross-tenant).
