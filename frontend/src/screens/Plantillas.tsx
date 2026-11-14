/* Asignación de plantillas publicadas por faena y rol — TSK-FORM-008 (FR-008/009).
 *
 * Pantalla de configuración para `tenant_admin`, con estado LOCAL (`useState`):
 * lista las revisiones publicadas del tenant y, para cada una, la matriz
 * faena × rol con la que el worker las ve en su captura.
 *
 * El filtro y la búsqueda son de CLIENTE sobre la lista ya traída (FR-009): el
 * catálogo de plantillas de un tenant es pequeño y cabe en memoria; filtrar en
 * el dispositivo evita un round-trip por cada tecla.
 *
 * La última palabra la tiene el servidor: cada alternar es un
 * `POST /templates/assignments` (idempotente por revisión+faena+rol) o un
 * `DELETE /templates/assignments/:id`. La UI refleja lo que respondió la API,
 * nunca un estado optimista que el RLS pueda rechazar.
 *
 * MOVIMIENTO: sólo crossfade corto entre estados (cargando/error/vacío) con
 * `EASE.out`. Es una pantalla de configuración densa; el movimiento compite con
 * la lectura de la tabla.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Chip } from '../components/Badges'
import { Boton } from '../components/ui'
import { VistaPreviaFormulario } from '../components/VistaPreviaFormulario'
import {
  ApiError,
  cambiarEstadoPlantilla,
  crearAsignacion,
  crearPlantilla,
  eliminarAsignacion,
  getAsignaciones,
  getPlantillas,
  getPlantillasArchivadas,
  getSites,
  publicarRevision,
} from '../lib/api'
import { duplicarDefinicion, nombreDeCopia } from '../lib/duplicar-formulario'
import { EASE } from '../lib/motion'
import { useEstado } from '../lib/store'
import type { SiteDto } from '@terreno/shared'
import type {
  TemplateAssignmentDto,
  TemplateAssignmentRole,
  TemplatePublicadaDto,
} from '@terreno/shared'

const ROLES: Array<{ id: TemplateAssignmentRole; label: string }> = [
  { id: 'field_worker', label: 'Trabajador' },
  { id: 'supervisor', label: 'Supervisor' },
]

const INPUT =
  'h-10 w-full px-3 rounded-[10px] bg-s0 border border-line-soft text-[14px] text-ink placeholder:text-ink-3 focus:border-beam transition-colors duration-150'

/** Clave lógica de una asignación: la misma que impone el índice único. */
function clave(revisionId: string, siteId: string | null, role: TemplateAssignmentRole): string {
  return `${revisionId}|${siteId ?? '*'}|${role}`
}

export function Plantillas() {
  const { ir } = useEstado()
  const [plantillas, setPlantillas] = useState<TemplatePublicadaDto[]>([])
  const [asignaciones, setAsignaciones] = useState<TemplateAssignmentDto[]>([])
  const [faenas, setFaenas] = useState<SiteDto[]>([])
  const [busqueda, setBusqueda] = useState('')
  const [rolFiltro, setRolFiltro] = useState<TemplateAssignmentRole | 'todos'>('todos')
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pendiente, setPendiente] = useState<string | null>(null)
  /* TSK-FORM-023: formulario abierto en vista previa. */
  const [previa, setPrevia] = useState<TemplatePublicadaDto | null>(null)
  /* TSK-FORM-024 (FR-066): archivo y duplicado. */
  const [archivadas, setArchivadas] = useState<Array<{ template_id: string; name: string; archivada_at: string }>>([])
  const [aArchivar, setAArchivar] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const [pub, asignacionesResp, sites, arch] = await Promise.all([
        getPlantillas(),
        getAsignaciones(),
        getSites(),
        getPlantillasArchivadas(),
      ])
      setPlantillas(pub.items)
      setArchivadas(arch.items)
      setAsignaciones(asignacionesResp.items)
      setFaenas(sites.items)
    } catch (e) {
      setError(e instanceof ApiError ? e.detalle : 'No se pudieron cargar las plantillas')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  /* Alterna una asignación. El servidor es la fuente de verdad: se espera la
   * respuesta antes de tocar el estado local (nada de optimista). */
  const alternar = useCallback(
    async (revisionId: string, siteId: string | null, role: TemplateAssignmentRole) => {
      const k = clave(revisionId, siteId, role)
      const existente = asignaciones.find((a) => clave(a.template_revision_id, a.site_id, a.role) === k)
      setPendiente(k)
      setError(null)
      try {
        if (existente) {
          await eliminarAsignacion(existente.id)
          setAsignaciones((prev) => prev.filter((a) => a.id !== existente.id))
        } else {
          const creada = await crearAsignacion({ revision_id: revisionId, site_id: siteId, role })
          setAsignaciones((prev) => [...prev, creada])
        }
      } catch (e) {
        setError(e instanceof ApiError ? e.detalle : 'No se pudo actualizar la asignación')
      } finally {
        setPendiente(null)
      }
    },
    [asignaciones],
  )

  /* TSK-FORM-024: archivar/restaurar y duplicar. Tras cada acción se recarga
   * todo desde el servidor (nada optimista). */
  const cambiarEstado = useCallback(
    async (templateId: string, status: 'archived' | 'active') => {
      setOcupado(templateId)
      setError(null)
      try {
        await cambiarEstadoPlantilla(templateId, status)
        setAArchivar(null)
        await cargar()
      } catch (e) {
        setError(e instanceof ApiError ? e.detalle : 'No se pudo cambiar el formulario')
      } finally {
        setOcupado(null)
      }
    },
    [cargar],
  )

  const duplicar = useCallback(
    async (p: TemplatePublicadaDto) => {
      setOcupado(p.template_id)
      setError(null)
      try {
        const nombre = nombreDeCopia(p.name, [...plantillas.map((x) => x.name), ...archivadas.map((x) => x.name)])
        const borrador = await crearPlantilla({ name: nombre, definition: duplicarDefinicion(p.definition) })
        await publicarRevision(borrador.id)
        await cargar()
      } catch (e) {
        setError(e instanceof ApiError ? e.detalle : 'No se pudo duplicar el formulario')
      } finally {
        setOcupado(null)
      }
    },
    [plantillas, archivadas, cargar],
  )

  /* Búsqueda + filtros de cliente sobre el catálogo ya traído. */
  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return plantillas.filter((p) => {
      if (q && !p.name.toLowerCase().includes(q)) return false
      if (rolFiltro !== 'todos') {
        const tiene = asignaciones.some(
          (a) => a.template_revision_id === p.revision_id && a.role === rolFiltro,
        )
        if (!tiene) return false
      }
      return true
    })
  }, [plantillas, asignaciones, busqueda, rolFiltro])

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-semibold tracking-[-0.02em]">Plantillas</h1>
          <p className="label-inst mt-1">
            Asigna cada plantilla publicada a las faenas y roles que deben verla en su captura.
          </p>
        </div>
        {/* TSK-FORM-022: crear desde cero; importar sigue en su pestaña. */}
        <div className="flex flex-wrap gap-2">
          <Boton tamano="sm" variante="secundaria" onClick={() => ir('importar')}>
            Importar archivo
          </Boton>
          <Boton tamano="sm" variante="primaria" onClick={() => ir('crear-formulario')}>
            Crear formulario
          </Boton>
        </div>
      </header>

      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar plantilla…"
          aria-label="Buscar plantilla"
          className={INPUT}
        />
        <div className="flex gap-1.5">
          {[{ id: 'todos' as const, label: 'Todas' }, ...ROLES].map((r) => (
            <button key={r.id} onClick={() => setRolFiltro(r.id)} aria-pressed={rolFiltro === r.id}>
              <Chip color={rolFiltro === r.id ? 'var(--color-beam)' : undefined}>{r.label}</Chip>
            </button>
          ))}
        </div>
      </div>

      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15, ease: EASE.out }}
            className="rounded-[10px] border border-sev-critica/40 bg-sev-critica/10 px-3.5 py-2.5 text-[13px] text-sev-critica"
          >
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      {cargando ? (
        <p className="label-inst">Cargando plantillas…</p>
      ) : visibles.length === 0 ? (
        <p className="label-inst">
          Sin plantillas publicadas que coincidan. Crea un formulario o impórtalo desde un archivo, publícalo y podrás asignarlo aquí.
        </p>
      ) : (
        <div className="space-y-3">
          {visibles.map((p) => (
            <article key={p.revision_id} className="panel p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-[15px] font-semibold tracking-[-0.01em] min-w-0 break-words">{p.name}</h2>
                <div className="flex items-center gap-2 shrink-0">
                  <Chip>v{p.version}</Chip>
                  <Boton tamano="sm" variante="fantasma" onClick={() => setPrevia(p)}>
                    Vista previa
                  </Boton>
                  <Boton tamano="sm" variante="fantasma" disabled={ocupado !== null} onClick={() => void duplicar(p)}>
                    {ocupado === p.template_id && aArchivar !== p.template_id ? 'Duplicando…' : 'Duplicar'}
                  </Boton>
                  <Boton tamano="sm" variante="fantasma" disabled={ocupado !== null} onClick={() => setAArchivar(p.template_id)}>
                    Archivar
                  </Boton>
                </div>
              </div>
              {aArchivar === p.template_id && (
                <div role="alert" className="rounded-xl border border-sev-media/40 bg-sev-media/10 p-3 space-y-2">
                  <p className="text-[14px]">
                    ¿Archivar «{p.name}»? Deja de llegar a los teléfonos y de aparecer aquí. Sus inspecciones y asignaciones
                    se conservan y puedes restaurarlo cuando quieras.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Boton tamano="sm" variante="peligro" disabled={ocupado !== null} onClick={() => void cambiarEstado(p.template_id, 'archived')}>
                      {ocupado === p.template_id ? 'Archivando…' : 'Sí, archivar'}
                    </Boton>
                    <Boton tamano="sm" variante="fantasma" onClick={() => setAArchivar(null)}>
                      Cancelar
                    </Boton>
                  </div>
                </div>
              )}
              {ROLES.map((rol) => {
                const targets: Array<{ siteId: string | null; label: string }> = [
                  { siteId: null, label: 'Todas' },
                  ...faenas.map((f) => ({ siteId: f.id, label: f.nombre })),
                ]
                return (
                  <div key={rol.id} className="flex flex-wrap items-center gap-1.5">
                    <span className="label-inst w-24 shrink-0">{rol.label}</span>
                    {targets.map((t) => {
                      const k = clave(p.revision_id, t.siteId, rol.id)
                      const asignada = asignaciones.some(
                        (a) => clave(a.template_revision_id, a.site_id, a.role) === k,
                      )
                      const ocupada = pendiente === k
                      return (
                        <Boton
                          key={k}
                          tamano="sm"
                          variante={asignada ? 'primaria' : 'secundaria'}
                          disabled={ocupada}
                          onClick={() => void alternar(p.revision_id, t.siteId, rol.id)}
                          aria-pressed={asignada}
                        >
                          {asignada ? '✓ ' : '+ '}
                          {t.label}
                        </Boton>
                      )
                    })}
                  </div>
                )
              })}
              <p className="label-inst">
                {asignaciones.filter((a) => a.template_revision_id === p.revision_id).length} asignación(es)
                {faenas.length > 0 ? ` · ${faenas.length} faena(s)` : ''}
              </p>
            </article>
          ))}
        </div>
      )}

      {/* TSK-FORM-024: formularios archivados, para restaurarlos. */}
      {archivadas.length > 0 && (
        <details className="group">
          <summary className="flex min-h-11 items-center gap-3 px-0.5 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
            <h2 className="label-inst">Archivados ({archivadas.length})</h2>
            <div className="flex-1 rule" />
            <span className="label-inst group-open:rotate-180 transition-transform duration-150">▾</span>
          </summary>
          <ul className="mt-2 space-y-2">
            {archivadas.map((a) => (
              <li key={a.template_id} className="panel px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[14px] font-medium break-words">{a.name}</p>
                  <p className="text-[13px] text-ink-2">
                    Archivado el {new Date(a.archivada_at).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </p>
                </div>
                <Boton tamano="sm" variante="secundaria" disabled={ocupado !== null} onClick={() => void cambiarEstado(a.template_id, 'active')}>
                  {ocupado === a.template_id ? 'Restaurando…' : 'Restaurar'}
                </Boton>
              </li>
            ))}
          </ul>
        </details>
      )}

      {previa && (
        <VistaPreviaFormulario
          nombre={previa.name}
          version={previa.version}
          definition={previa.definition}
          alCerrar={() => setPrevia(null)}
        />
      )}

      {!cargando && visibles.length > 0 && (
        <p className="label-inst">
          Filtrado en el dispositivo sobre {plantillas.length} plantilla(s) publicada(s).
        </p>
      )}
    </div>
  )
}