// ============================================================
// Provider factory.
//
// Given an account's `whatsapp_config` row, return the bound
// `WhatsAppProvider`. This is the single place that owns credential
// decryption and the meta/evolution branch — every send call site
// goes through here instead of importing `meta-api.ts` directly.
// ============================================================

import { decrypt } from '@/lib/whatsapp/encryption'
import { MetaProvider } from './meta-adapter'
import { EvolutionProvider } from './evolution-adapter'
import type { WhatsAppProvider, ProviderId } from './types'

/**
 * The subset of a `whatsapp_config` row the factory needs. Callers pass
 * the full `select('*')` row; only these columns are read.
 */
export interface ProviderConfigRow {
  provider?: ProviderId | null
  // Meta
  phone_number_id?: string | null
  access_token?: string | null
  // Evolution
  base_url?: string | null
  instance_name?: string | null
  api_key?: string | null
}

export function getProviderId(config: ProviderConfigRow): ProviderId {
  return (config.provider ?? 'meta') === 'evolution' ? 'evolution' : 'meta'
}

export function getProvider(config: ProviderConfigRow): WhatsAppProvider {
  if (getProviderId(config) === 'evolution') {
    if (!config.base_url || !config.instance_name || !config.api_key) {
      throw new Error('Evolution config incomplete (base_url / instance_name / api_key).')
    }
    return new EvolutionProvider({
      baseUrl: config.base_url,
      instance: config.instance_name,
      apiKey: decrypt(config.api_key),
    })
  }

  if (!config.phone_number_id || !config.access_token) {
    throw new Error('Meta config incomplete (phone_number_id / access_token).')
  }
  return new MetaProvider({
    phoneNumberId: config.phone_number_id,
    accessToken: decrypt(config.access_token),
  })
}

export type { WhatsAppProvider, ProviderId } from './types'
