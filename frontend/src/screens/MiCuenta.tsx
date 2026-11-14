/* Mi cuenta — TSK-AUTH-010.
 *
 * Datos de la sesión, cambio de contraseña y cierre de sesión. Cerrar sesión
 * revoca la sesión en el servidor; lo que quedó sin enviar NO se borra: queda
 * en el dispositivo a nombre de este usuario y sale cuando vuelva a ingresar.
 */
import { useState } from 'react'
import { Boton, Panel } from '../components/ui'
import { FormCambioClave } from '../components/FormCambioClave'
import { PwaActualizacion } from '../components/PwaActualizacion'
import { ROL_LABEL } from '../lib/roles'
import { useEstado } from '../lib/store'

export function MiCuenta() {
  const { usuario, pendientes, salir } = useEstado()
  const [confirmando, setConfirmando] = useState(false)
  if (!usuario) return null

  const pedirSalir = () => {
    if (pendientes > 0) setConfirmando(true)
    else salir()
  }

  return (
    <div className="space-y-5 max-w-[520px]">
      <h1 className="text-[22px] font-semibold tracking-[-0.03em]">Mi cuenta</h1>

      <Panel className="p-5">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[14px]">
          <dt className="text-ink-3">Nombre</dt>
          <dd>{usuario.nombre}</dd>
          <dt className="text-ink-3">Correo</dt>
          <dd className="break-all">{usuario.email}</dd>
          <dt className="text-ink-3">Rol</dt>
          <dd>{ROL_LABEL[usuario.rol]}</dd>
          {usuario.rol !== 'platform_admin' && (
            <>
              <dt className="text-ink-3">Empresa</dt>
              <dd>{usuario.tenant}</dd>
            </>
          )}
        </dl>
      </Panel>

      <Panel className="p-5">
        <h2 className="text-[16px] font-semibold mb-4">Cambiar contraseña</h2>
        <FormCambioClave />
      </Panel>

      <Panel className="p-5">
        <PwaActualizacion />
      </Panel>

      <Panel className="p-5">
        <h2 className="text-[16px] font-semibold mb-2">Cerrar sesión</h2>
        {confirmando ? (
          <div className="space-y-3" role="alert">
            <p className="text-[14px] text-ink-2 leading-relaxed">
              Tienes {pendientes} {pendientes === 1 ? 'registro' : 'registros'} sin enviar. Quedarán
              guardados en este dispositivo y se enviarán cuando vuelvas a ingresar con tu cuenta.
            </p>
            <div className="flex gap-2">
              <Boton variante="peligro" onClick={salir}>
                Cerrar sesión igual
              </Boton>
              <Boton variante="fantasma" onClick={() => setConfirmando(false)}>
                Cancelar
              </Boton>
            </div>
          </div>
        ) : (
          <>
            <p className="text-[14px] text-ink-2 mb-3">
              Cierra la sesión en este dispositivo.
            </p>
            <Boton onClick={pedirSalir}>Cerrar sesión</Boton>
          </>
        )}
      </Panel>
    </div>
  )
}
