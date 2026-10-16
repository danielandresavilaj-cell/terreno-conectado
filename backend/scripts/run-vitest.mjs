import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const env = { ...process.env }

// En Windows, el runtime puede materializar el binding nativo de SWC en una
// caché de AppData con ACL insegura. El binding rechaza ese directorio antes de
// que Vitest cargue la configuración. Una caché bajo el checkout es privada a
// la sesión de desarrollo y se ignora por Git.
if (process.platform === 'win32' && !env.SWC_NATIVE_BINDING_CACHE) {
  const scriptsDir = dirname(fileURLToPath(import.meta.url))
  env.SWC_NATIVE_BINDING_CACHE = resolve(scriptsDir, '..', '..', '.swc-native-cache')
}

const scriptsDir = dirname(fileURLToPath(import.meta.url))
const vitest = resolve(scriptsDir, '..', '..', 'node_modules', 'vitest', 'vitest.mjs')
const result = spawnSync(process.execPath, [vitest, ...process.argv.slice(2)], { env, stdio: 'inherit' })

if (result.error) throw result.error
process.exitCode = result.status ?? 1
