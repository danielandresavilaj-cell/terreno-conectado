import { defineConfig } from 'vitest/config'
import swc from 'unplugin-swc'

/**
 * Los tests e2e arrancan el contenedor Nest, que depende de la metadata de
 * decoradores (design:paramtypes) para el DI. Esbuild no la emite; SWC sí.
 */
export default defineConfig({
  plugins: [
    swc.vite({
      tsconfigFile: false,
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
        target: 'es2021',
      },
      module: { type: 'es6' },
    }),
  ],
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    hookTimeout: 180_000,
    testTimeout: 60_000,
  },
})