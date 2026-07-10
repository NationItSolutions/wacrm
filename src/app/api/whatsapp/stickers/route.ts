import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { getProvider } from '@/lib/whatsapp/providers'
import { sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils'

/**
 * GET /api/whatsapp/stickers
 * List the account's saved sticker library (for the composer picker).
 */
export async function GET() {
  try {
    const ctx = await getCurrentAccount()
    const { data, error } = await ctx.supabase
      .from('stickers')
      .select('id, media_url, mime, created_at')
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false })
      .limit(100)
    if (error) {
      return NextResponse.json({ error: 'Failed to load stickers' }, { status: 500 })
    }
    return NextResponse.json({ stickers: data ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/whatsapp/stickers
 * Body: { conversation_id, sticker_url }
 * Sends a sticker to the conversation's contact via the account's
 * provider (Evolution only) and persists it as a content_type='sticker'
 * message. Also saves it to the library for re-use.
 */
export async function POST(request: Request) {
  try {
    const ctx = await getCurrentAccount()
    const body = (await request.json().catch(() => ({}))) as {
      conversation_id?: string
      sticker_url?: string
    }
    const conversationId = body.conversation_id
    const stickerUrl = body.sticker_url
    if (!conversationId || !stickerUrl) {
      return NextResponse.json(
        { error: 'conversation_id and sticker_url are required' },
        { status: 400 },
      )
    }

    // Conversation + contact phone (account-scoped).
    const { data: conversation } = await ctx.supabase
      .from('conversations')
      .select('id, contact:contacts(phone)')
      .eq('id', conversationId)
      .eq('account_id', ctx.accountId)
      .maybeSingle()
    const contact = Array.isArray(conversation?.contact)
      ? conversation?.contact[0]
      : conversation?.contact
    if (!conversation || !contact?.phone) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    const { data: config } = await ctx.supabase
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', ctx.accountId)
      .maybeSingle()
    if (!config) {
      return NextResponse.json({ error: 'WhatsApp not configured.' }, { status: 400 })
    }

    const provider = getProvider(config)
    if (!provider.capabilities.supportsStickers || !provider.sendSticker) {
      return NextResponse.json(
        { error: 'Stickers are only supported with the Evolution provider.' },
        { status: 400 },
      )
    }

    let waMessageId = ''
    try {
      const r = await provider.sendSticker({
        to: sanitizePhoneForMeta(contact.phone),
        link: stickerUrl,
      })
      waMessageId = r.messageId
    } catch (err) {
      const message = err instanceof Error ? err.message : 'send failed'
      return NextResponse.json({ error: `WhatsApp API error: ${message}` }, { status: 502 })
    }

    const { error: msgErr } = await ctx.supabase.from('messages').insert({
      conversation_id: conversationId,
      sender_type: 'agent',
      content_type: 'sticker',
      content_text: null,
      media_url: stickerUrl,
      message_id: waMessageId,
      status: 'sent',
    })
    if (msgErr) {
      return NextResponse.json(
        { error: 'Sticker sent but failed to record it' },
        { status: 500 },
      )
    }

    await ctx.supabase
      .from('conversations')
      .update({
        last_message_text: '[sticker]',
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversationId)

    // Save to library for reuse (best-effort).
    await ctx.supabase
      .from('stickers')
      .upsert(
        { account_id: ctx.accountId, user_id: ctx.userId, media_url: stickerUrl },
        { onConflict: 'account_id,media_url' },
      )

    return NextResponse.json({ success: true, whatsapp_message_id: waMessageId })
  } catch (err) {
    return toErrorResponse(err)
  }
}
