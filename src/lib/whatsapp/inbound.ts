// ============================================================
// Provider-agnostic inbound pipeline.
//
// The Meta webhook (src/app/api/whatsapp/webhook/route.ts) has its own
// long-standing inline implementation of this and is left untouched.
// This module is the shared core the EVOLUTION webhook feeds: given a
// `NormalizedInbound` (already provider-decoded, media already
// resolved to a URL), it runs the exact same downstream steps —
// find-or-create contact + conversation, insert the message, bump the
// conversation, flag broadcast replies, and fan out to
// flows / automations / AI auto-reply / public webhooks.
//
// It reuses the same exported helpers the Meta path uses
// (`resolveConversationByPhone`, the engine dispatchers) so a contact
// created from an Evolution message is indistinguishable from a
// Meta-created or API-created one.
// ============================================================

import { supabaseAdmin } from '@/lib/flows/admin-client'
import { resolveConversationByPhone } from '@/lib/whatsapp/resolve-conversation'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import { dispatchInboundToFlows } from '@/lib/flows/engine'
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply'
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver'
import type { ProviderId } from '@/lib/whatsapp/providers/types'

export type InboundContentType =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'location'
  | 'interactive'
  | 'sticker'
  | 'reaction'

export interface NormalizedInbound {
  /** The provider's message id (Meta wamid / Baileys key id). */
  providerMessageId: string
  /** Sender phone in raw digits (E.164-ish, without '+'). */
  fromPhone: string
  senderName?: string
  timestampMs: number
  contentType: InboundContentType
  contentText: string | null
  /** Already-resolved media URL (public bucket URL for Evolution). */
  mediaUrl: string | null
  interactiveReplyId: string | null
  /** Present only when contentType === 'reaction'. */
  reaction?: { targetProviderMessageId: string; emoji: string }
  /** The provider message id of the quoted parent, if this is a reply. */
  replyToProviderMessageId?: string | null
}

const INSERTABLE_CONTENT_TYPES = new Set<string>([
  'text', 'image', 'document', 'audio', 'video',
  'location', 'template', 'interactive', 'sticker',
])

/** Resolve a provider message id to its internal messages.id within a conversation. */
async function lookupInternalIdByProviderId(
  providerMessageId: string,
  conversationId: string,
): Promise<string | null> {
  const { data, error } = await supabaseAdmin()
    .from('messages')
    .select('id')
    .eq('message_id', providerMessageId)
    .eq('conversation_id', conversationId)
    .maybeSingle()
  if (error) {
    console.error('[inbound] lookupInternalIdByProviderId failed:', error.message)
    return null
  }
  return data?.id ?? null
}

/** Best-effort: mark a broadcast recipient replied when they message back. */
async function flagBroadcastReplyIfAny(accountId: string, contactId: string) {
  try {
    const { data: recs, error } = await supabaseAdmin()
      .from('broadcast_recipients')
      .select('id, status, broadcast_id, broadcasts!inner(account_id)')
      .eq('contact_id', contactId)
      .eq('broadcasts.account_id', accountId)
      .in('status', ['sent', 'delivered', 'read'])
      .order('created_at', { ascending: false })
      .limit(1)
    if (error || !recs || recs.length === 0) return
    const { error: updErr } = await supabaseAdmin()
      .from('broadcast_recipients')
      .update({ status: 'replied', replied_at: new Date().toISOString() })
      .eq('id', recs[0].id)
    if (updErr) console.error('[inbound] mark broadcast replied failed:', updErr.message)
  } catch (err) {
    console.error('[inbound] flagBroadcastReplyIfAny failed:', err)
  }
}

async function handleInboundReaction(
  conversationId: string,
  contactId: string,
  reaction: { targetProviderMessageId: string; emoji: string },
) {
  const targetInternalId = await lookupInternalIdByProviderId(
    reaction.targetProviderMessageId,
    conversationId,
  )
  if (!targetInternalId) {
    console.warn('[inbound] reaction target not found; skipping', reaction.targetProviderMessageId)
    return
  }
  if (!reaction.emoji) {
    const { error } = await supabaseAdmin()
      .from('message_reactions')
      .delete()
      .eq('message_id', targetInternalId)
      .eq('actor_type', 'customer')
      .eq('actor_id', contactId)
    if (error) console.error('[inbound] reaction delete failed:', error.message)
    return
  }
  const { error } = await supabaseAdmin()
    .from('message_reactions')
    .upsert(
      {
        message_id: targetInternalId,
        conversation_id: conversationId,
        actor_type: 'customer',
        actor_id: contactId,
        emoji: reaction.emoji,
      },
      { onConflict: 'message_id,actor_type,actor_id' },
    )
  if (error) console.error('[inbound] reaction upsert failed:', error.message)
}

/**
 * Mark the message(s) with this provider id deleted (soft delete). Used
 * for inbound "delete for everyone" / revoke events. message_id is not
 * unique, so this can touch more than one row — that's fine.
 */
export async function markMessageDeletedByProviderId(args: {
  providerMessageId: string
}): Promise<void> {
  const { error } = await supabaseAdmin()
    .from('messages')
    .update({ deleted_at: new Date().toISOString() })
    .eq('message_id', args.providerMessageId)
    .is('deleted_at', null)
  if (error) console.error('[inbound] markMessageDeleted failed:', error.message)
}

/**
 * Run the full inbound pipeline for one normalized message.
 * `ownerUserId` is the WhatsApp config owner (audit user for created rows).
 */
export async function processInboundMessage(args: {
  accountId: string
  ownerUserId: string
  provider: ProviderId
  msg: NormalizedInbound
}): Promise<void> {
  const { accountId, ownerUserId, msg } = args
  const db = supabaseAdmin()

  // ---- contact + conversation (shared find-or-create) ----------
  const resolved = await resolveConversationByPhone(db, accountId, msg.fromPhone, msg.senderName)
  const { conversationId, contactId, contactCreated } = resolved

  if (contactCreated) {
    await dispatchWebhookEvent(db, accountId, 'conversation.created', {
      conversation_id: conversationId,
      contact_id: contactId,
    })
  }

  // ---- reactions short-circuit (never a messages row) ----------
  if (msg.contentType === 'reaction') {
    if (msg.reaction) await handleInboundReaction(conversationId, contactId, msg.reaction)
    return
  }

  // ---- reply context -------------------------------------------
  let replyToInternalId: string | null = null
  if (msg.replyToProviderMessageId) {
    replyToInternalId = await lookupInternalIdByProviderId(
      msg.replyToProviderMessageId,
      conversationId,
    )
  }

  // Providers can redeliver the same message (webhook retries, Baileys
  // re-emitting after a reconnect). One provider id → one row.
  if (await lookupInternalIdByProviderId(msg.providerMessageId, conversationId)) {
    return
  }

  const contentType = INSERTABLE_CONTENT_TYPES.has(msg.contentType) ? msg.contentType : 'text'

  // First-ever inbound from this contact? (count before insert)
  const { count: priorCustomerMsgCount } = await db
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversationId)
    .eq('sender_type', 'customer')
  const isFirstInboundMessage = (priorCustomerMsgCount ?? 0) === 0

  const { error: msgError } = await db.from('messages').insert({
    conversation_id: conversationId,
    sender_type: 'customer',
    content_type: contentType,
    content_text: msg.contentText,
    media_url: msg.mediaUrl,
    message_id: msg.providerMessageId,
    status: 'delivered',
    created_at: new Date(msg.timestampMs).toISOString(),
    reply_to_message_id: replyToInternalId,
    interactive_reply_id: msg.interactiveReplyId,
  })
  if (msgError) {
    console.error('[inbound] message insert failed:', msgError)
    return
  }

  // Bump conversation. Fetch current unread to increment (one row).
  const { data: convRow } = await db
    .from('conversations')
    .select('unread_count')
    .eq('id', conversationId)
    .maybeSingle()
  await db
    .from('conversations')
    .update({
      last_message_text: msg.contentText || `[${msg.contentType}]`,
      last_message_at: new Date().toISOString(),
      unread_count: ((convRow?.unread_count as number | undefined) || 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversationId)

  await flagBroadcastReplyIfAny(accountId, contactId)

  // ---- engine dispatch (flows → automations → AI → webhooks) ---
  const inboundText = msg.contentText ?? ''
  const flowResult = await dispatchInboundToFlows({
    accountId,
    userId: ownerUserId,
    contactId,
    conversationId,
    message: msg.interactiveReplyId
      ? {
          kind: 'interactive_reply',
          reply_id: msg.interactiveReplyId,
          reply_title: inboundText,
          meta_message_id: msg.providerMessageId,
        }
      : {
          kind: 'text',
          text: inboundText,
          meta_message_id: msg.providerMessageId,
        },
    isFirstInboundMessage,
  })
  const flowConsumed = flowResult.consumed

  const automationTriggers: (
    | 'new_contact_created'
    | 'first_inbound_message'
    | 'new_message_received'
    | 'keyword_match'
    | 'interactive_reply'
  )[] = []
  if (!flowConsumed) {
    automationTriggers.push('new_message_received', 'keyword_match')
    if (msg.interactiveReplyId) automationTriggers.push('interactive_reply')
  }
  if (contactCreated) automationTriggers.unshift('new_contact_created')
  if (isFirstInboundMessage) automationTriggers.unshift('first_inbound_message')
  for (const triggerType of automationTriggers) {
    runAutomationsForTrigger({
      accountId,
      triggerType,
      contactId,
      context: {
        message_text: inboundText,
        conversation_id: conversationId,
        interactive_reply_id: msg.interactiveReplyId ?? undefined,
      },
    }).catch((err) => console.error('[inbound] automation dispatch failed:', err))
  }

  if (!flowConsumed && !msg.interactiveReplyId && inboundText.trim()) {
    await dispatchInboundToAiReply({
      accountId,
      conversationId,
      contactId,
      configOwnerUserId: ownerUserId,
    })
  }

  await dispatchWebhookEvent(db, accountId, 'message.received', {
    conversation_id: conversationId,
    contact_id: contactId,
    whatsapp_message_id: msg.providerMessageId,
    content_type: contentType,
    text: msg.contentText,
  })
}

// ============================================================
// Messages the business sent from the phone itself.
//
// With Evolution (Baileys) the number stays usable in the WhatsApp app,
// so a salesperson may answer a lead straight from the phone. Evolution
// reports those as MESSAGES_UPSERT with `key.fromMe`; without this the
// CRM thread would only show the customer's side. Messages wacrm sent
// through the API are already stored under the same provider id and
// are skipped. No automations / flows / AI run for these (a human just
// answered) — instead, like an in-app agent reply, an active flow run
// for the contact is paused.
// ============================================================

export async function recordOutboundFromPhone(args: {
  accountId: string
  /** Normalized message; `fromPhone` holds the CHAT's phone (the customer). */
  msg: NormalizedInbound
}): Promise<void> {
  const { accountId, msg } = args
  if (msg.contentType === 'reaction') return
  const db = supabaseAdmin()

  // Don't create a contact name from our own pushName — pass no name.
  const { conversationId, contactId } = await resolveConversationByPhone(
    db,
    accountId,
    msg.fromPhone,
    undefined,
  )

  if (await lookupInternalIdByProviderId(msg.providerMessageId, conversationId)) {
    return // sent from wacrm (already stored) or a redelivery
  }

  let replyToInternalId: string | null = null
  if (msg.replyToProviderMessageId) {
    replyToInternalId = await lookupInternalIdByProviderId(
      msg.replyToProviderMessageId,
      conversationId,
    )
  }

  const contentType = INSERTABLE_CONTENT_TYPES.has(msg.contentType) ? msg.contentType : 'text'
  const { error: msgError } = await db.from('messages').insert({
    conversation_id: conversationId,
    sender_type: 'agent',
    content_type: contentType,
    content_text: msg.contentText,
    media_url: msg.mediaUrl,
    message_id: msg.providerMessageId,
    status: 'sent',
    created_at: new Date(msg.timestampMs).toISOString(),
    reply_to_message_id: replyToInternalId,
  })
  if (msgError) {
    console.error('[inbound] outbound-from-phone insert failed:', msgError)
    return
  }

  // Answering from the phone also reads the chat on WhatsApp.
  await db
    .from('conversations')
    .update({
      last_message_text: msg.contentText || `[${msg.contentType}]`,
      last_message_at: new Date(msg.timestampMs).toISOString(),
      unread_count: 0,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversationId)

  const { error: pauseErr } = await db
    .from('flow_runs')
    .update({
      status: 'paused_by_agent',
      ended_at: new Date().toISOString(),
      end_reason: 'agent_replied',
    })
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .eq('status', 'active')
  if (pauseErr) console.error('[inbound] pause-on-phone-reply failed:', pauseErr.message)
}

// ============================================================
// Status updates (delivery/read receipts) — provider-neutral.
// Mirrors the Meta webhook's ladder so Evolution MESSAGES_UPDATE
// events advance both messages.status and broadcast_recipients.
// ============================================================

const RECIPIENT_STATUS_LADDER = ['pending', 'sent', 'delivered', 'read', 'replied'] as const
function ladderLevel(s: string): number {
  const idx = (RECIPIENT_STATUS_LADDER as readonly string[]).indexOf(s)
  return idx < 0 ? -1 : idx
}
function isValidStatusTransition(current: string, incoming: string): boolean {
  if (incoming === 'failed') return current === 'pending' || current === 'sent'
  if (current === 'failed') return false
  const ci = ladderLevel(current)
  const ii = ladderLevel(incoming)
  if (ii < 0) return false
  if (ci < 0) return true
  return ii > ci
}

/** `status` is one of messages.status: sent | delivered | read | failed. */
export async function handleProviderStatusUpdate(args: {
  providerMessageId: string
  status: string
  timestampMs: number
}): Promise<void> {
  const { providerMessageId, status } = args
  const db = supabaseAdmin()

  const { error: msgErr } = await db
    .from('messages')
    .update({ status })
    .eq('message_id', providerMessageId)
  if (msgErr) console.error('[inbound] status message update failed:', msgErr.message)

  const tsIso = new Date(args.timestampMs).toISOString()
  const { data: recipient } = await db
    .from('broadcast_recipients')
    .select('id, status')
    .eq('whatsapp_message_id', providerMessageId)
    .maybeSingle()
  if (recipient && isValidStatusTransition(recipient.status, status)) {
    const update: Record<string, unknown> = { status }
    if (status === 'sent') update.sent_at = tsIso
    if (status === 'delivered') update.delivered_at = tsIso
    if (status === 'read') update.read_at = tsIso
    await db.from('broadcast_recipients').update(update).eq('id', recipient.id)
  }

  const { data: msgRow } = await db
    .from('messages')
    .select('conversation_id, conversations(account_id)')
    .eq('message_id', providerMessageId)
    .limit(1)
    .maybeSingle()
  if (msgRow) {
    const conv = msgRow.conversations as unknown as { account_id: string } | null
    if (conv?.account_id) {
      await dispatchWebhookEvent(db, conv.account_id, 'message.status_updated', {
        whatsapp_message_id: providerMessageId,
        conversation_id: msgRow.conversation_id,
        status,
      })
    }
  }
}
