import type { GeocodeResult, WeatherLocation, WeatherReport, WeatherUnits } from '../../types/domain'

/**
 * A source of forecasts.
 *
 * The seam exists mostly so the default can stay keyless. Open-Meteo needs no
 * account, which matters for something a household installs on a Pi — a
 * dashboard that demands an API key signup before it can show the weather is
 * a dashboard that never gets set up. OpenWeatherMap is there for anyone who
 * already has a key and prefers it.
 */
export interface WeatherProvider {
  readonly id: string
  readonly name: string

  /** Whether this provider can be used with the configuration it has. */
  isConfigured(): boolean

  fetch(location: WeatherLocation, units: WeatherUnits): Promise<WeatherReport>

  /**
   * Turn a place name into coordinates. Optional: only the provider that
   * offers it for free implements it, and the service falls back to whichever
   * one does.
   */
  geocode?(query: string): Promise<GeocodeResult[]>
}

export class WeatherProviderRegistry {
  private static providers = new Map<string, WeatherProvider>()

  private constructor() {
    /* static only */
  }

  public static register(...providers: WeatherProvider[]): void {
    for (const provider of providers) WeatherProviderRegistry.providers.set(provider.id, provider)
  }

  public static get(id: string): WeatherProvider | undefined {
    return WeatherProviderRegistry.providers.get(id)
  }

  /**
   * The provider to use, falling back rather than failing.
   *
   * A configured provider that has lost its API key should not take the
   * weather off the wall when a keyless one is available.
   */
  public static resolve(preferred: string): WeatherProvider | undefined {
    const chosen = WeatherProviderRegistry.get(preferred)
    if (chosen?.isConfigured()) return chosen

    return [...WeatherProviderRegistry.providers.values()].find(provider => provider.isConfigured())
  }

  /** The first provider that can turn place names into coordinates. */
  public static geocoder(): WeatherProvider | undefined {
    return [...WeatherProviderRegistry.providers.values()].find(
      provider => provider.isConfigured() && typeof provider.geocode === 'function'
    )
  }

  public static all(): WeatherProvider[] {
    return [...WeatherProviderRegistry.providers.values()]
  }

  public static reset(): void {
    WeatherProviderRegistry.providers.clear()
  }
}
