/** Preferencia del simulador, independiente de los eventos físicos de red. */
const KEY = 'tc:sin-senal-manual:v1'
type Almacen = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export function leerSinSenalManual(almacen?: Almacen): boolean {
  try { return (almacen ?? window.localStorage).getItem(KEY) === '1' }
  catch { return false }
}

export function guardarSinSenalManual(sinSenal: boolean, almacen?: Almacen): void {
  try {
    const destino = almacen ?? window.localStorage
    if (sinSenal) destino.setItem(KEY, '1')
    else destino.removeItem(KEY)
  } catch { /* En almacenamiento restringido sigue funcionando durante esta sesión. */ }
}
