import type { TemplatePublicadaDto } from '@terreno/shared'
import { getPlantillas, getToken } from './api'
import { db, guardarPlantillasCache, plantillasCacheadas } from './db'
import type { Usuario } from './types'

type Ambito = Pick<Usuario, 'tenantId' | 'id' | 'rol' | 'faenaId'>

function clave(ambito: Ambito): string {
  return `tc_catalogo_asignado:${JSON.stringify([ambito.tenantId, ambito.id, ambito.rol, ambito.faenaId])}`
}

/** El caché legado por tenant no acredita asignaciones de la sesión actual. */
export async function leerCatalogo(ambito: Ambito): Promise<TemplatePublicadaDto[]> {
  const row = await db.meta.get(clave(ambito))
  if (typeof row?.value !== 'string') return []
  const ids = new Set<string>(JSON.parse(row.value) as string[])
  return (await plantillasCacheadas()).filter(
    (item) => item.tenant_id === ambito.tenantId && ids.has(item.revision_id),
  )
}

export async function actualizarCatalogo(ambito: Ambito) {
  const anteriores = await leerCatalogo(ambito)
  if (!getToken()) return { items: anteriores, enRed: false }
  try {
    // Una asignación puede cambiar sin publicar otra revisión. El cursor de
    // publicaciones no detecta altas/bajas: reconciliar el catálogo completo.
    const { items } = await getPlantillas(undefined, ambito.faenaId || null)
    const visibles = items.filter((item) => item.tenant_id === ambito.tenantId)
    await db.transaction('rw', db.plantillas, db.meta, async () => {
      await guardarPlantillasCache(visibles)
      await db.meta.put({
        key: clave(ambito),
        value: JSON.stringify(visibles.map((item) => item.revision_id)),
      })
    })
    return { items: visibles, enRed: true }
  } catch {
    // Fallar sin red conserva exclusivamente el último catálogo de este ámbito.
    return { items: anteriores, enRed: false }
  }
}
