/* Tendencia semanal — TSK-REP-012 (FR-040).
 *
 * Ocho semanas de inspecciones y hallazgos, de la más antigua a la actual. Es
 * para ver si algo sube o baja de un vistazo: barras simples y los números al
 * lado, sin librería de gráficos (Art. V). La semana en curso va marcada.
 */
import { Barra } from '../CountUp'

const FECHA = new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'short' })

function etiquetaSemana(lunes: string): string {
  const [y, m, d] = lunes.split('-').map(Number)
  return FECHA.format(new Date(y, m - 1, d))
}

export function TendenciaSemanal({
  semanas,
}: {
  semanas: Array<{ semana: string; inspecciones: number; hallazgos: number }>
}) {
  const max = Math.max(1, ...semanas.map((s) => s.inspecciones))
  const actual = semanas[semanas.length - 1]?.semana
  return (
    <section className="panel p-4" aria-labelledby="titulo-tendencia">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <h2 id="titulo-tendencia" className="text-[14px] font-semibold tracking-[-0.015em]">
          Últimas 8 semanas
        </h2>
        <p className="text-[13px] text-ink-2">Inspecciones y hallazgos por semana</p>
      </div>
      <ol className="space-y-2">
        {semanas.map((s, i) => (
          <li key={s.semana} className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-3">
            <span className={['text-[13px]', s.semana === actual ? 'font-semibold text-ink' : 'text-ink-2'].join(' ')}>
              {s.semana === actual ? 'Esta' : etiquetaSemana(s.semana)}
            </span>
            <Barra pct={(s.inspecciones / max) * 100} color="var(--color-beam)" retardo={0.05 + i * 0.03} />
            <span className="num-inst text-[13px] text-ink-2 whitespace-nowrap">
              {s.inspecciones} insp. · {s.hallazgos} hall.
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}
