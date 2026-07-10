import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { decrypt } from '@/lib/whatsapp/encryption'
import { evoConnectionState, evoConnect } from '@/lib/whatsapp/evolution-api'

/**
 * GET /api/whatsapp/evolution/state
 *
 * Polls the bound Evolution instance's connection state. When it isn't
 * `open`, also fetches a fresh QR (base64) so the settings UI can render
 * it for scanning. Persists the latest state onto whatsapp_config.
 */
export async function GET() {
  try {
    const ctx = await requireRole('admin')

    const { data: config } = await ctx.supabase
      .from('whatsapp_config')
      .select('id, provider, base_url, instance_name, api_key')
      .eq('account_id', ctx.accountId)
      .maybeSingle()

    if (!config || config.provider !== 'evolution') {
      return NextResponse.json(
        { connected: false, reason: 'not_configured' },
        { status: 200 },
      )
    }

    const binding = {
      baseUrl: config.base_url as string,
      instance: config.instance_name as string,
      apiKey: decrypt(config.api_key as string),
    }

    let state = 'unknown'
    try {
      const conn = await evoConnectionState(binding)
      state = conn.state
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unreachable'
      return NextResponse.json(
        { connected: false, reason: 'unreachable', message },
        { status: 200 },
      )
    }

    let qrCode: string | undefined
    if (state !== 'open') {
      try {
        const qr = await evoConnect(binding)
        qrCode = qr.base64
      } catch {
        // QR fetch is best-effort; the instance may not be in a QR-ready state.
      }
    }

    await ctx.supabase
      .from('whatsapp_config')
      .update({
        evolution_state: state,
        status: state === 'open' ? 'connected' : 'disconnected',
        qr_code: qrCode ?? null,
        ...(state === 'open' ? { connected_at: new Date().toISOString() } : {}),
      })
      .eq('id', config.id)

    return NextResponse.json({
      connected: state === 'open',
      state,
      qr_code: qrCode ?? null,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
