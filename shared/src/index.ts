/**
 * @terreno/shared — contratos compartidos entre dispositivos y backend.
 *
 * Punto de partida del paquete (TSK-WS-001). Los DTO de la ingesta por lotes
 * (spec 003, FR-020) viven en `./sync` desde TSK-WS-007; `./id` aporta el
 * UUIDv7 de cliente (FR-015).
 */

export { uuidv7 } from './id'
export * from './sync'
export * from './conflicts'
export * from './dashboard'
export * from './templates'
// Importador `.xlsx` (TSK-FORM-005): se consume por subpath (`@terreno/shared/xlsx`)
// desde backend/worker en 006/007 — no por el barrel, para no arrastrar los tipos
// `Buffer` de ExcelJS al programa del frontend (que no tiene types de Node).
