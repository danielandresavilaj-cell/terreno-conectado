# Informe de prueba E2E local — Terreno Conectado

**Fecha:** 15 de octubre de 2026 · **URL validada:** `http://localhost:5173/`
**Fuente contrastada:** commit `9fd4407` (el servidor local no expone su SHA, por lo que no se puede garantizar que ejecute exactamente este commit).
**Alcance:** evidencia complementaria de **TSK-REP-003** para la medición en vivo de Fase 3 (#15).

## Resultado ejecutivo

La aplicación cargó, autenticó las cuentas demo, restringió las pantallas por
rol, exportó CSV y no presentó errores de consola en los recorridos ejecutados.
El aislamiento visible entre Minera El Cobre y Constructora Andes también se
comportó correctamente.

La entrega no queda certificada como E2E completa: se encontraron dos problemas
reales en datos expuestos por la demo, un control de interfaz sin acción y el
entorno `:5173` activo no permite validar el recorrido offline/PWA real.

## Recorridos efectuados

| Área | Resultado | Evidencia observada |
|---|---|---|
| Inicio de sesión | OK | Sofía (supervisor), Pedro (terreno), Bruno (supervisor tenant B), Andrés (admin tenant) y Admin Plataforma. |
| Restricción por rol | OK | Terreno: Inspección/Bitácora/Cola; supervisor: suma Gerencia/Conflictos; admin tenant: Cola/Gerencia/Conflictos/Plantillas/Importar; plataforma: sólo Gerencia. |
| Aislamiento visual por tenant | OK | Bruno vio sólo Constructora Andes, Obra Costanera y datos de Bárbara; no aparecieron datos de Minera El Cobre. |
| Dashboard y filtros | OK | Se cambiaron período y severidad; las cifras y la lista se actualizaron. |
| Exportación CSV | OK | Se descargó CSV con encabezados y un registro válidos. |
| Conflictos | OK | El supervisor abrió el registro sin errores; el tenant no tenía conflictos pendientes. |
| Plantillas e importador | OK, sólo lectura | El admin visualizó asignaciones y abrió el paso inicial del importador; no se cambiaron asignaciones ni se cargó archivo. |
| Captura sin señal simulada | Parcial | El chip cambió a `SIN SEÑAL`; el borrador mostró progreso local (5/9) y valores conservados en la vista. No se hizo recarga offline real ni envío completo con foto. |
| Consola del navegador | OK | Sin `error` ni `warn` en Login, Gerencia, Conflictos, Plantillas e Importar. |

## Hallazgos

### H-01 — Alta: las métricas de latencia de Minera incumplen el objetivo visible

En Gerencia para Minera El Cobre el dashboard mostró primero **873 s media /
1.624 s p95** y, posteriormente, **519 s / 1.292 s**. La misma pantalla declara
como objetivo NFR-03 **60 s**. Andes, en contraste, mostró 29–30 s de media y
50 s de p95.

**Impacto:** el demo de Minera aparece fuera de SLA y la métrica puede llevar a
una conclusión errónea sobre la sincronización, aunque la UI funcione.

**Siguiente acción sugerida:** revisar `sync_log` y el seed/dataset que alimenta
Minera: timestamps `captured_at`/`synced_at`, datos de pruebas antiguos y
registros creados manualmente. Re-seedear sólo los datos demo o excluir
explícitamente los registros históricos de la métrica operacional.

### H-02 — Media: una inspección de Andes no puede exportarse porque perdió su revisión de plantilla

El dashboard de Constructora Andes mostró una inspección con **“Plantilla no
disponible”, versión 3**. Al seleccionar **Descargar**, la aplicación informó:
_“No se pudo descargar: la inspección apunta a una revisión de plantilla que no
existe en este tenant”_.

**Impacto:** un registro válido y visible no puede entregarse como documento;
afecta trazabilidad/exportación de la inspección.

**Siguiente acción sugerida:** preservar inmutablemente toda revisión usada por
una inspección, o almacenar el original/serialización necesaria junto al
registro. Como mitigación, no ofrecer “Descargar” si falta la revisión y
explicar una acción recuperable. El backend devuelve intencionalmente 404 en
`backend/src/dashboard/inspection-export.service.ts:289`; falta resolver la
integridad de la referencia de los datos demo/producción.

### H-03 — Media: “Guardar borrador” no tiene manejador ni feedback

En Captura se pulsó **Guardar borrador** tras llenar campos offline; no produjo
una señal visible de éxito. El botón no recibe `onClick` en
`frontend/src/screens/Captura.tsx:275-277`, mientras que el botón contiguo de
enviar sí lo recibe.

**Impacto:** aunque existe autoguardado, el usuario interpreta que el botón
persiste su trabajo. El control es inerte y crea incertidumbre en terreno.

**Siguiente acción sugerida:** eliminar el botón si el autoguardado es el único
modelo, o conectarlo a una operación explícita que persista y muestre una
confirmación accesible, por ejemplo: “Borrador guardado en el dispositivo a las
HH:MM”. Añadir una prueba de interacción que compruebe el feedback.

## Restricciones y cobertura pendiente

- El `localhost:5173` activo es una sesión de **Vite de desarrollo**:
  `manifest.webmanifest` y `sw.js` devuelven HTTP 200 pero con el HTML del SPA,
  no con un manifest ni service worker reales. El modo avión/recarga offline/PWA
  debe correrse sobre `vite preview` con build de producción, como indica F-02
  del checklist de validación manual.
- La skill `webapp-testing` se siguió. Su patrón requiere Playwright Python
  headless, que no pudo abrir en este host por la política local de macOS
  (`MachPortRendezvous … Permission denied`). El recorrido se ejecutó mediante
  la automatización Playwright disponible en el navegador de la sesión; no es
  un error de la app.
- No se ejecutaron los escenarios de caos 1–7 con stack aislado, ni el envío
  completo con foto, importación real XLSX o Lighthouse. Para cerrarlos hace
  falta el build de producción y el harness con Postgres/variables de E2E.

## Comprobaciones de repositorio

| Comando | Resultado |
|---|---|
| `npm run lint` | OK |
| `npm run typecheck` | OK — shared, frontend y backend |
| `npm test` | 186 pruebas verdes antes del backend: shared 77/77 y frontend 109/109. |
| Suite backend | No concluyente en esta sesión: primero bloqueó correctamente por faltar `DEMO_PASSWORD`; tras aportar la variable, el runner de Testcontainers no devolvió resultado final al entorno de ejecución. No se contabiliza como verde. |
