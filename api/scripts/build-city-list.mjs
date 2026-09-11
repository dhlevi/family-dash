/**
 * Regenerates lib/providers/map/cityList.ts from cities.source.json.
 *
 *   node scripts/build-city-list.mjs
 *
 * Coordinates come from the GeoNames gazetteer, which publishes its data as
 * bulk downloads under CC BY 4.0 precisely so that it can be used this way.
 * The first run fetches three files into scripts/.geonames/ (about 25MB) and
 * reuses them afterwards; delete that folder to refresh.
 *
 * Matching rules, in the order they matter:
 *   * the country must agree with `cc` in the source file;
 *   * for the Welsh and British Columbian groups the region must agree too,
 *     because there are a lot of places called Newport and Victoria;
 *   * among the survivors, the most populous wins, with administrative rank
 *     as a tie-breaker only. The other way round, any small county seat
 *     carrying the name as an alternate outranks the real city. "New York"
 *     resolved to a town of 7,864 in Nebraska before this was fixed, because
 *     New York City's feature code is a plain PPL.
 */
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const SOURCE = join(here, 'cities.source.json')
const CACHE = join(here, '.geonames')
const TARGET = join(here, '..', 'lib', 'providers', 'map', 'cityList.ts')

/** Country files carry every populated place; cities5000 covers the rest of the world. */
const DUMPS = ['CA', 'GB', 'cities5000']

/** How much ground a picture of each kind of place should cover, in metres. */
const SPANS = { metro: 13000, large: 10000, city: 7500, town: 5000, small: 3200 }

/** Regions that must also match a GeoNames admin-1 code. */
const ADMIN1 = {
  wales: 'WLS',
  'british-columbia': '02',
  'vancouver-island': '02'
}

/** Places GeoNames files under another name, or not as a populated place at all. */
const ALIASES = {
  'Hong Kong': 'Kowloon',
  'Daajing Giids': 'Queen Charlotte',
  Mumbles: 'The Mumbles',
  'St Davids': "St David's"
}

const normalise = text =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

const slug = text =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

async function ensureDumps() {
  mkdirSync(CACHE, { recursive: true })

  for (const name of DUMPS) {
    if (existsSync(join(CACHE, `${name}.txt`))) continue

    console.info(`  downloading ${name}.zip`)
    const response = await fetch(`https://download.geonames.org/export/dump/${name}.zip`)
    if (!response.ok) throw new Error(`GeoNames answered ${response.status} for ${name}.zip`)

    const archive = join(CACHE, `${name}.zip`)
    await pipeline(Readable.fromWeb(response.body), createWriteStream(archive))
    execFileSync('unzip', ['-oq', archive, '-d', CACHE])
  }
}

/** name (normalised, including alternates) -> the populated places using it. */
function buildIndex() {
  const index = new Map()

  for (const name of DUMPS) {
    for (const line of readFileSync(join(CACHE, `${name}.txt`), 'utf8').split('\n')) {
      const field = line.split('\t')
      // Feature class P is "city, village, ..."; everything else is a
      // mountain, a river or an administrative boundary.
      if (field.length < 15 || field[6] !== 'P') continue

      const record = {
        name: field[1],
        latitude: Number(field[4]),
        longitude: Number(field[5]),
        country: field[8].toLowerCase(),
        admin1: field[10],
        code: field[7],
        population: Number(field[14] || 0)
      }

      for (const alias of new Set([field[1], field[2], ...field[3].split(',')])) {
        if (!alias) continue

        const key = normalise(alias)
        const bucket = index.get(key)
        if (bucket) bucket.push(record)
        else index.set(key, [record])
      }
    }
  }

  return index
}

function resolve(index, entry) {
  const admin1 = ADMIN1[entry.region]
  const names = [entry.name, ...(ALIASES[entry.name] ? [ALIASES[entry.name]] : [])]

  for (const name of names) {
    let best = null

    for (const record of index.get(normalise(name)) ?? []) {
      if (record.country !== entry.cc) continue
      if (admin1 && record.admin1 !== admin1) continue

      const seat = ['PPLC', 'PPLA', 'PPLA2', 'PPLA3'].includes(record.code)
      if (
        best === null ||
        record.population > best.population ||
        (record.population === best.population && seat && !best.seat)
      ) {
        best = { ...record, seat }
      }
    }

    if (best) return best
  }

  return null
}

console.info('Building the city list')
await ensureDumps()

const index = buildIndex()
const entries = JSON.parse(readFileSync(SOURCE, 'utf8'))
const resolved = []
const failed = []
const keys = new Set()

for (const entry of entries) {
  const match = resolve(index, entry)

  if (!match) {
    failed.push(`${entry.name} (${entry.region})`)
    continue
  }

  const key = `${entry.region}:${slug(entry.name)}`
  if (keys.has(key)) {
    // Two entries sharing a key would share their "drawn recently" history,
    // so one of them would effectively never be chosen.
    failed.push(`${entry.name} (${entry.region}): duplicate key ${key}`)
    continue
  }

  keys.add(key)
  resolved.push({
    key,
    name: entry.name,
    country: entry.country,
    region: entry.region,
    latitude: Number(match.latitude.toFixed(5)),
    longitude: Number(match.longitude.toFixed(5)),
    spanMetres: SPANS[entry.category] ?? SPANS.city
  })
}

const body = resolved
  .map(
    city =>
      `  { key: '${city.key}', name: ${JSON.stringify(city.name)}, country: ${JSON.stringify(city.country)}, ` +
      `region: '${city.region}', latitude: ${city.latitude}, longitude: ${city.longitude}, ` +
      `spanMetres: ${city.spanMetres} }`
  )
  .join(',\n')

writeFileSync(
  TARGET,
  `import type { City } from './cities'\n\n` +
    `/**\n * The curated city list, with coordinates from the GeoNames gazetteer.\n *\n` +
    ` * GENERATED by scripts/build-city-list.mjs - edit scripts/cities.source.json\n` +
    ` * and run that script rather than editing this file by hand.\n *\n` +
    ` * Place data from https://www.geonames.org, CC BY 4.0.\n */\n` +
    `export const CITY_LIST: City[] = [\n${body}\n]\n`
)

console.info(`Wrote ${resolved.length} cities to ${TARGET}`)
if (failed.length > 0) console.warn(`${failed.length} could not be resolved:\n  ${failed.join('\n  ')}`)
