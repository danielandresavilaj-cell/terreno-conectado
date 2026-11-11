/* Formulario de cambio de contraseña — TSK-AUTH-010.
 *
 * Lo usan la pantalla obligatoria (clave temporal) y "Mi cuenta". Valida en el
 * cliente lo mismo que el backend (largo mínimo, distinta de la actual,
 * confirmación) para no gastar una ida al servidor en errores obvios.
 */
import { useState, type FormEvent } from 'react'
import { Boton } from './ui'
import { ApiError } from '../lib/api'
import { useEstado } from '../lib/store'

export const MIN_CLAVE = 10

export const CLASE_CAMPO =
  'mt-1.5 w-full h-11 px-3 rounded-[10px] bg-s1 border border-line-soft text-[14px] placeholder:text-ink-3 focus:border-beam transition-colors duration-150'

export function FormCambioClave({ alTerminar }: { alTerminar?: () => void }) {
  const { cambiarClaveEnApp } = useEstado()
  const [actual, setActual] = useState('')
  const [nueva, setNueva] = useState('')
  const [repetir, setRepetir] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [listo, setListo] = useState(false)

  const problema =
    nueva && nueva.length < MIN_CLAVE
      ? `Usa al menos ${MIN_CLAVE} caracteres.`
      : repetir && nueva !== repetir
        ? 'Las contraseñas nuevas no coinciden.'
        : nueva && nueva === actual
          ? 'La nueva contraseña debe ser distinta de la actual.'
          : null

  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    if (enviando || problema || !actual || !nueva || nueva !== repetir) return
    setEnviando(true)
    setError(null)
    try {
      await cambiarClaveEnApp(actual, nueva)
      setActual('')
      setNueva('')
      setRepetir('')
      setListo(true)
      alTerminar?.()
    } catch (err) {
      if (err instanceof ApiError && err.status === 0) {
        setError('Necesitas señal para cambiar la contraseña.')
      } else {
        setError(err instanceof ApiError ? err.detalle : 'No se pudo cambiar la contraseña.')
      }
    } finally {
      setEnviando(false)
    }
  }

  return (
    <form onSubmit={enviar} className="space-y-3">
      <label className="block">
        <span className="label-inst">Contraseña actual</span>
        <input
          type="password"
          value={actual}
          onChange={(e) => {
            setActual(e.target.value)
            setListo(false)
          }}
          autoComplete="current-password"
          required
          className={CLASE_CAMPO}
        />
      </label>
      <label className="block">
        <span className="label-inst">Nueva contraseña</span>
        <input
          type="password"
          value={nueva}
          onChange={(e) => setNueva(e.target.value)}
          autoComplete="new-password"
          minLength={MIN_CLAVE}
          required
          className={CLASE_CAMPO}
        />
      </label>
      <label className="block">
        <span className="label-inst">Repite la nueva contraseña</span>
        <input
          type="password"
          value={repetir}
          onChange={(e) => setRepetir(e.target.value)}
          autoComplete="new-password"
          required
          className={CLASE_CAMPO}
        />
      </label>

      <div aria-live="polite">
        {(problema || error) && (
          <p role="alert" className="text-[13px] text-sev-alta">
            {problema ?? error}
          </p>
        )}
        {listo && !error && <p className="text-[13px] text-synced">Contraseña actualizada.</p>}
      </div>

      <Boton
        variante="primaria"
        tamano="lg"
        bloqueCompleto
        disabled={enviando || !!problema || !actual || !nueva || nueva !== repetir}
      >
        {enviando ? 'Guardando…' : 'Cambiar contraseña'}
      </Boton>
    </form>
  )
}
