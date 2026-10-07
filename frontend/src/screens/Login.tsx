/* Login — FR-001, FR-003, FR-005, FR-006.
 *
 * Desde TSK-WS-011 la sesión es REAL: `loginInApp` autentica contra el backend
 * (Bearer, sessionStorage), obtiene la identidad del tenant vía `GET /sites` y
 * la cachea en Dexie. Los errores del servidor se muestran en el propio panel:
 * 401 credenciales, 423 cuenta bloqueada (FR-005) y 429 rate-limit — mismo
 * vocabulario que devuelve `backend/src/auth/auth.service.ts`.
 *
 * MOVIMIENTO (decisiones):
 * · Entrada escalonada de bloques, 40 ms entre ellos, translateY 8px + fade.
 *   Frecuencia: 1 vez por sesión → "raro / primera vez" → se permite delicia.
 *   CASCADA, con stagger — nunca aparecer todo de golpe.
 * · La tarjeta de cuenta demo hace pop al seleccionarse: spring corto. Se usa
 *   pocas veces por sesión, así que el rebote se siente confirmation y no
 *   latoso.
 * · El campo de contraseña NO tiene animación de foco. Es navegación por
 *   teclado puro; el foco debe ser instantáneo.
 * · El error de autenticación hace entrada, no latido: es un estado, no un
 *   proceso en curso.
 */

import { useState, type FormEvent } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Boton } from '../components/ui'
import { useEstado } from '../lib/store'
import { ApiError } from '../lib/api'
import { DEMO_CUENTAS, DEMO_PASSWORD, ROL_HINT, ROL_LABEL } from '../lib/seed'
import { EASE, STAGGER } from '../lib/motion'

export function Login() {
  const { loginInApp } = useEstado()
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')
  const [oculto, setOculto] = useState(true)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const reducir = useReducedMotion()

  const elegirCuenta = (cuenta: (typeof DEMO_CUENTAS)[number]) => {
    setEmail(cuenta.email)
    setPass(DEMO_PASSWORD)
    setError(null)
  }

  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    if (enviando || !email || pass.length < 4) return
    setEnviando(true)
    setError(null)
    try {
      await loginInApp(email.trim().toLowerCase(), pass)
    } catch (err) {
      if (err instanceof ApiError) {
        // FR-005: 423 cuenta bloqueada / 429 rate-limit comparten panel de aviso.
        if (err.status === 401) {
          setError('Correo o contraseña incorrectos. Revisá y volvé a intentar.')
        } else if (err.status === 423) {
          setError(
            'Cuenta bloqueada temporalmente por demasiados intentos (FR-005). Volvé en 15 minutos.',
          )
        } else if (err.status === 429) {
          setError('Demasiados intentos seguidos. Esperá unos minutos y volvé a intentar.')
        } else if (err.status === 0) {
          setError('Sin conexión con el servidor. Necesitás red para iniciar sesión.')
        } else {
          setError(err.detalle)
        }
      } else {
        setError('No se pudo iniciar sesión. Intentá nuevamente.')
      }
    } finally {
      setEnviando(false)
    }
  }

  const bloque = (delay: number) => ({
    initial: reducir ? { opacity: 1 } : { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.42, ease: EASE.out, delay },
  })

  return (
    <div className="min-h-dvh flex flex-col lg:flex-row">
      {/* Columna de marca: solo en desktop, evita el scroll infinito en móvil */}
      <aside className="hidden lg:flex lg:w-[46%] xl:w-[42%] relative overflow-hidden border-r border-line-soft p-12 flex-col justify-between">
        {/* Textura: rejilla de Telemetría, muy tenue. Da profundidad sin ruido. */}
        <div
          className="absolute inset-0 opacity-[0.35]"
          style={{
            backgroundImage:
              'linear-gradient(var(--color-line-soft) 1px, transparent 1px), linear-gradient(90deg, var(--color-line-soft) 1px, transparent 1px)',
            backgroundSize: '56px 56px',
            maskImage: 'radial-gradient(ellipse 90% 70% at 20% 30%, black, transparent)',
          }}
        />

        <div className="relative">
          <motion.div {...bloque(0)} className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-[10px] bg-beam grid place-items-center shrink-0">
              <span className="text-s0 font-bold text-[17px] leading-none">TC</span>
            </div>
            <div>
              <p className="text-[15px] font-semibold tracking-[-0.02em] leading-tight">
                Terreno Conectado
              </p>
              <p className="label-inst">Captura operacional</p>
            </div>
          </motion.div>
        </div>

        <div className="relative max-w-[34ch]">
          <motion.p {...bloque(0.1)} className="text-[40px] xl:text-[52px] font-bold leading-[0.98] tracking-[-0.035em]">
            Datos al día
            <br />
            <span className="text-ink-3">donde no hay señal.</span>
          </motion.p>
          <motion.p {...bloque(0.1 + STAGGER * 2)} className="mt-6 text-[15px] leading-relaxed text-ink-2">
            El trabajador captura en terreno con el modo avión activo. Cuando vuelve la señal, la
            cola sube sola y la gerencia ve el dato en menos de un minuto.
          </motion.p>
        </div>

        <motion.div {...bloque(0.28)} className="relative flex gap-8">
          {[
            ['100%', 'del flujo en terreno opera sin red'],
            ['≤ 60 s', 'de latencia de sincronización'],
            ['2', 'tenants aislados por RLS'],
          ].map(([k, v]) => (
            <div key={k}>
              <p className="num-inst text-[22px] font-semibold text-beam">{k}</p>
              <p className="label-inst mt-1 max-w-[15ch] leading-[1.45] normal-case tracking-[0.06em]">
                {v}
              </p>
            </div>
          ))}
        </motion.div>
      </aside>

      {/* Panel de acceso */}
      <main className="flex-1 flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-[400px]">
          <motion.div {...bloque(0.06)} className="lg:hidden flex items-center gap-3 mb-10">
            <div className="h-9 w-9 rounded-[10px] bg-beam grid place-items-center">
              <span className="text-s0 font-bold text-[17px] leading-none">TC</span>
            </div>
            <div>
              <p className="text-[15px] font-semibold tracking-[-0.02em] leading-tight">
                Terreno Conectado
              </p>
              <p className="label-inst">Captura operacional</p>
            </div>
          </motion.div>

          <motion.h1 {...bloque(0.06)} className="text-[24px] font-semibold tracking-[-0.03em]">
            Iniciar sesión
          </motion.h1>
          <motion.p {...bloque(0.06 + STAGGER)} className="mt-1.5 text-[13px] text-ink-2">
            Elegí una cuenta de demostración o entrá con tus credenciales del tenant.
          </motion.p>

          {/* Cuentas demo (FR-006): emails sembrados en el backend con same password */}
          <motion.div {...bloque(0.06 + STAGGER * 2)} className="mt-7 space-y-2">
            <p className="label-inst mb-2.5">Cuentas demo — password {DEMO_PASSWORD}</p>
            {DEMO_CUENTAS.map((u) => {
              const activa = email === u.email
              return (
                <motion.button
                  key={u.email}
                  type="button"
                  onClick={() => elegirCuenta(u)}
                  whileTap={reducir ? undefined : { scale: 0.985 }}
                  animate={{
                    borderColor: activa ? 'var(--color-beam)' : 'var(--color-line-soft)',
                    backgroundColor: activa ? 'var(--color-beam-glow)' : 'var(--color-s1)',
                  }}
                  transition={{ duration: 0.2, ease: EASE.out }}
                  className="w-full text-left rounded-[10px] border px-3.5 py-2.5 cursor-pointer"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[14px] font-medium truncate">{u.nombre}</p>
                      <p className="text-[12px] text-ink-3 truncate">{ROL_LABEL[u.rol]}</p>
                    </div>
                    {activa && (
                      <motion.span
                        initial={{ opacity: 0, scale: 0.7 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ type: 'spring', duration: 0.3, bounce: 0.3 }}
                        className="h-4 w-4 rounded-full bg-beam grid place-items-center shrink-0"
                      >
                        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
                          <path
                            d="M2 5.2 4 7.2 8 3"
                            stroke="var(--color-s0)"
                            strokeWidth="1.8"
                            fill="none"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </motion.span>
                    )}
                  </div>
                </motion.button>
              )
            })}
          </motion.div>

          {/* Credenciales */}
          <form onSubmit={enviar}>
            <motion.div {...bloque(0.06 + STAGGER * 3)} className="mt-5 space-y-3">
              <label className="block">
                <span className="label-inst">Correo</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="username"
                  placeholder="nombre@empresa.cl"
                  className="mt-1.5 w-full h-11 px-3 rounded-[10px] bg-s1 border border-line-soft text-[14px] placeholder:text-ink-3 focus:border-beam transition-colors duration-150"
                />
              </label>

              <label className="block">
                <span className="label-inst">Contraseña</span>
                <div className="relative mt-1.5">
                  <input
                    type={oculto ? 'password' : 'text'}
                    value={pass}
                    onChange={(e) => setPass(e.target.value)}
                    required
                    autoComplete="current-password"
                    placeholder="••••••••"
                    className="w-full h-11 px-3 pr-11 rounded-[10px] bg-s1 border border-line-soft text-[14px] placeholder:text-ink-3 focus:border-beam transition-colors duration-150"
                  />
                  <button
                    type="button"
                    onClick={() => setOculto((v) => !v)}
                    aria-label={oculto ? 'Mostrar contraseña' : 'Ocultar contraseña'}
                    className="absolute right-1 top-1 h-9 w-9 grid place-items-center rounded-lg text-ink-3 hover:text-ink hover:bg-s3 transition-colors duration-150 cursor-pointer"
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                      <path
                        d="M1.5 8s2.4-4 6.5-4 6.5 4 6.5 4-2.4 4-6.5 4S1.5 8 1.5 8Z"
                        stroke="currentColor"
                        strokeWidth="1.3"
                      />
                      <circle cx="8" cy="8" r="1.7" stroke="currentColor" strokeWidth="1.3" />
                    </svg>
                  </button>
                </div>
              </label>

              {/* FR-005/errores: entrada con fade, sin latido — es un estado. */}
              <AnimatePresence>
                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.24, ease: EASE.out }}
                    className="flex items-start gap-2 rounded-lg bg-sev-alta/10 border border-sev-alta/25 px-3 py-2"
                    role="alert"
                  >
                    <span className="mt-[3px] h-1.5 w-1.5 rounded-full bg-sev-alta shrink-0" />
                    <p className="text-[12px] leading-relaxed text-sev-alta">{error}</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>

            <motion.div {...bloque(0.06 + STAGGER * 4)} className="mt-6">
              <Boton
                variante="primaria"
                tamano="lg"
                bloqueCompleto
                disabled={enviando || !email || pass.length < 4}
              >
                {enviando ? 'Ingresando…' : 'Entrar'}
              </Boton>
            </motion.div>
          </form>

          <motion.p {...bloque(0.06 + STAGGER * 5)} className="mt-5 text-[11px] text-ink-3 leading-relaxed">
            Cada tenant se ve solo a sí mismo (NFR-05): las cuentas de{' '}
            <span className="text-ink-2">Minera El Cobre SpA</span> y{' '}
            <span className="text-ink-2">Constructora Andes SpA</span> viven en bases aisladas por
            PostgreSQL RLS.
          </motion.p>

          {email && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4, duration: 0.3 }}
              className="mt-4 text-[12px] text-ink-2 border-l-2 border-beam pl-3"
            >
              {DEMO_CUENTAS.find((c) => c.email === email)?.rol
                ? ROL_HINT[
                    DEMO_CUENTAS.find((c) => c.email === email)!.rol
                  ]
                : 'Credenciales del tenant que el backend sembró (backend/db/seed.ts).'}
            </motion.p>
          )}
        </div>
      </main>
    </div>
  )
}