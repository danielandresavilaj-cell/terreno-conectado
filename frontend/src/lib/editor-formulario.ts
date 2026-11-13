/**
 * Operaciones del editor de formularios — TSK-FORM-022.
 *
 * El asistente (`screens/Importar.tsx`) edita una `TemplateImportProposal`,
 * venga de un archivo importado o de cero. Estas funciones son puras: reciben
 * la propuesta y devuelven una nueva, así el editor sólo hace `setPropuesta` y
 * la lógica (índices, "nunca sin secciones", resumen) se prueba sin navegador.
 * La validación de cada pregunta sigue en `FIELD_PROPS_SCHEMA` (FR-036/039).
 */
import type { ResponseType } from '@terreno/shared'
import type { ProposedItem, ProposedSection, TemplateImportProposal } from '@terreno/shared/xlsx'

/** Pregunta nueva, vacía y obligatoria. OK / No OK / N/A es el caso más común en terreno. */
export function nuevaPregunta(tipo: ResponseType = 'ok_nok_na'): ProposedItem {
  return {
    prompt: '',
    response_type: tipo,
    required: true,
    props: { required: true },
    opcionesConteo: {},
    muestra: [],
    filasConDato: 0,
  }
}

function nuevaSeccion(titulo: string): ProposedSection {
  return { titulo, items: [nuevaPregunta()] }
}

/** Mantiene `resumen` coherente con las secciones (lo muestra el asistente). */
export function recalcularResumen(p: TemplateImportProposal): TemplateImportProposal {
  return {
    ...p,
    resumen: {
      ...p.resumen,
      secciones: p.secciones.length,
      items: p.secciones.reduce((n, s) => n + s.items.length, 0),
    },
  }
}

/** Punto de partida de "Crear desde cero": una sección con una pregunta en blanco. */
export function propuestaVacia(): TemplateImportProposal {
  return recalcularResumen({
    nombre_archivo: 'Formulario nuevo',
    secciones: [nuevaSeccion('General')],
    resumen: { secciones: 0, items: 0, filasDatos: 0 },
  })
}

const conSecciones = (p: TemplateImportProposal, secciones: ProposedSection[]) =>
  recalcularResumen({ ...p, secciones })

/** Intercambia `i` con `i + dir` si existe; si no, devuelve el mismo arreglo. */
function mover<T>(xs: T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir
  if (i < 0 || i >= xs.length || j < 0 || j >= xs.length) return xs
  const copia = [...xs]
  ;[copia[i], copia[j]] = [copia[j], copia[i]]
  return copia
}

export function agregarPregunta(p: TemplateImportProposal, si: number, tipo?: ResponseType): TemplateImportProposal {
  return conSecciones(
    p,
    p.secciones.map((s, k) => (k === si ? { ...s, items: [...s.items, nuevaPregunta(tipo)] } : s)),
  )
}

export function quitarPregunta(p: TemplateImportProposal, si: number, ii: number): TemplateImportProposal {
  return conSecciones(
    p,
    p.secciones.map((s, k) => (k === si ? { ...s, items: s.items.filter((_, j) => j !== ii) } : s)),
  )
}

export function moverPregunta(p: TemplateImportProposal, si: number, ii: number, dir: -1 | 1): TemplateImportProposal {
  return conSecciones(
    p,
    p.secciones.map((s, k) => (k === si ? { ...s, items: mover(s.items, ii, dir) } : s)),
  )
}

/** Agrega "Sección N" al final, con una pregunta en blanco para empezar. */
export function agregarSeccion(p: TemplateImportProposal): TemplateImportProposal {
  const usados = new Set(p.secciones.map((s) => s.titulo.trim().toLowerCase()))
  let n = p.secciones.length + 1
  while (usados.has(`sección ${n}`)) n++
  return conSecciones(p, [...p.secciones, nuevaSeccion(`Sección ${n}`)])
}

export function renombrarSeccion(p: TemplateImportProposal, si: number, titulo: string): TemplateImportProposal {
  return conSecciones(
    p,
    p.secciones.map((s, k) => (k === si ? { ...s, titulo } : s)),
  )
}

/** Quita una sección; nunca deja el formulario sin secciones. */
export function quitarSeccion(p: TemplateImportProposal, si: number): TemplateImportProposal {
  if (p.secciones.length <= 1) return p
  return conSecciones(
    p,
    p.secciones.filter((_, k) => k !== si),
  )
}

export function moverSeccion(p: TemplateImportProposal, si: number, dir: -1 | 1): TemplateImportProposal {
  return conSecciones(p, mover(p.secciones, si, dir))
}
