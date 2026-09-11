import { NtfyProvider } from './NtfyProvider'
import type { NotifyProvider } from './NotifyProvider'

export type { NotifyMessage, NotifyProvider } from './NotifyProvider'
export { NtfyProvider } from './NtfyProvider'

const provider: NotifyProvider = new NtfyProvider()

/** The notification provider in use. One for now; a seam for later. */
export function notifyProvider(): NotifyProvider {
  return provider
}
