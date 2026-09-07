import { ApiError } from '../core/model/ApiError'
import { SettingRepository } from '../repositories/SettingRepository'
import { catalog, defaults, definitionFor, isKnownSetting } from './SettingsCatalog'

const repository = new SettingRepository()

/**
 * Application preferences.
 *
 * Reads always answer with a complete set: stored values layered over the
 * catalogue defaults. The UI therefore never has to handle a missing key,
 * and a fresh install behaves identically to a configured one.
 */
export class SettingsEndpoints {
  public async all(): Promise<Record<string, unknown>> {
    const stored = await repository.all()

    // Defaults first so anything stored wins, and so a key retired from the
    // catalogue but still in the table does not leak back into the response.
    const merged: Record<string, unknown> = defaults()
    for (const [key, value] of Object.entries(stored)) {
      if (isKnownSetting(key)) merged[key] = value
    }

    return merged
  }

  public async get(key: string): Promise<{ key: string; value: unknown }> {
    const definition = definitionFor(key)
    if (!definition) throw ApiError.notFound(`Unknown setting '${key}'`)

    const stored = await repository.get(key)
    return { key, value: stored === undefined ? definition.default() : stored }
  }

  public async set(key: string, body: unknown): Promise<{ key: string; value: unknown }> {
    const definition = definitionFor(key)
    if (!definition) {
      throw ApiError.notFound(`Unknown setting '${key}'`, { known: Object.keys(defaults()) })
    }

    // Accept both `{ "value": x }` and a bare `x`, since a scalar setting
    // reads more naturally as the latter.
    const raw = SettingsEndpoints.unwrap(body)

    const parsed = definition.schema.safeParse(raw)
    if (!parsed.success) {
      throw ApiError.unprocessable(`Invalid value for '${key}'`, {
        expected: definition.description,
        issues: parsed.error.issues.map(issue => issue.message)
      })
    }

    await repository.set(key, parsed.data)
    return { key, value: parsed.data }
  }

  /**
   * Bulk update. Every key is validated before anything is written, so a
   * single bad value rejects the whole request rather than saving half a
   * section.
   */
  public async update(body: unknown): Promise<Record<string, unknown>> {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw ApiError.badRequest('Expected an object of setting keys and values')
    }

    const incoming = body as Record<string, unknown>
    const unknownKeys = Object.keys(incoming).filter(key => !isKnownSetting(key))
    if (unknownKeys.length > 0) {
      throw ApiError.badRequest(`Unknown setting(s): ${unknownKeys.join(', ')}`)
    }

    const validated: Record<string, unknown> = {}
    const problems: Record<string, string[]> = {}

    for (const [key, value] of Object.entries(incoming)) {
      const definition = definitionFor(key)
      if (!definition) continue

      const parsed = definition.schema.safeParse(value)
      if (parsed.success) validated[key] = parsed.data
      else problems[key] = parsed.error.issues.map(issue => issue.message)
    }

    if (Object.keys(problems).length > 0) {
      throw ApiError.unprocessable('One or more settings are invalid', problems)
    }

    await repository.setMany(validated)
    return this.all()
  }

  /** Reset a setting to its catalogue default. */
  public async reset(key: string): Promise<{ key: string; value: unknown }> {
    const definition = definitionFor(key)
    if (!definition) throw ApiError.notFound(`Unknown setting '${key}'`)

    await repository.remove(key)
    return { key, value: definition.default() }
  }

  /** The catalogue itself: keys, descriptions and defaults. */
  public async catalog(): Promise<Array<{ key: string; description: string; default: unknown }>> {
    return catalog()
  }

  private static unwrap(body: unknown): unknown {
    if (typeof body === 'object' && body !== null && !Array.isArray(body) && 'value' in body) {
      return (body as { value: unknown }).value
    }
    return body
  }
}
