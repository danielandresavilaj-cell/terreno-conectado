/* Plataforma — spec 006 (FR-050/051), UI mínima de v1.
 *
 * El administrador de plataforma da de alta empresas, crea su primer
 * administrador (con clave temporal), las suspende o reactiva y revisa la
 * auditoría. No ve datos operacionales de ninguna empresa.
 */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Boton, Panel } from '../components/ui'
import { CLASE_CAMPO } from '../components/FormCambioClave'
import {
  ApiError,
  cambiarEstadoEmpresa,
  crearAdminEmpresa,
  crearEmpresa,
  listarAuditoria,
  listarEmpresas,
  type EmpresaPlataforma,
  type EntradaAuditoria,
} from '../lib/api'
import { generarClaveTemporal } from '../lib/clave'

const mensajeDe = (err: unknown) =>
  err instanceof ApiError
    ? err.status === 0
      ? 'Sin conexión con el servidor.'
      : err.detalle
    : 'Algo salió mal. Intenta nuevamente.'

/** "Minera El Cobre SpA" → "minera-el-cobre-spa" (código para el login). */
function slugDe(nombre: string): string {
  return nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
}

const ACCION_LABEL: Record<string, string> = {
  tenant_created: 'Empresa creada',
  tenant_suspended: 'Empresa suspendida',
  tenant_reactivated: 'Empresa reactivada',
  tenant_admin_assigned: 'Administrador asignado',
  role_changed: 'Rol cambiado',
  user_created: 'Cuenta creada',
  user_updated: 'Cuenta modificada',
  password_reset: 'Clave restablecida',
  password_changed: 'Clave cambiada',
  site_created: 'Faena creada',
  site_updated: 'Faena modificada',
  logout: 'Cierre de sesión',
  token_reuse: 'Reuso de sesión detectado',
  sync_tenant_mismatch: 'Intento de sincronizar datos de otra empresa',
  platform_admin_bootstrap: 'Administrador de plataforma inicial',
}

export function Plataforma() {
  const [empresas, setEmpresas] = useState<EmpresaPlataforma[]>([])
  const [auditoria, setAuditoria] = useState<EntradaAuditoria[]>([])
  const [error, setError] = useState<string | null>(null)
  const [nombre, setNombre] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTocado, setSlugTocado] = useState(false)
  const [adminPara, setAdminPara] = useState<EmpresaPlataforma | null>(null)
  const [entregada, setEntregada] = useState<{ email: string; clave: string; empresa: string } | null>(null)

  const cargar = useCallback(async () => {
    try {
      const [e, a] = await Promise.all([listarEmpresas(), listarAuditoria({ limit: 50 })])
      setEmpresas(e)
      setAuditoria(a.items)
      setError(null)
    } catch (err) {
      setError(mensajeDe(err))
    }
  }, [])
  useEffect(() => {
    void cargar()
  }, [cargar])

  const porId = useMemo(() => new Map(empresas.map((e) => [e.id, e.name])), [empresas])

  const accion = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
      await cargar()
    } catch (err) {
      setError(mensajeDe(err))
    }
  }

  const crear = (e: FormEvent) => {
    e.preventDefault()
    void accion(async () => {
      await crearEmpresa({ name: nombre.trim(), slug: (slugTocado ? slug : slugDe(nombre)).trim() })
      setNombre('')
      setSlug('')
      setSlugTocado(false)
    })
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-semibold tracking-[-0.03em]">Plataforma</h1>
        <p className="mt-1 text-[14px] text-ink-2">Empresas clientes, sus administradores y la auditoría.</p>
      </div>

      {entregada && (
        <div role="alert" className="rounded-xl border border-beam/40 bg-beam/10 p-4 space-y-2">
          <p className="text-[14px]">
            Administrador de <span className="font-semibold">{entregada.empresa}</span>:{' '}
            <span className="break-all">{entregada.email}</span>. Entrégale esta clave temporal; deberá
            cambiarla al ingresar y no se volverá a mostrar.
          </p>
          <p className="num-inst text-[20px] font-semibold tracking-wider select-all">{entregada.clave}</p>
          <div className="flex gap-2">
            <Boton tamano="sm" onClick={() => void navigator.clipboard?.writeText(entregada.clave)}>
              Copiar
            </Boton>
            <Boton tamano="sm" variante="fantasma" onClick={() => setEntregada(null)}>
              Listo
            </Boton>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="text-[14px] text-sev-alta">
          {error}
        </p>
      )}

      <Panel className="p-5">
        <h2 className="text-[16px] font-semibold mb-3">Nueva empresa</h2>
        <form onSubmit={crear} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <label className="block">
            <span className="label-inst">Nombre</span>
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} required className={CLASE_CAMPO} />
          </label>
          <label className="block">
            <span className="label-inst">Código (para el login)</span>
            <input
              value={slugTocado ? slug : slugDe(nombre)}
              onChange={(e) => {
                setSlugTocado(true)
                setSlug(e.target.value.toLowerCase())
              }}
              required
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              minLength={3}
              className={CLASE_CAMPO}
            />
          </label>
          <div className="flex items-end">
            <Boton variante="primaria" disabled={!nombre.trim()}>
              Crear empresa
            </Boton>
          </div>
        </form>
      </Panel>

      {adminPara && (
        <FormAdmin
          empresa={adminPara}
          alCancelar={() => setAdminPara(null)}
          alCrear={(email, clave) => {
            setEntregada({ email, clave, empresa: adminPara.name })
            setAdminPara(null)
            void cargar()
          }}
          alError={(m) => setError(m)}
        />
      )}

      <Panel className="divide-y divide-line-soft">
        {empresas.length === 0 && !error && <p className="p-5 text-[14px] text-ink-2">Aún no hay empresas.</p>}
        {empresas.map((e) => (
          <div key={e.id} className="p-4 flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[200px]">
              <p className="text-[14px] font-medium">
                {e.name}{' '}
                {e.status === 'suspended' && <span className="text-[12px] text-failed">· suspendida</span>}
              </p>
              <p className="text-[13px] text-ink-2">
                código <span className="num-inst">{e.slug}</span> · {e.usuarios_activos} cuentas activas ·{' '}
                {e.admins === 0 ? <span className="text-sev-media">sin administrador</span> : `${e.admins} admin`}
              </p>
            </div>
            <Boton tamano="sm" onClick={() => setAdminPara(e)}>
              Crear administrador
            </Boton>
            <Boton
              tamano="sm"
              variante={e.status === 'active' ? 'peligro' : 'secundaria'}
              onClick={() =>
                void accion(() => cambiarEstadoEmpresa(e.id, e.status === 'active' ? 'suspended' : 'active'))
              }
            >
              {e.status === 'active' ? 'Suspender' : 'Reactivar'}
            </Boton>
          </div>
        ))}
      </Panel>

      <Panel className="p-5">
        <h2 className="text-[16px] font-semibold mb-3">Auditoría reciente</h2>
        {auditoria.length === 0 ? (
          <p className="text-[14px] text-ink-2">Sin eventos todavía.</p>
        ) : (
          <ul className="space-y-2">
            {auditoria.map((a) => (
              <li key={a.id} className="text-[13px] flex flex-wrap gap-x-3">
                <span className="num-inst text-ink-3">{new Date(a.occurred_at).toLocaleString('es-CL')}</span>
                <span>{ACCION_LABEL[a.action] ?? a.action}</span>
                {a.tenant_id && <span className="text-ink-2">{porId.get(a.tenant_id) ?? 'empresa'}</span>}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}

function FormAdmin({
  empresa,
  alCancelar,
  alCrear,
  alError,
}: {
  empresa: EmpresaPlataforma
  alCancelar: () => void
  alCrear: (email: string, clave: string) => void
  alError: (m: string) => void
}) {
  const [nombre, setNombre] = useState('')
  const [email, setEmail] = useState('')
  const [enviando, setEnviando] = useState(false)

  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    setEnviando(true)
    const clave = generarClaveTemporal(14)
    try {
      const u = await crearAdminEmpresa(empresa.id, {
        email: email.trim().toLowerCase(),
        full_name: nombre.trim(),
        password: clave,
      })
      alCrear(u.email, clave)
    } catch (err) {
      alError(mensajeDe(err))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Panel className="p-5">
      <h2 className="text-[16px] font-semibold mb-3">Administrador para {empresa.name}</h2>
      <form onSubmit={enviar} className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="label-inst">Nombre completo</span>
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} required className={CLASE_CAMPO} />
        </label>
        <label className="block">
          <span className="label-inst">Correo</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className={CLASE_CAMPO} />
        </label>
        <div className="flex gap-2 sm:col-span-2">
          <Boton variante="primaria" disabled={enviando || !nombre.trim() || !email.trim()}>
            {enviando ? 'Creando…' : 'Crear con clave temporal'}
          </Boton>
          <Boton type="button" variante="fantasma" onClick={alCancelar}>
            Cancelar
          </Boton>
        </div>
      </form>
    </Panel>
  )
}
