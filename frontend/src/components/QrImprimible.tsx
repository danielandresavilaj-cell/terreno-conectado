/* Etiqueta del QR para imprimir — TSK-OPS-003-C, tramo 3 (FR-060).
 *
 * Dibuja la matriz como SVG (un `path` por fila de módulos, sin `innerHTML`),
 * con el nombre del activo y el código en texto para la entrada manual si el
 * QR se daña. Al imprimir, sólo se ve esta etiqueta (`.zona-impresion`).
 */
import { useMemo } from 'react'
import { matrizQr } from '../lib/qr-imagen'

const MARGEN = 4

export function QrImprimible({ texto, titulo, detalle }: { texto: string; titulo: string; detalle: string }) {
  const { lado, trazo } = useMemo(() => {
    const m = matrizQr(texto)
    const partes: string[] = []
    m.forEach((fila, f) =>
      fila.forEach((oscuro, c) => {
        if (oscuro) partes.push(`M${c + MARGEN} ${f + MARGEN}h1v1h-1z`)
      }),
    )
    return { lado: m.length + MARGEN * 2, trazo: partes.join('') }
  }, [texto])

  return (
    <figure className="zona-impresion mx-auto w-full max-w-[280px] rounded-xl bg-white p-4 text-center text-black">
      <svg
        viewBox={`0 0 ${lado} ${lado}`}
        role="img"
        aria-label={`Código QR de ${titulo}`}
        className="mx-auto block h-auto w-full"
        shapeRendering="crispEdges"
      >
        <rect width={lado} height={lado} fill="#fff" />
        <path d={trazo} fill="#000" />
      </svg>
      <figcaption className="mt-2 space-y-0.5">
        <p className="text-[15px] font-semibold leading-tight">{titulo}</p>
        <p className="text-[12px] leading-tight">{detalle}</p>
        <p className="font-mono text-[11px] break-all leading-tight">{texto}</p>
      </figcaption>
    </figure>
  )
}
