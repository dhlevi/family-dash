import swc from 'unplugin-swc'
import { defineConfig } from 'vitest/config'

/**
 * The controllers rely on legacy TypeScript decorators and on
 * `emitDecoratorMetadata` for parameter type coercion. Vitest's default
 * transformer supports neither, so tests run through SWC, which does — and
 * which mirrors what `tsc` emits for the production build.
 */
export default defineConfig({
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        target: 'es2022',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true }
      }
    })
  ],
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      reporter: ['text', 'lcov'],
      include: ['lib/**/*.ts'],
      exclude: ['lib/index.ts', 'lib/public/**']
    }
  }
})
