import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { getProvider } from '@/lib/whatsapp/providers'
import { sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils'

/**
 * POST /api/whatsapp/messages/[id]/delete
 *
 * Delete a message "for everyone" on WhatsApp and soft-delete the local
 * row (sets messages.deleted_at). Evolution only — Meta has no delete
 * API, so the provider capability gate rejects Meta accounts.
 */
export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params
    const account = await getCurrentAccount()

    // Load the message + its conversation (account-scoped) + contact phone.
    const { data: message } = await account.supabase
      .from('messages')
      .select('id, message_id, sender_type, conversation_id')
      .eq('id', id)
      .maybeSingle()
    if (!message || !message.message_id) {
      return NextResponse.json(
        { error: 'Message not found or was never sent to WhatsApp' },
        { status: 404 },
      )
    }

    const { data: conversation } = await account.supabase
      .from('conversations')
      .select('id, contact:contacts(phone)')
      .eq('id', message.conversation_id)
      .eq('account_id', account.accountId)
      .maybeSingle()
    const contact = Array.isArray(conversation?.contact)
      ? conversation?.contact[0]
      : conversation?.contact
    if (!conversation || !contact?.phone) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    const { data: config } = await account.supabase
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', account.accountId)
      .maybeSingle()
    if (!config) {
      return NextResponse.json({ error: 'WhatsApp not configured.' }, { status: 400 })
    }

    const provider = getProvider(config)
    if (!provider.capabilities.supportsDeleteMessage || !provider.deleteMessage) {
      return NextResponse.json(
        { error: 'Deleting messages is only supported with the Evolution provider.' },
        { status: 400 },
      )
    }

    try {
      await provider.deleteMessage({
        to: sanitizePhoneForMeta(contact.phone),
        providerMessageId: message.message_id,
        fromMe: message.sender_type !== 'customer',
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'delete failed'
      return NextResponse.json({ error: `WhatsApp API error: ${msg}` }, { status: 502 })
    }

    const { error: updErr } = await account.supabase
      .from('messages')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
    if (updErr) {
      return NextResponse.json(
        { error: 'Deleted on WhatsApp but failed to update locally' },
        { status: 500 },
      )
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
