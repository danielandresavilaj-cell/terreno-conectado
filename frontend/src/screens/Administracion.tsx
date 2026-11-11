/* Administración de la empresa — TSK-ADM-001 (Enmienda 003).
 *
 * El administrador de la empresa crea las cuentas de su equipo con una clave
 * temporal (el usuario la cambia al primer ingreso), las desactiva, cambia su
 * rol o les restablece la clave; y mantiene las faenas donde se captura.
 * Requiere conexión: son cambios de cuentas, no captura de terreno.
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Boton, Panel } from '../components/ui'
import { CLASE_CAMPO } from '../components/FormCambioClave'
import {
  ApiError,
  actualizarFaena,
  actualizarUsuario,
  crearFaena,
  crearUsuario,
  getSites,
  listarUsuarios,
  resetearClaveUsuario,
  type RolEmpresa,
  type UsuarioEmpresa,
} from '../lib/api'
import { generarClaveTemporal } from '../lib/clave'
import { ROL_LABEL, ROLES_DE_EMPRESA } from '../lib/roles'
import { useEstado } from '../lib/store'

type Pestaña = 'equipo' | 'faenas'

const mensajeDe = (err: unknown) =>
  err instanceof ApiError
    ? err.status === 0
      ? 'Sin conexión con el servidor. Estos cambios necesitan señal.'
      : err.detalle
    : 'Algo salió mal. Intenta nuevamente.'

export function Administracion() {
  const [pestaña, setPestaña] = useState<Pestaña>('equipo')
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-semibold tracking-[-0.03em]">Administración</h1>
        <p className="mt-1 text-[14px] text-ink-2">Cuentas de tu equipo y faenas de tu empresa.</p>
      </div>
      <div role="tablist" className="flex gap-2">
        {(['equipo', 'faenas'] as const).map((p) => (
          <Boton
            key={p}
            role="tab"
            aria-selected={pestaña === p}
            variante={pestaña === p ? 'secundaria' : 'fantasma'}
            onClick={() => setPestaña(p)}
          >
            {p === 'equipo' ? 'Equipo' : 'Faenas'}
          </Boton>
        ))}
      </div>
      {pestaña === 'equipo' ? <Equipo /> : <Faenas />}
    </div>
  )
}

/** Aviso con la clave temporal recién definida: se muestra una sola vez. */
function ClaveEntregada({ email, clave, alCerrar }: { email: string; clave: string; alCerrar: () => void }) {
  return (
    <div role="alert" className="rounded-xl border border-beam/40 bg-beam/10 p-4 space-y-2">
      <p className="text-[14px]">
        Entrega a <span className="font-semibold break-all">{email}</span> esta clave temporal. Deberá
        cambiarla en su primer ingreso; no se volverá a mostrar.
      </p>
      <p className="num-inst text-[20px] font-semibold tracking-wider select-all">{clave}</p>
      <div className="flex gap-2">
        <Boton tamano="sm" onClick={() => void navigator.clipboard?.writeText(clave)}>
          Copiar
        </Boton>
        <Boton tamano="sm" variante="fantasma" onClick={alCerrar}>
          Listo
        </Boton>
      </div>
    </div>
  )
}

function Equipo() {
  const { usuario } = useEstado()
  const [usuarios, setUsuarios] = useState<UsuarioEmpresa[]>([])
  const [error, setError] = useState<string | null>(null)
  const [entregada, setEntregada] = useState<{ email: string; clave: string } | null>(null)
  const [nombre, setNombre] = useState('')
  const [email, setEmail] = useState('')
  const [rol, setRol] = useState<RolEmpresa>('field_worker')
  const [enviando, setEnviando] = useState(false)

  const cargar = useCallback(async () => {
    try {
      setUsuarios(await listarUsuarios())
      setError(null)
    } catch (err) {
      setError(mensajeDe(err))
    }
  }, [])
  useEffect(() => {
    void cargar()
  }, [cargar])

  const crear = async (e: FormEvent) => {
    e.preventDefault()
    if (enviando) return
    setEnviando(true)
    const clave = generarClaveTemporal()
    try {
      const u = await crearUsuario({ email: email.trim().toLowerCase(), full_name: nombre.trim(), role: rol, password: clave })
      setEntregada({ email: u.email, clave })
      setNombre('')
      setEmail('')
      setRol('field_worker')
      await cargar()
    } catch (err) {
      setError(mensajeDe(err))
    } finally {
      setEnviando(false)
    }
  }

  const accion = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
      await cargar()
    } catch (err) {
      setError(mensajeDe(err))
    }
  }

  const resetear = (u: UsuarioEmpresa) =>
    accion(async () => {
      const clave = generarClaveTemporal()
      await resetearClaveUsuario(u.id, clave)
      setEntregada({ email: u.email, clave })
    })

  return (
    <div className="space-y-5">
      {entregada && <ClaveEntregada {...entregada} alCerrar={() => setEntregada(null)} />}
      {error && (
        <p role="alert" className="text-[14px] text-sev-alta">
          {error}
        </p>
      )}

      <Panel className="p-5">
        <h2 className="text-[16px] font-semibold mb-3">Nueva cuenta</h2>
        <form onSubmit={crear} className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="label-inst">Nombre completo</span>
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} required className={CLASE_CAMPO} />
          </label>
          <label className="block">
            <span className="label-inst">Correo</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="off"
              className={CLASE_CAMPO}
            />
          </label>
          <label className="block">
            <span className="label-inst">Rol</span>
            <select value={rol} onChange={(e) => setRol(e.target.value as RolEmpresa)} className={CLASE_CAMPO}>
              {ROLES_DE_EMPRESA.map((r) => (
                <option key={r} value={r}>
                  {ROL_LABEL[r]}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end">
            <Boton variante="primaria" bloqueCompleto disabled={enviando || !nombre.trim() || !email.trim()}>
              {enviando ? 'Creando…' : 'Crear con clave temporal'}
            </Boton>
          </div>
        </form>
      </Panel>

      <Panel className="divide-y divide-line-soft">
        {usuarios.length === 0 && !error && <p className="p-5 text-[14px] text-ink-2">Cargando cuentas…</p>}
        {usuarios.map((u) => {
          const yo = u.id === usuario?.id
          return (
            <div key={u.id} className="p-4 flex flex-wrap items-center gap-3">
              <div className="min-w-[200px] flex-1">
                <p className={['text-[14px] font-medium', u.is_active ? '' : 'text-ink-3 line-through'].join(' ')}>
                  {u.full_name} {yo && <span className="text-ink-3 font-normal">(tú)</span>}
                </p>
                <p className="text-[13px] text-ink-2 break-all">{u.email}</p>
                {u.must_change_password && u.is_active && (
                  <p className="text-[12px] text-sev-media">Clave temporal: aún no ingresa</p>
                )}
              </div>
              <select
                aria-label={`Rol de ${u.full_name}`}
                value={u.role}
                disabled={yo || !u.is_active}
                onChange={(e) => void accion(() => actualizarUsuario(u.id, { role: e.target.value as RolEmpresa }))}
                className="h-11 px-2 rounded-[10px] bg-s1 border border-line-soft text-[13px]"
              >
                {ROLES_DE_EMPRESA.map((r) => (
                  <option key={r} value={r}>
                    {ROL_LABEL[r]}
                  </option>
                ))}
              </select>
              {u.is_active && (
                <Boton tamano="sm" onClick={() => void resetear(u)}>
                  Restablecer clave
                </Boton>
              )}
              {!yo && (
                <Boton
                  tamano="sm"
                  variante={u.is_active ? 'peligro' : 'secundaria'}
                  onClick={() => void accion(() => actualizarUsuario(u.id, { is_active: !u.is_active }))}
                >
                  {u.is_active ? 'Desactivar' : 'Reactivar'}
                </Boton>
              )}
            </div>
          )
        })}
      </Panel>
    </div>
  )
}

interface FaenaVista {
  id: string
  nombre: string
  kind: 'mining' | 'construction'
}

const TIPO_LABEL = { mining: 'Faena minera', construction: 'Obra de construcción' } as const

function Faenas() {
  const [faenas, setFaenas] = useState<FaenaVista[]>([])
  const [error, setError] = useState<string | null>(null)
  const [nombre, setNombre] = useState('')
  const [tipo, setTipo] = useState<FaenaVista['kind']>('mining')
  const [editando, setEditando] = useState<{ id: string; nombre: string } | null>(null)

  const cargar = useCallback(async () => {
    try {
      const r = await getSites()
      setFaenas(r.items.map((s) => ({ id: s.id, nombre: s.nombre, kind: s.tipo === 'obra' ? 'construction' : 'mining' })))
      setError(null)
    } catch (err) {
      setError(mensajeDe(err))
    }
  }, [])
  useEffect(() => {
    void cargar()
  }, [cargar])

  const accion = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
      await cargar()
    } catch (err) {
      setError(mensajeDe(err))
    }
  }

  return (
    <div className="space-y-5">
      {error && (
        <p role="alert" className="text-[14px] text-sev-alta">
          {error}
        </p>
      )}
      <Panel className="p-5">
        <h2 className="text-[16px] font-semibold mb-3">Nueva faena</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void accion(async () => {
              await crearFaena({ name: nombre.trim(), kind: tipo })
              setNombre('')
            })
          }}
          className="grid gap-3 sm:grid-cols-[1fr_auto_auto]"
        >
          <label className="block">
            <span className="label-inst">Nombre</span>
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} required className={CLASE_CAMPO} />
          </label>
          <label className="block">
            <span className="label-inst">Tipo</span>
            <select value={tipo} onChange={(e) => setTipo(e.target.value as FaenaVista['kind'])} className={CLASE_CAMPO}>
              <option value="mining">{TIPO_LABEL.mining}</option>
              <option value="construction">{TIPO_LABEL.construction}</option>
            </select>
          </label>
          <div className="flex items-end">
            <Boton variante="primaria" disabled={!nombre.trim()}>
              Crear faena
            </Boton>
          </div>
        </form>
        <p className="mt-3 text-[13px] text-ink-3">
          Los trabajadores ven las faenas nuevas la próxima vez que abran la app con señal.
        </p>
      </Panel>

      <Panel className="divide-y divide-line-soft">
        {faenas.length === 0 && !error && (
          <p className="p-5 text-[14px] text-ink-2">Todavía no hay faenas. Crea la primera para poder capturar.</p>
        )}
        {faenas.map((f) =>
          editando?.id === f.id ? (
            <form
              key={f.id}
              className="p-4 flex flex-wrap items-end gap-3"
              onSubmit={(e) => {
                e.preventDefault()
                void accion(async () => {
                  await actualizarFaena(f.id, { name: editando.nombre.trim() })
                  setEditando(null)
                })
              }}
            >
              <label className="block flex-1 min-w-[200px]">
                <span className="label-inst">Nombre</span>
                <input
                  value={editando.nombre}
                  onChange={(e) => setEditando({ id: f.id, nombre: e.target.value })}
                  className={CLASE_CAMPO}
                  autoFocus
                />
              </label>
              <Boton variante="primaria" disabled={!editando.nombre.trim()}>
                Guardar
              </Boton>
              <Boton variante="fantasma" type="button" onClick={() => setEditando(null)}>
                Cancelar
              </Boton>
            </form>
          ) : (
            <div key={f.id} className="p-4 flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-[200px]">
                <p className="text-[14px] font-medium">{f.nombre}</p>
                <p className="text-[13px] text-ink-2">{TIPO_LABEL[f.kind]}</p>
              </div>
              <Boton tamano="sm" onClick={() => setEditando({ id: f.id, nombre: f.nombre })}>
                Renombrar
              </Boton>
            </div>
          ),
        )}
      </Panel>
    </div>
  )
}
