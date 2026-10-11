/* Entorno de los tests del cliente.
 *
 * `fake-indexeddb/auto` instala `indexedDB`/`IDBKeyRange` globales, que es lo
 * único que Dexie necesita para abrir la base en Node. No se monta un DOM: los
 * tests apuntan a la capa de caché, no a la UI.
 */
import 'fake-indexeddb/auto'