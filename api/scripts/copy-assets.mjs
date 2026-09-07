/**
 * Copies non-TypeScript assets into the build output.
 *
 * `tsc` only emits .js for .ts inputs, so the SQL migrations would be absent
 * from build/ and the Migrator would find nothing to apply. Run as part of
 * `npm run build`.
 */
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const assets = [{ from: 'lib/db/migrations', to: 'build/db/migrations' }]

for (const asset of assets) {
  const from = resolve(root, asset.from)
  const to = resolve(root, asset.to)

  if (!existsSync(from)) {
    console.error(`copy-assets: missing source ${asset.from}`)
    process.exit(1)
  }

  mkdirSync(dirname(to), { recursive: true })
  cpSync(from, to, { recursive: true })
  console.log(`copy-assets: ${asset.from} -> ${asset.to}`)
}
