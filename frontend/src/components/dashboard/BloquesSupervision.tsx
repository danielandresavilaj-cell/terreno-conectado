/* Dashboard de supervisión v1.1 — TSK-REP-006.
 *
 * Cuatro bloques, cada uno con un titular accionable: hallazgos, pendientes de
 * revisión, actividad y salud de la sincronización. Los números vienen ya
 * calculados del servidor; aquí sólo se muestran.
 */
import type { ReactNode } from 'react'
import type { DashboardSupervision, SyncSeverity } from '@terreno/shared'
import { BadgeSev } from '../Badges'
import { Barra } from '../CountUp'
import type { Severidad } from '../../lib/types'
import {
  SIN_DATOS,
  duracion,
  porcentaje,
  titularActividad,
  titularHallazgos,
  titularRevision,
  titularSincronizacion,
} from '../../lib/supervision'

const SEV: Record<SyncSeverity, Severidad> = { low: 'baja', medium: 'media', high: 'alta', critical: 'critica' }

function Bloque({ etiqueta, titular, alerta, children }: { etiqueta: string; titular: string; alerta?: boolean; children: ReactNode }) {
  return (
    <section className={['panel p-5 space-y-4', alerta ? 'border-sev-alta/35' : ''].join(' ')}>
      <div>
        <p className="label-inst">{etiqueta}</p>
        <h2 className={['mt-1 text-[16px] font-semibold tracking-[-0.02em]', alerta ? 'text-sev-alta' : ''].join(' ')}>
          {titular}
        </h2>
      </div>
      {children}
    </section>
  )
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div>
      <p className="text-[11px] text-ink-3">{etiqueta}</p>
      <p className="font-mono text-[15px] tabular-nums">{valor}</p>
    </div>
  )
}

const Vacio = ({ texto = SIN_DATOS }: { texto?: string }) => <p className="text-[13px] text-ink-3">{texto}</p>

export function BloquesSupervision({ datos, onRevisar }: { datos: DashboardSupervision; onRevisar: (id: string) => void }) {
  const { hallazgos: h, revision: r, actividad: a, sincronizacion: s } = datos
  const ab = h.abiertos_por_antiguedad
  const maxDia = Math.max(1, ...a.por_dia.map((d) => d.inspecciones))
  const maxFaena = Math.max(1, ...a.por_faena.map((f) => f.inspecciones))
  const errorPct = porcentaje(s.lotes_con_error, s.lotes)

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Bloque etiqueta="Hallazgos" titular={titularHallazgos(h)} alerta={h.criticos_abiertos.length > 0}>
        <div className="grid grid-cols-3 gap-3">
          <Dato etiqueta="Abiertos < 1 día" valor={String(ab.hasta_1d)} />
          <Dato etiqueta="1 a 7 días" valor={String(ab.de_1_a_7d)} />
          <Dato etiqueta="Más de 7 días" valor={String(ab.mas_de_7d)} />
        </div>
        {h.criticos_abiertos.length > 0 && (
          <ul className="space-y-1.5">
            {h.criticos_abiertos.map((c) => (
              <li key={c.id} className="flex items-center gap-2 text-[13px]">
                <BadgeSev sev={SEV[c.severidad]} />
                <span className="truncate flex-1">{c.descripcion}</span>
                <span className="text-ink-3 whitespace-nowrap">{c.faena_nombre ?? '—'} · {c.dias_abierto} d</span>
              </li>
            ))}
          </ul>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Dato
            etiqueta={`Cierre medio (${h.resueltos_periodo} resueltos)`}
            valor={h.cierre_horas_media === null ? '—' : duracion(h.cierre_horas_media * 3600)}
          />
          <Dato etiqueta="Cierre mediano" valor={h.cierre_horas_p50 === null ? '—' : duracion(h.cierre_horas_p50 * 3600)} />
        </div>
        <div>
          <p className="text-[12px] text-ink-2 mb-2">Ítems con más "No OK"</p>
          {h.top_nok.length === 0 ? (
            <Vacio texto="Ningún ítem marcado No OK en el período" />
          ) : (
            <ul className="space-y-2">
              {h.top_nok.map((i) => (
                <li key={i.template_item_id} className="space-y-1">
                  <div className="flex justify-between gap-3 text-[13px]">
                    <span className="truncate">{i.prompt}</span>
                    <span className="font-mono text-ink-3 whitespace-nowrap">{i.nok}/{i.respondidas}</span>
                  </div>
                  <Barra pct={(i.nok / Math.max(1, i.respondidas)) * 100} color="var(--color-sev-alta)" />
                </li>
              ))}
            </ul>
          )}
        </div>
      </Bloque>

      <Bloque etiqueta="Pendientes de revisión" titular={titularRevision(r)} alerta={(r.dias_mas_antigua ?? 0) >= 7}>
        <div className="grid grid-cols-3 gap-3">
          <Dato etiqueta="Pendientes" valor={String(r.pendientes)} />
          <Dato etiqueta="Más antigua" valor={r.dias_mas_antigua === null ? '—' : `${Math.floor(r.dias_mas_antigua)} d`} />
          <Dato etiqueta="Mediana" valor={r.dias_mediana === null ? '—' : `${r.dias_mediana.toFixed(1).replace('.', ',')} d`} />
        </div>
        {r.mas_antiguas.length === 0 ? (
          <Vacio texto="No hay inspecciones esperando revisión" />
        ) : (
          <ul className="space-y-1">
            {r.mas_antiguas.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onRevisar(p.id)}
                  className="w-full flex items-center gap-3 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-s1 transition-colors"
                >
                  <span className="truncate flex-1">
                    {p.plantilla ?? 'Inspección'} · {p.faena_nombre}
                    <span className="text-ink-3"> · {p.ejecutado_por}</span>
                  </span>
                  <span className="font-mono text-ink-3 whitespace-nowrap">{p.dias_esperando} d</span>
                  <span className="text-beam whitespace-nowrap">Revisar</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Bloque>

      <Bloque etiqueta="Actividad" titular={titularActividad(a)}>
        {a.por_dia.length === 0 ? (
          <Vacio />
        ) : (
          <div className="flex items-end gap-1 h-24" role="img" aria-label="Inspecciones por día">
            {a.por_dia.map((d) => (
              <div key={d.dia} className="flex-1 flex flex-col items-center justify-end h-full" title={`${d.dia}: ${d.inspecciones}`}>
                <div
                  className="w-full rounded-t-[3px] bg-beam/70 min-h-[2px]"
                  style={{ height: `${(d.inspecciones / maxDia) * 100}%` }}
                />
              </div>
            ))}
          </div>
        )}
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <p className="text-[12px] text-ink-2 mb-2">Por faena</p>
            {a.por_faena.length === 0 ? (
              <Vacio />
            ) : (
              <ul className="space-y-2">
                {a.por_faena.map((f) => (
                  <li key={f.faena_id} className="space-y-1">
                    <div className="flex justify-between gap-3 text-[13px]">
                      <span className={['truncate', f.inspecciones === 0 ? 'text-sev-alta' : ''].join(' ')}>{f.faena_nombre}</span>
                      <span className="font-mono text-ink-3">{f.inspecciones}</span>
                    </div>
                    <Barra pct={(f.inspecciones / maxFaena) * 100} color="var(--color-beam)" />
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="text-[12px] text-ink-2 mb-2">Por trabajador</p>
            {a.por_trabajador.length === 0 ? (
              <Vacio />
            ) : (
              <ul className="space-y-1 text-[13px]">
                {a.por_trabajador.map((t) => (
                  <li key={t.usuario} className="flex justify-between gap-3">
                    <span className="truncate">{t.usuario}</span>
                    <span className="font-mono text-ink-3">{t.inspecciones}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Bloque>

      <Bloque
        etiqueta="Sincronización"
        titular={titularSincronizacion(s)}
        alerta={s.equipos_inactivos.length > 0 || s.lotes_con_error > 0}
      >
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Dato etiqueta="Espera sin señal p50" valor={s.muestras_espera ? duracion(s.espera_sin_senal_p50_seg) : '—'} />
          <Dato etiqueta="Espera sin señal p95" valor={s.muestras_espera ? duracion(s.espera_sin_senal_p95_seg) : '—'} />
          <Dato etiqueta="Procesamiento p95" valor={duracion(s.procesamiento_p95_seg)} />
          <Dato etiqueta={`Lotes con error (${s.lotes})`} valor={errorPct === null ? '—' : `${String(errorPct).replace('.', ',')} %`} />
        </div>
        <p className="text-[12px] text-ink-3 leading-relaxed">
          La espera sin señal es el tiempo que los datos quedaron en el equipo antes de enviarse
          {s.muestras_espera ? ` (${s.muestras_espera} inspecciones medidas)` : ': aún no hay inspecciones con esta medición'}. El
          procesamiento es lo que tarda el servidor en recibir un lote (objetivo: 60 s).
        </p>
        <div>
          <p className="text-[12px] text-ink-2 mb-2">
            Equipos sin sincronizar hace más de 24 h ({s.equipos_activos_30d} activos en 30 días)
          </p>
          {s.equipos_inactivos.length === 0 ? (
            <Vacio texto="Ninguno" />
          ) : (
            <ul className="space-y-1 text-[13px]">
              {s.equipos_inactivos.map((e) => (
                <li key={e.device_id} className="flex justify-between gap-3">
                  <span className="truncate">{e.usuario ?? 'Usuario desconocido'}</span>
                  <span className="font-mono text-ink-3">{duracion(e.horas_sin_sync * 3600)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Bloque>
    </div>
  )
}
