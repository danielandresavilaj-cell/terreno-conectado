/**
 * TSK-E2E-003 — pools de las pruebas de integración que no fallan al apagarse.
 *
 * Cada spec levanta PostgreSQL con Testcontainers y abre un `pg.Pool` propio
 * (dueño) para sembrar y verificar. Al terminar, `afterAll` hace
 * `pool.end()` y `container.stop()`. Si un cliente inactivo todavía tiene el
 * socket abierto cuando el contenedor se apaga, PostgreSQL le manda
 * `FATAL 57P01` (admin_shutdown) y el pool emite `'error'`. Sin listener, Node
 * lo convierte en excepción no manejada: vitest la reporta como "Unhandled
 * Error" y sale con código 1 aunque **todas** las pruebas hayan pasado. Pasó en
 * el CI de un PR y en la compuerta de `deploy.yml` (2026-11-14), al azar.
 *
 * `DbService` ya trata así sus pools (`backend/src/db/db.service.ts`); esto es
 * lo mismo para los pools de las pruebas. Sólo se ignora el cierre ordenado del
 * servidor: cualquier otro error de un cliente inactivo se relanza para que la
 * prueba lo vea, igual que antes.
 */
import { Pool, type PoolConfig } from 'pg'

/** SQLSTATE de PostgreSQL al cerrar conexiones por apagado (admin_shutdown). */
export const CIERRE_DEL_SERVIDOR = '57P01'

export function esCierreDelServidor(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === CIERRE_DEL_SERVIDOR
}

/** `new Pool(...)` para pruebas, con el cierre del contenedor atendido. */
export function poolDePrueba(config: string | PoolConfig | undefined): Pool {
  const pool = new Pool(typeof config === 'string' || config === undefined ? { connectionString: config } : config)
  pool.on('error', (err) => {
    if (esCierreDelServidor(err)) return
    throw err
  })
  return pool
}
