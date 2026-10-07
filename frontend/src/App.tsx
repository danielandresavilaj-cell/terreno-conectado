import { useEffect } from 'react'
import { motion } from 'motion/react'
import { Shell } from './components/Shell'
import { Login } from './screens/Login'
import { Captura } from './screens/Captura'
import { Bitacora } from './screens/Bitacora'
import { Cola } from './screens/Cola'
import { Dashboard } from './screens/Dashboard'
import { Conflictos } from './screens/Conflictos'
import { ProveedorEstado, useEstado, type Pantalla } from './lib/store'

/* Permisos por rol (FR-003: permisos crecientes).
 * Esta tabla es la traducción visual de la matriz rol→recurso del spec 001.
 * El campo de terreno no ve el dashboard ejecutivo; el admin de plataforma no
 * ve la captura. Esa diferencia ya comunica el modelo de permisos sin una
 * línea de lógica de autorización real — que es justamente lo que este mockup
 * NO implementa. */
const POR_ROL: Record<string, Pantalla[]> = {
  field_worker: ['captura', 'bitacora', 'cola'],
  supervisor: ['captura', 'bitacora', 'cola', 'dashboard', 'conflictos'],
  tenant_admin: ['cola', 'dashboard', 'conflictos'],
  platform_admin: ['dashboard'],
}

export default function App() {
  return (
    <ProveedorEstado>
      <Raiz />
    </ProveedorEstado>
  )
}

function Raiz() {
  const { usuario, pantalla, ir, hidratando } = useEstado()

  /* Guarda de navegación: si el rol activo no puede ver la pantalla actual,
   * se redirige a la primera que sí puede. Se hace en un efecto (no durante
   * el render) para no actualizar el estado mientras React está pintando. */
  useEffect(() => {
    if (!usuario) return
    const permitidas = POR_ROL[usuario.rol] ?? ['dashboard']
    if (!permitidas.includes(pantalla)) ir(permitidas[0])
  }, [usuario, pantalla, ir])

  /* TSK-WS-011: mientras se restaura la sesión (perfil + identidad + outbox)
   * se muestra un arranque mínimo, no un parpadeo de login. */
  if (hidratando) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
        className="min-h-dvh flex items-center justify-center py-16"
      >
        <div className="text-center space-y-3">
          <div className="h-9 w-9 rounded-[10px] bg-beam grid place-items-center mx-auto">
            <span className="text-s0 font-bold text-[17px] leading-none">TC</span>
          </div>
          <p className="label-inst">Restaurando sesión y cola local…</p>
        </div>
      </motion.div>
    )
  }

  if (!usuario) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.35, ease: [0.23, 1, 0.32, 1] }}
      >
        <Login />
      </motion.div>
    )
  }

  return (
    <Shell>
      {pantalla === 'captura' && <Captura />}
      {pantalla === 'bitacora' && <Bitacora />}
      {pantalla === 'cola' && <Cola />}
      {pantalla === 'dashboard' && <Dashboard />}
      {pantalla === 'conflictos' && <Conflictos />}
    </Shell>
  )
}
