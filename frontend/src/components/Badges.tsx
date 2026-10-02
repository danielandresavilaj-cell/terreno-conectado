import type { ReactNode } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import type { Severidad, SyncEstado } from '../lib/types'

/* Badges de estado de sincronización (FR-013) y severidad (FR-032).
 *
 * MOVIMIENTO — purposefully Quiet:
 * El badge cambia de estado muchas veces por sesión (cada registro recorre
 * pending → syncing → synced). Animarlo con entrada elaborada lo haría parpadear
 * y distraer. Solo el estado `syncing` late — porque "hay trabajo en curso" es
 * información, no decoración — y lo hace con opacidad, no con escala grande.
 * El resto es un cambio de color de 200 ms: suficiente para que el ojo lo registre.
 */

export const SYNC_META: Record<
  SyncEstado,
  { label: string; color: string; dot: string; desc: string }
> = {
  pending: {
    label: 'Pendiente',
    color: 'var(--color-pending)',
    dot: 'bg-pending',
    desc: 'En cola local, esperando señal',
  },
  syncing: {
    label: 'Sincronizando',
    color: 'var(--color-syncing)',
    dot: 'bg-syncing',
    desc: 'Subiendo por lotes',
  },
  synced: {
    label: 'Sincronizado',
    color: 'var(--color-synced)',
    dot: 'bg-synced',
    desc: 'Confirmado por el servidor',
  },
  failed: {
    label: 'Falló',
    color: 'var(--color-failed)',
    dot: 'bg-failed',
    desc: 'Reintento con backoff exponencial',
  },
}

export function BadgeSync({ estado, compacto }: { estado: SyncEstado; compacto?: boolean }) {
  const reducir = useReducedMotion()
  const m = SYNC_META[estado]

  return (
    <motion.span
      animate={{ color: m.color, backgroundColor: `color-mix(in oklab, ${m.color} 14%, transparent)` }}
      transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
      className={[
        'inline-flex items-center gap-1.5 rounded-full font-mono uppercase tracking-[0.1em] whitespace-nowrap',
        compacto ? 'px-1.5 py-0.5 text-[9px]' : 'px-2 py-1 text-[10px]',
      ].join(' ')}
    >
      <span className="relative inline-flex h-1.5 w-1.5 shrink-0">
        {estado === 'syncing' && !reducir && (
          <span className={['absolute inset-0 rounded-full throb', m.dot].join(' ')} />
        )}
        <span className={['relative h-1.5 w-1.5 rounded-full', m.dot].join(' ')} />
      </span>
      {m.label}
    </motion.span>
  )
}

export const SEV_META: Record<Severidad, { label: string; color: string; bg: string; peso: number }> = {
  baja: { label: 'Baja', color: 'var(--color-sev-baja)', bg: 'color-mix(in oklab, var(--color-sev-baja) 13%, transparent)', peso: 1 },
  media: { label: 'Media', color: 'var(--color-sev-media)', bg: 'color-mix(in oklab, var(--color-sev-media) 14%, transparent)', peso: 2 },
  alta: { label: 'Alta', color: 'var(--color-sev-alta)', bg: 'color-mix(in oklab, var(--color-sev-alta) 16%, transparent)', peso: 3 },
  critica: { label: 'Crítica', color: 'var(--color-sev-critica)', bg: 'color-mix(in oklab, var(--color-sev-critica) 17%, transparent)', peso: 4 },
}

/* Badge de severidad.
 * Sin animación de entrada: los hallazgos se listan y se reordenan por severidad.
 * Un pop aquí sería ruido sobre la fila que el usuario está por leer. El peso
 * tipográfico y el color cargan la jerarquía. `destacado` (FR-035) añade una
 * demarcación de borde, no movimiento — en un dashboard que se mira fijamente,
 * el movimiento no añade información. */
export function BadgeSev({
  sev,
  destacado,
}: {
  sev: Severidad
  destacado?: boolean
}) {
  const m = SEV_META[sev]
  return (
    <span
      className={[
        'inline-flex items-center gap-1.5 rounded-md font-mono uppercase tracking-[0.1em]',
        'px-2 py-1 text-[10px] font-semibold whitespace-nowrap',
        destacado ? 'ring-1 ring-current' : '',
      ].join(' ')}
      style={{ color: m.color, backgroundColor: m.bg }}
    >
      <span
        className="inline-block rounded-[2px]"
        style={{ width: 3, height: 10, background: m.color, opacity: 0.5 + m.peso * 0.12 }}
      />
      {m.label}
    </span>
  )
}

export function Chip({
  children,
  color,
  icono,
}: {
  children: ReactNode
  color?: string
  icono?: ReactNode
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-s3 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-2">
      {icono}
      <span style={color ? { color } : undefined}>{children}</span>
    </span>
  )
}
