import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'
import { evoConnectionState, evoSetWebhook } from '@/lib/whatsapp/evolution-api'
import { assertPublicHttpUrl, UrlNotAllowedError } from '@/lib/whatsapp/url-guard'

// Events wacrm consumes from the Evolution instance.
const WEBHOOK_EVENTS = [
  'MESSAGES_UPSERT',
  'MESSAGES_UPDATE',
  'MESSAGES_DELETE',
  'CONNECTION_UPDATE',
  'QRCODE_UPDATED',
]

function normalizeBaseUrl(raw: string): string {
  let url = raw.trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`
  return url
}

function siteUrl(request: Request): string {
  const env = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, '')
  if (env) return env
  try {
    return new URL(request.url).origin
  } catch {
    return ''
  }
}

/**
 * POST /api/whatsapp/evolution/connect
 *
 * Body: { base_url, api_key, instance_name }
 *
 * Connects this account to a REMOTE Evolution API instance the user
 * already runs: verifies reachability + credentials, registers wacrm's
 * inbound webhook on the instance, and upserts the whatsapp_config row
 * (provider='evolution'). Does NOT create the instance.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin')

    const body = (await request.json().catch(() => ({}))) as {
      base_url?: string
      api_key?: string
      instance_name?: string
    }
    const baseUrl = body.base_url ? normalizeBaseUrl(body.base_url) : ''
    const enteredKey = (body.api_key ?? '').trim()
    const instance = (body.instance_name ?? '').trim()

    // Load any existing config first so a re-save (the API-key field left
    // masked/blank) can reuse the stored key + webhook_secret instead of
    // demanding the user re-enter the key every time.
    const { data: existing } = await ctx.supabase
      .from('whatsapp_config')
      .select('id, webhook_secret, api_key, provider')
      .eq('account_id', ctx.accountId)
      .maybeSingle()

    const hasStoredKey = existing?.provider === 'evolution' && !!existing?.api_key
    // Plaintext key for the live calls; encrypted value for storage.
    const apiKey = enteredKey || (hasStoredKey ? decrypt(existing.api_key as string) : '')
    const encryptedKey = enteredKey ? encrypt(enteredKey) : (existing?.api_key as string | undefined)

    if (!baseUrl || !instance || !apiKey || !encryptedKey) {
      return NextResponse.json(
        { error: 'base_url, api_key and instance_name are required' },
        { status: 400 },
      )
    }

    // SSRF guard: the base URL is user-supplied and the server will call
    // it. Reject anything resolving to a private / loopback / link-local
    // address so it can't be aimed at internal services or metadata.
    try {
      await assertPublicHttpUrl(baseUrl)
    } catch (err) {
      if (err instanceof UrlNotAllowedError) {
        return NextResponse.json({ error: err.message }, { status: 400 })
      }
      throw err
    }

    // Verify reachability + credentials before saving anything. Don't echo
    // the upstream response body back to the client (info-leak surface).
    let state = 'unknown'
    try {
      const conn = await evoConnectionState({ baseUrl, instance, apiKey })
      state = conn.state
    } catch (err) {
      console.warn(
        '[evolution/connect] connection check failed:',
        err instanceof Error ? err.message : err,
      )
      return NextResponse.json(
        { error: 'Could not reach the Evolution instance. Check the URL and API key.' },
        { status: 502 },
      )
    }

    // Preserve an existing webhook_secret so re-saving keeps the URL stable.
    const webhookSecret =
      (existing?.webhook_secret as string | undefined) ||
      crypto.randomBytes(32).toString('hex')

    const webhookUrl = `${siteUrl(request)}/api/whatsapp/evolution/webhook/${webhookSecret}`

    // Register our webhook on the instance. Non-fatal: report the result
    // so the UI can prompt a retry, but still persist the credentials.
    let webhookSet = false
    let webhookError: string | undefined
    try {
      await evoSetWebhook({ baseUrl, instance, apiKey, url: webhookUrl, events: WEBHOOK_EVENTS })
      webhookSet = true
    } catch (err) {
      webhookError = err instanceof Error ? err.message : 'set webhook failed'
      console.warn('[evolution/connect] set webhook failed:', webhookError)
    }

    const row = {
      account_id: ctx.accountId,
      user_id: ctx.userId,
      provider: 'evolution' as const,
      base_url: baseUrl,
      instance_name: instance,
      api_key: encryptedKey,
      webhook_secret: webhookSecret,
      evolution_state: state,
      status: state === 'open' ? 'connected' : 'disconnected',
      connected_at: state === 'open' ? new Date().toISOString() : null,
      // Clear any stale Meta credentials from a previous provider on this account.
      phone_number_id: null,
      waba_id: null,
      access_token: null,
      verify_token: null,
      registered_at: null,
      subscribed_apps_at: null,
      last_registration_error: null,
      updated_at: new Date().toISOString(),
    }

    const { error: upsertErr } = await ctx.supabase
      .from('whatsapp_config')
      .upsert(row, { onConflict: 'account_id' })

    if (upsertErr) {
      console.error('[evolution/connect] upsert failed:', upsertErr)
      return NextResponse.json({ error: 'Failed to save configuration' }, { status: 500 })
    }

    return NextResponse.json({
      connected: state === 'open',
      state,
      webhook_set: webhookSet,
      webhook_url: webhookUrl,
      ...(webhookError ? { webhook_error: webhookError } : {}),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * DELETE /api/whatsapp/evolution/connect — disconnect: remove the row.
 */
export async function DELETE() {
  try {
    const ctx = await requireRole('admin')
    const { error } = await ctx.supabase
      .from('whatsapp_config')
      .delete()
      .eq('account_id', ctx.accountId)
    if (error) {
      return NextResponse.json({ error: 'Failed to disconnect' }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
