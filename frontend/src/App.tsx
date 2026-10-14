import { Suspense, lazy, useEffect } from 'react'
import { motion } from 'motion/react'
import { Shell } from './components/Shell'
import { Login } from './screens/Login'
import { ProveedorEstado, useEstado, type Pantalla } from './lib/store'

/* NFR-07 (rendimiento móvil): el chunk inicial lleva SÓLO el Login. Las
 * pantallas pesadas se cargan aparte porque ExcelJS entra al grafo por
 * `Importar` (`@terreno/shared/xlsx`) y por la exportación de `Captura`
 * (`lib/exportar.ts`): con imports estáticos, un Android gama media bajaba
 * ~1,5 MB de JavaScript antes de pintar el primer texto. Con `lazy`, la
 * primera visita a una pantalla pesada baja su chunk (y muestra el mismo
 * arranque mínimo que la restauración de sesión mientras llega). */
const Captura = lazy(() => import('./screens/Captura').then((m) => ({ default: m.Captura })))
const Bitacora = lazy(() => import('./screens/Bitacora').then((m) => ({ default: m.Bitacora })))
const Cola = lazy(() => import('./screens/Cola').then((m) => ({ default: m.Cola })))
const Dashboard = lazy(() => import('./screens/Dashboard').then((m) => ({ default: m.Dashboard })))
const Conflictos = lazy(() => import('./screens/Conflictos').then((m) => ({ default: m.Conflictos })))
const Importar = lazy(() => import('./screens/Importar').then((m) => ({ default: m.Importar })))
const Plantillas = lazy(() => import('./screens/Plantillas').then((m) => ({ default: m.Plantillas })))

/* Permisos por rol (FR-003: permisos crecientes).
 * Esta tabla es la traducción visual de la matriz rol→recurso del spec 001.
 * El campo de terreno no ve el dashboard ejecutivo; el admin de plataforma no
 * ve la captura. Esa diferencia ya comunica el modelo de permisos sin una
 * línea de lógica de autorización real — que es justamente lo que este mockup
 * NO implementa. */
const POR_ROL: Record<string, Pantalla[]> = {
  field_worker: ['captura', 'bitacora', 'cola'],
  supervisor: ['captura', 'bitacora', 'cola', 'dashboard', 'conflictos'],
  tenant_admin: ['cola', 'dashboard', 'conflictos', 'plantillas', 'importar'],
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
      <Suspense fallback={<PantallaCargando />}>
        {pantalla === 'captura' && <Captura />}
        {pantalla === 'bitacora' && <Bitacora />}
        {pantalla === 'cola' && <Cola />}
        {pantalla === 'dashboard' && <Dashboard />}
        {pantalla === 'conflictos' && <Conflictos />}
        {pantalla === 'importar' && <Importar />}
        {pantalla === 'plantillas' && <Plantillas />}
      </Suspense>
    </Shell>
  )
}

/** Fallback de `Suspense` mientras baja el chunk de una pantalla diferida. */
function PantallaCargando() {
  return (
    <div className="py-16 text-center" role="status" aria-live="polite">
      <div className="h-9 w-9 rounded-[10px] bg-beam grid place-items-center mx-auto">
        <span className="text-s0 font-bold text-[17px] leading-none">TC</span>
      </div>
      <p className="label-inst mt-3">Cargando pantalla…</p>
    </div>
  )
}
