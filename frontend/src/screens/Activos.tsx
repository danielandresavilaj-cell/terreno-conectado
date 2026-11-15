/* Activos y QR — TSK-OPS-003-C (FR-060/061), tramo 1.
 *
 * Pantalla del `tenant_admin`: registra vehículos, equipos o lugares de una
 * faena con el formulario que abren, y gestiona su QR (regenerar, revocar,
 * reactivar). El contenido del QR (`tc1:…`) se muestra una sola vez, al crear o
 * regenerar: el servidor guarda sólo su hash. Todo pasa por la API (RLS +
 * auditoría); nada optimista.
 */
import { useCallback, useEffect, useState } from 'react'
import { ASSET_KINDS, ASSET_KIND_LABEL, type AssetConQrDto, type AssetDto, type AssetKind, type SiteDto } from '@terreno/shared'
import { Chip } from '../components/Badges'
import { Boton } from '../components/ui'
import { ApiError, cambiarEstadoActivo, crearActivo, getActivos, getPlantillas, getSites, regenerarQrActivo } from '../lib/api'

const INPUT =
  'h-11 w-full px-3 rounded-[10px] bg-s0 border border-line-soft text-[14px] text-ink placeholder:text-ink-3 focus:border-beam transition-colors duration-150'

interface Formulario {
  template_id: string
  name: string
}

export function Activos() {
  const [activos, setActivos] = useState<AssetDto[]>([])
  const [faenas, setFaenas] = useState<SiteDto[]>([])
  const [formularios, setFormularios] = useState<Formulario[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [codigo, setCodigo] = useState<AssetConQrDto | null>(null)
  const [copiado, setCopiado] = useState(false)
  const [aRegenerar, setARegenerar] = useState<string | null>(null)
  const [nuevo, setNuevo] = useState<{ name: string; kind: AssetKind | ''; site_id: string; template_id: string }>({
    name: '',
    kind: '',
    site_id: '',
    template_id: '',
  })

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const [lista, sites, plantillas] = await Promise.all([getActivos(), getSites(), getPlantillas()])
      setActivos(lista.items)
      setFaenas(sites.items)
      const unicos = new Map<string, Formulario>()
      for (const p of plantillas.items) unicos.set(p.template_id, { template_id: p.template_id, name: p.name })
      setFormularios([...unicos.values()].sort((a, b) => a.name.localeCompare(b.name, 'es')))
    } catch (e) {
      setError(e instanceof ApiError ? e.detalle : 'No se pudieron cargar los activos')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const completo = nuevo.name.trim() && nuevo.kind && nuevo.site_id && nuevo.template_id

  const crear = async () => {
    if (!completo || !nuevo.kind) return
    setOcupado('nuevo')
    setError(null)
    try {
      const creado = await crearActivo({ ...nuevo, kind: nuevo.kind, name: nuevo.name.trim() })
      setCodigo(creado)
      setCopiado(false)
      setNuevo({ name: '', kind: '', site_id: nuevo.site_id, template_id: '' })
      await cargar()
    } catch (e) {
      setError(e instanceof ApiError ? e.detalle : 'No se pudo crear el activo')
    } finally {
      setOcupado(null)
    }
  }

  const regenerar = async (a: AssetDto) => {
    setOcupado(a.id)
    setError(null)
    try {
      setCodigo(await regenerarQrActivo(a.id))
      setCopiado(false)
      setARegenerar(null)
      await cargar()
    } catch (e) {
      setError(e instanceof ApiError ? e.detalle : 'No se pudo generar el nuevo QR')
    } finally {
      setOcupado(null)
    }
  }

  const cambiarEstado = async (a: AssetDto) => {
    setOcupado(a.id)
    setError(null)
    try {
      await cambiarEstadoActivo(a.id, a.status === 'active' ? 'revoked' : 'active')
      await cargar()
    } catch (e) {
      setError(e instanceof ApiError ? e.detalle : 'No se pudo cambiar el activo')
    } finally {
      setOcupado(null)
    }
  }

  const copiar = async () => {
    if (!codigo) return
    try {
      await navigator.clipboard.writeText(codigo.qr)
      setCopiado(true)
    } catch {
      setCopiado(false)
    }
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-[20px] font-semibold tracking-[-0.02em]">Activos y QR</h1>
        <p className="label-inst mt-1">
          Registra vehículos, equipos o lugares. Su QR abre el formulario correcto en el teléfono de quien lo escanea.
        </p>
      </header>

      {error && (
        <div role="alert" className="rounded-[10px] border border-sev-critica/40 bg-sev-critica/10 px-3.5 py-2.5 text-[13px] text-sev-critica">
          {error}
        </div>
      )}

      {codigo && (
        <section role="status" className="panel p-4 space-y-3 border-beam/50">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="label-inst">Código del QR · se muestra una sola vez</p>
              <h2 className="mt-1 text-[16px] font-semibold break-words">{codigo.name}</h2>
            </div>
            <Boton tamano="sm" variante="fantasma" onClick={() => setCodigo(null)}>
              Listo
            </Boton>
          </div>
          <p className="font-mono text-[15px] break-all rounded-lg bg-s0 border border-line-soft px-3 py-2.5 select-all">{codigo.qr}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Boton tamano="sm" variante="secundaria" onClick={() => void copiar()}>
              {copiado ? 'Copiado' : 'Copiar código'}
            </Boton>
            <p className="text-[13px] text-ink-2">
              Guárdalo ahora: no se vuelve a mostrar. Sirve para escribirlo a mano en el teléfono; si se pierde, genera un QR nuevo.
            </p>
          </div>
        </section>
      )}

      <section className="panel p-4 space-y-3" aria-labelledby="nuevo-activo">
        <h2 id="nuevo-activo" className="text-[15px] font-semibold">
          Nuevo activo
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1.5">
            <span className="label-inst">Nombre</span>
            <input
              className={INPUT}
              value={nuevo.name}
              maxLength={120}
              placeholder="Ej.: Camioneta CA-12"
              onChange={(e) => setNuevo((n) => ({ ...n, name: e.target.value }))}
            />
          </label>
          <label className="space-y-1.5">
            <span className="label-inst">Tipo</span>
            <select className={INPUT} value={nuevo.kind} onChange={(e) => setNuevo((n) => ({ ...n, kind: e.target.value as AssetKind }))}>
              <option value="">Elige…</option>
              {ASSET_KINDS.map((k) => (
                <option key={k} value={k}>
                  {ASSET_KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5">
            <span className="label-inst">Faena</span>
            <select className={INPUT} value={nuevo.site_id} onChange={(e) => setNuevo((n) => ({ ...n, site_id: e.target.value }))}>
              <option value="">Elige…</option>
              {faenas.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nombre}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5">
            <span className="label-inst">Formulario que abre</span>
            <select
              className={INPUT}
              value={nuevo.template_id}
              onChange={(e) => setNuevo((n) => ({ ...n, template_id: e.target.value }))}
            >
              <option value="">Elige…</option>
              {formularios.map((f) => (
                <option key={f.template_id} value={f.template_id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="text-[13px] text-ink-2">
          El QR abre el formulario sólo a quien lo tenga asignado en esa faena (Plantillas).
        </p>
        <Boton variante="primaria" disabled={!completo || ocupado !== null} onClick={() => void crear()}>
          {ocupado === 'nuevo' ? 'Creando…' : 'Crear y generar QR'}
        </Boton>
      </section>

      {cargando ? (
        <p className="label-inst">Cargando activos…</p>
      ) : activos.length === 0 ? (
        <p className="label-inst">Aún no hay activos. Crea el primero arriba.</p>
      ) : (
        <ul className="space-y-2">
          {activos.map((a) => (
            <li key={a.id} className="panel p-4 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-[15px] font-semibold break-words min-w-0">{a.name}</h3>
                <Chip>{ASSET_KIND_LABEL[a.kind]}</Chip>
                <Chip color={a.status === 'active' ? 'var(--color-synced)' : 'var(--color-failed)'}>
                  {a.status === 'active' ? 'Activo' : 'Revocado'}
                </Chip>
              </div>
              <p className="text-[13px] text-ink-2">
                {a.faena_nombre} · abre «{a.template_nombre}»
              </p>
              {aRegenerar === a.id ? (
                <div role="alert" className="rounded-xl border border-sev-media/40 bg-sev-media/10 p-3 space-y-2">
                  <p className="text-[14px]">¿Generar un QR nuevo? El código impreso actual deja de servir.</p>
                  <div className="flex flex-wrap gap-2">
                    <Boton tamano="sm" variante="peligro" disabled={ocupado !== null} onClick={() => void regenerar(a)}>
                      {ocupado === a.id ? 'Generando…' : 'Sí, generar nuevo'}
                    </Boton>
                    <Boton tamano="sm" variante="fantasma" onClick={() => setARegenerar(null)}>
                      Cancelar
                    </Boton>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Boton tamano="sm" variante="secundaria" disabled={ocupado !== null} onClick={() => setARegenerar(a.id)}>
                    Nuevo QR
                  </Boton>
                  <Boton tamano="sm" variante="fantasma" disabled={ocupado !== null} onClick={() => void cambiarEstado(a)}>
                    {ocupado === a.id ? 'Guardando…' : a.status === 'active' ? 'Revocar' : 'Reactivar'}
                  </Boton>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
