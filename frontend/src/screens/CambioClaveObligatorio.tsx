/* Cambio de clave obligatorio — TSK-AUTH-010.
 *
 * Las cuentas nacen con una clave temporal que define un administrador. Hasta
 * que el usuario la reemplaza, el backend sólo acepta este cambio, así que la
 * app no carga nada más.
 */
import { Boton } from '../components/ui'
import { FormCambioClave } from '../components/FormCambioClave'
import { useEstado } from '../lib/store'

export function CambioClaveObligatorio() {
  const { salir } = useEstado()
  return (
    <main className="min-h-dvh flex items-center justify-center p-6 sm:p-10">
      <div className="w-full max-w-[400px]">
        <div className="flex items-center gap-3 mb-10">
          <div className="h-9 w-9 rounded-[10px] bg-beam grid place-items-center">
            <span className="text-s0 font-bold text-[17px] leading-none">TC</span>
          </div>
          <p className="text-[15px] font-semibold tracking-[-0.02em]">Terreno Conectado</p>
        </div>
        <h1 className="text-[24px] font-semibold tracking-[-0.03em]">Crea tu contraseña</h1>
        <p className="mt-1.5 mb-6 text-[14px] text-ink-2 leading-relaxed">
          Ingresaste con una contraseña temporal. Para continuar, reemplázala por una que solo
          conozcas tú.
        </p>
        <FormCambioClave />
        <Boton variante="fantasma" tamano="md" bloqueCompleto className="mt-3" onClick={salir}>
          Salir
        </Boton>
      </div>
    </main>
  )
}
