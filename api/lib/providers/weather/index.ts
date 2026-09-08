import { OpenMeteoProvider } from './OpenMeteoProvider'
import { OpenWeatherMapProvider } from './OpenWeatherMapProvider'
import { WeatherProviderRegistry } from './WeatherProvider'

/**
 * Registers the weather providers. Called once at startup.
 *
 * Open-Meteo goes first so it is the fallback when a preferred provider is
 * unconfigured — it needs no key, so it is always available.
 */
export function registerWeatherProviders(): void {
  WeatherProviderRegistry.register(new OpenMeteoProvider(), new OpenWeatherMapProvider())

  const usable = WeatherProviderRegistry.all()
    .filter(provider => provider.isConfigured())
    .map(provider => provider.name)

  console.info(`Weather providers available: ${usable.join(', ')}`)
}

export { WeatherProviderRegistry } from './WeatherProvider'
export type { WeatherProvider } from './WeatherProvider'
export { OpenMeteoProvider } from './OpenMeteoProvider'
export { OpenWeatherMapProvider } from './OpenWeatherMapProvider'
