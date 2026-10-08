/**
 * @terreno/shared — contratos compartidos entre dispositivos y backend.
 *
 * Punto de partida del paquete (TSK-WS-001). Los DTO de la ingesta por lotes
 * (spec 003, FR-020) viven en `./sync` desde TSK-WS-007; `./id` aporta el
 * UUIDv7 de cliente (FR-015).
 */

export const APP_NAME = 'Terreno Conectado'

export const SHARED_SCHEMA_VERSION = '0.1.0'

export { uuidv7 } from './id'
export * from './sync'
export * from './conflicts'
export * from './dashboard'
export * from './templates'
