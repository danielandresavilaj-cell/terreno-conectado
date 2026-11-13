/* Alta masiva de cuentas — TSK-ADM-002 (FR-053).
 *
 * El administrador pega (o sube) una planilla con nombre, correo y rol, y la
 * app crea cada cuenta con su clave temporal usando la misma API que el alta
 * de a uno. Lógica pura: se prueba en `test/alta-masiva.test.ts`.
 */
import type { RolEmpresa } from './api'

export interface FilaAlta {
  linea: number
  nombre: string
  email: string
  rol: RolEmpresa
}

export interface ErrorAlta {
  linea: number
  motivo: string
}

const ROL_POR_TEXTO: Record<string, RolEmpresa> = {
  trabajador: 'field_worker',
  terreno: 'field_worker',
  field_worker: 'field_worker',
  supervisor: 'supervisor',
  supervision: 'supervisor',
  supervisión: 'supervisor',
  administrador: 'tenant_admin',
  admin: 'tenant_admin',
  tenant_admin: 'tenant_admin',
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Separa una línea por coma, punto y coma o tabulación (lo que pega Excel). */
function columnas(linea: string): string[] {
  const sep = linea.includes('\t') ? '\t' : linea.includes(';') ? ';' : ','
  return linea.split(sep).map((c) => c.trim().replace(/^"(.*)"$/, '$1').trim())
}

function normalizar(texto: string): string {
  return texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
}

/**
 * Lee la planilla: una cuenta por línea, `nombre, correo, rol` (el rol es
 * opcional y por omisión es trabajador). Una fila de encabezado se ignora.
 * Devuelve las filas válidas y, aparte, cada línea con su motivo de rechazo:
 * nada se crea en silencio a medias.
 */
export function leerPlanilla(
  texto: string,
  correosExistentes: readonly string[] = [],
): { filas: FilaAlta[]; errores: ErrorAlta[] } {
  const filas: FilaAlta[] = []
  const errores: ErrorAlta[] = []
  const vistos = new Set(correosExistentes.map((c) => c.toLowerCase()))
  const lineas = texto.replace(/\r\n?/g, '\n').split('\n')
  lineas.forEach((cruda, i) => {
    const linea = i + 1
    if (!cruda.trim()) return
    const [nombre = '', correo = '', rolTexto = ''] = columnas(cruda)
    if (i === 0 && !EMAIL.test(correo) && /correo|email|mail/i.test(cruda)) return
    const email = correo.toLowerCase()
    if (!nombre) return void errores.push({ linea, motivo: 'Falta el nombre.' })
    if (!EMAIL.test(email)) return void errores.push({ linea, motivo: `Correo inválido: "${correo}".` })
    const rol = rolTexto ? ROL_POR_TEXTO[normalizar(rolTexto)] : 'field_worker'
    if (!rol) {
      return void errores.push({ linea, motivo: `Rol desconocido: "${rolTexto}" (usa trabajador, supervisor o administrador).` })
    }
    if (vistos.has(email)) return void errores.push({ linea, motivo: `El correo ${email} ya existe o está repetido.` })
    vistos.add(email)
    filas.push({ linea, nombre, email, rol })
  })
  return { filas, errores }
}

/** Planilla con las claves temporales para entregar, en CSV (separador ;). */
export function csvDeClaves(cuentas: ReadonlyArray<{ nombre: string; email: string; clave: string }>): string {
  const celda = (v: string) => `"${v.replace(/"/g, '""')}"`
  return ['nombre;correo;clave temporal', ...cuentas.map((c) => [c.nombre, c.email, c.clave].map(celda).join(';'))].join('\r\n')
}
