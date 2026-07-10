import { NextResponse, after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  evoGetBase64FromMediaMessage,
  type EvolutionBinding,
  type EvolutionMessageKey,
} from '@/lib/whatsapp/evolution-api'
import { uploadAccountMediaServer } from '@/lib/storage/upload-media-server'
import {
  processInboundMessage,
  handleProviderStatusUpdate,
  markMessageDeletedByProviderId,
  type NormalizedInbound,
  type InboundContentType,
} from '@/lib/whatsapp/inbound'

const CHAT_MEDIA_BUCKET = 'chat-media'

/** Map a mime type to a file extension for the stored object name. */
function extFromMime(mime: string | undefined, contentType: InboundContentType): string {
  if (mime) {
    const map: Record<string, string> = {
      'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
      'video/mp4': 'mp4', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a',
      'application/pdf': 'pdf',
    }
    if (map[mime]) return map[mime]
    const guess = mime.split('/')[1]
    if (guess) return guess.replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'bin'
  }
  return contentType === 'sticker' ? 'webp' : contentType === 'audio' ? 'ogg' : 'bin'
}

// Evolution's inbound processing can fan out to per-message media
// downloads + engine dispatch; give the after() callback headroom.
export const maxDuration = 60

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _adminClient
}

/** Normalize Evolution's event name to UPPER_SNAKE (handles 'messages.upsert' and 'MESSAGES_UPSERT'). */
function normEvent(ev: unknown): string {
  return String(ev ?? '').toUpperCase().replace(/\./g, '_')
}

interface EvolutionKey {
  id?: string
  remoteJid?: string
  fromMe?: boolean
  /** Real phone JID when remoteJid is an opaque `@lid` id (newer WhatsApp). */
  senderPn?: string
}

/** Dig a quoted-message stanza id out of whichever sub-message carries contextInfo. */
function extractReplyToId(message: Record<string, unknown>): string | null {
  for (const val of Object.values(message)) {
    if (val && typeof val === 'object') {
      const ctx = (val as Record<string, unknown>).contextInfo as
        | Record<string, unknown>
        | undefined
      const stanzaId = ctx?.stanzaId
      if (typeof stanzaId === 'string' && stanzaId) return stanzaId
    }
  }
  return null
}

/** Media sub-message keys Evolution uses, mapped to our content types. */
const MEDIA_KINDS: Record<string, InboundContentType> = {
  imageMessage: 'image',
  videoMessage: 'video',
  audioMessage: 'audio',
  documentMessage: 'document',
  stickerMessage: 'sticker',
}

/**
 * Turn one Evolution message payload into a NormalizedInbound, or null
 * to skip (outbound echo, group/status JID, unsupported shape).
 *
 * Media bytes are NOT fetched here in stage 1 — a media message records
 * its caption/placeholder with `mediaUrl: null`; stage 2 wires the
 * getBase64 → upload path.
 */
function normalizeEvolutionMessage(data: Record<string, unknown>): NormalizedInbound | null {
  const key = (data.key as EvolutionKey | undefined) ?? undefined
  if (!key?.id || key.fromMe) return null
  const remoteJid = String(key.remoteJid ?? '')
  const senderPn = String(key.senderPn ?? '')
  // WhatsApp now addresses many 1:1 chats with an opaque `@lid` id whose
  // leading number is NOT the real phone — the actual phone arrives in
  // `key.senderPn`. Prefer senderPn, fall back to a direct
  // `@s.whatsapp.net` remoteJid, and skip groups (@g.us), status
  // broadcasts, and any @lid we can't resolve to a phone.
  const phoneJid = senderPn.endsWith('@s.whatsapp.net')
    ? senderPn
    : remoteJid.endsWith('@s.whatsapp.net')
      ? remoteJid
      : ''
  if (!phoneJid) return null

  const fromPhone = phoneJid.split('@')[0]
  const providerMessageId = key.id
  const tsRaw = Number(data.messageTimestamp ?? 0)
  const timestampMs = tsRaw > 0 ? tsRaw * 1000 : new Date().getTime()
  const senderName = (data.pushName as string | undefined) || undefined
  let message = (data.message as Record<string, unknown> | undefined) ?? {}
  // Unwrap disappearing / view-once / caption envelopes so we see the
  // real inner payload (image, location, etc.).
  for (const wrap of [
    'ephemeralMessage',
    'viewOnceMessage',
    'viewOnceMessageV2',
    'viewOnceMessageV2Extension',
    'documentWithCaptionMessage',
  ]) {
    const inner = (message[wrap] as Record<string, unknown> | undefined)?.message as
      | Record<string, unknown>
      | undefined
    if (inner) message = inner
  }

  const base = {
    providerMessageId,
    fromPhone,
    senderName,
    timestampMs,
    mediaUrl: null as string | null,
    interactiveReplyId: null as string | null,
    replyToProviderMessageId: extractReplyToId(message),
  }

  // Reaction — not a message row.
  const reactionMessage = message.reactionMessage as Record<string, unknown> | undefined
  if (reactionMessage) {
    const rk = reactionMessage.key as EvolutionKey | undefined
    return {
      ...base,
      contentType: 'reaction',
      contentText: null,
      reaction: {
        targetProviderMessageId: String(rk?.id ?? ''),
        emoji: String(reactionMessage.text ?? ''),
      },
    }
  }

  // Interactive replies (buttons / list).
  const buttonsResp = message.buttonsResponseMessage as Record<string, unknown> | undefined
  if (buttonsResp) {
    return {
      ...base,
      contentType: 'interactive',
      contentText: String(buttonsResp.selectedDisplayText ?? ''),
      interactiveReplyId: String(buttonsResp.selectedButtonId ?? ''),
    }
  }
  const listResp = message.listResponseMessage as Record<string, unknown> | undefined
  if (listResp) {
    const single = listResp.singleSelectReply as Record<string, unknown> | undefined
    return {
      ...base,
      contentType: 'interactive',
      contentText: String(listResp.title ?? ''),
      interactiveReplyId: String(single?.selectedRowId ?? ''),
    }
  }

  // Location — store as a 'location' row with a readable summary.
  const locationMessage = message.locationMessage as Record<string, unknown> | undefined
  if (locationMessage) {
    const lat = locationMessage.degreesLatitude as number | undefined
    const lng = locationMessage.degreesLongitude as number | undefined
    const parts = [
      locationMessage.name as string | undefined,
      locationMessage.address as string | undefined,
      lat != null && lng != null ? `${lat}, ${lng}` : undefined,
    ].filter(Boolean)
    const coords = lat != null && lng != null ? ` https://maps.google.com/?q=${lat},${lng}` : ''
    return {
      ...base,
      contentType: 'location',
      contentText: `📍 ${parts.join(' — ') || 'Location'}${coords}`,
    }
  }

  // Contact (vCard) — no dedicated content_type, so render as text.
  const contactMessage = message.contactMessage as Record<string, unknown> | undefined
  if (contactMessage) {
    const name = (contactMessage.displayName as string | undefined) || 'Contact'
    const vcard = String(contactMessage.vcard ?? '')
    const tel = vcard.match(/TEL[^:]*:\s*([+\d][\d\s()-]+)/i)?.[1]?.trim()
    return {
      ...base,
      contentType: 'text',
      contentText: `👤 ${name}${tel ? ` — ${tel}` : ''}`,
    }
  }
  const contactsArrayMessage = message.contactsArrayMessage as Record<string, unknown> | undefined
  if (contactsArrayMessage) {
    const list = (contactsArrayMessage.contacts as Record<string, unknown>[] | undefined) ?? []
    const names = list.map((c) => c.displayName).filter(Boolean).join(', ')
    return { ...base, contentType: 'text', contentText: `👤 ${names || 'Contacts'}` }
  }

  // Media (bytes fetched by resolveInboundMedia before persistence).
  for (const [msgKey, contentType] of Object.entries(MEDIA_KINDS)) {
    const media = message[msgKey] as Record<string, unknown> | undefined
    if (media) {
      const caption = (media.caption as string | undefined) ?? null
      return { ...base, contentType, contentText: caption }
    }
  }

  // Plain text.
  const text =
    (message.conversation as string | undefined) ??
    ((message.extendedTextMessage as Record<string, unknown> | undefined)?.text as
      | string
      | undefined)
  if (typeof text === 'string') {
    return { ...base, contentType: 'text', contentText: text }
  }

  return null
}

const MEDIA_CONTENT_TYPES = new Set<InboundContentType>([
  'image', 'video', 'audio', 'document', 'sticker',
])

// MIME types the chat-media bucket accepts (migration 023). Storing
// anything else fails hard ("mime type X is not supported"), so we must
// coerce to one of these. This list is also XSS-safe: no text/html or
// image/svg+xml, so serving from the same origin can't execute script.
const BUCKET_ALLOWED_MIME = new Set<string>([
  'image/png', 'image/jpeg', 'image/webp',
  'video/mp4', 'video/3gpp',
  'application/pdf',
  'application/vnd.ms-powerpoint', 'application/msword', 'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'audio/ogg', 'audio/mpeg', 'audio/aac', 'audio/mp4', 'audio/amr',
])

// Per-content-type fallback when the reported mime is missing or the
// bucket won't accept it. Returns '' for documents with an unknown type
// (we can't safely store an arbitrary blob), which the caller skips.
const MIME_FALLBACK: Record<string, string> = {
  image: 'image/jpeg',
  sticker: 'image/webp',
  video: 'video/mp4',
  audio: 'audio/ogg',
  document: '',
}

/** Coerce a reported mime to a bucket-accepted one, or '' if unstorable. */
function resolveStoredMime(rawMime: string | undefined, contentType: InboundContentType): string {
  const m = (rawMime ?? '').split(';')[0].trim().toLowerCase()
  if (BUCKET_ALLOWED_MIME.has(m)) return m
  return MIME_FALLBACK[contentType] ?? ''
}

/** Read the real mimetype off whichever media sub-object the message carries. */
function mediaMimeFromMessage(message: Record<string, unknown>): string | undefined {
  for (const k of ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage']) {
    const o = message[k] as Record<string, unknown> | undefined
    if (o?.mimetype) return String(o.mimetype)
  }
  return undefined
}

/**
 * For a media/sticker inbound, fetch the bytes (inline base64 if present,
 * else Evolution's getBase64 endpoint), upload to chat-media, and set
 * `normalized.mediaUrl`. Stickers are also saved to the account library.
 * Best-effort: on failure the message is still stored (with a null URL).
 */
async function resolveInboundMedia(
  binding: EvolutionBinding,
  accountId: string,
  raw: Record<string, unknown>,
  normalized: NormalizedInbound,
): Promise<void> {
  try {
    const key = raw.key as EvolutionMessageKey
    const message = (raw.message as Record<string, unknown> | undefined) ?? {}
    // The reliable mime source is the media sub-object itself
    // (imageMessage.mimetype etc.), present whether or not base64 is inline.
    const subMime = mediaMimeFromMessage(message)
    const inline = message.base64 as string | undefined
    let b64 = inline ?? ''
    let mime = subMime
    if (!b64) {
      const r = await evoGetBase64FromMediaMessage({ ...binding, key })
      b64 = r.base64
      mime = subMime || r.mimetype
    }
    if (!b64) return
    const bytes = Buffer.from(b64, 'base64')
    // Coerce to a bucket-accepted (and XSS-safe) content-type. Stickers
    // are always webp. Documents with an unknown type can't be stored.
    const storedMime =
      normalized.contentType === 'sticker'
        ? 'image/webp'
        : resolveStoredMime(mime, normalized.contentType)
    if (!storedMime) {
      console.warn('[evolution-webhook] unstorable media mime, skipping:', mime)
      return
    }
    const ext = extFromMime(storedMime, normalized.contentType)
    const up = await uploadAccountMediaServer({
      bucket: CHAT_MEDIA_BUCKET,
      accountId,
      bytes,
      fileName: `evo-${normalized.providerMessageId}.${ext}`,
      contentType: storedMime,
    })
    normalized.mediaUrl = up.publicUrl
    if (normalized.contentType === 'sticker') {
      await supabaseAdmin()
        .from('stickers')
        .upsert(
          { account_id: accountId, media_url: up.publicUrl, mime: storedMime },
          { onConflict: 'account_id,media_url' },
        )
    }
  } catch (err) {
    console.error('[evolution-webhook] media resolve failed:', err)
  }
}

/** Map Evolution / Baileys ack values onto messages.status. */
function mapEvolutionStatus(raw: unknown): string | null {
  const s = String(raw ?? '').toUpperCase()
  if (s === 'PENDING' || s === 'SERVER_ACK' || s === '1' || s === '0') return 'sent'
  if (s === 'DELIVERY_ACK' || s === 'DELIVERED' || s === '2') return 'delivered'
  if (s === 'READ' || s === 'PLAYED' || s === '3' || s === '4') return 'read'
  if (s === 'ERROR' || s === 'FAILED') return 'failed'
  return null
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  // ---- auth: match webhook_secret, then cross-check apikey + instance
  const { data: config } = await supabaseAdmin()
    .from('whatsapp_config')
    .select('id, account_id, user_id, provider, base_url, instance_name, api_key')
    .eq('webhook_secret', token)
    .eq('provider', 'evolution')
    .maybeSingle()

  if (!config) {
    return NextResponse.json({ error: 'unknown webhook' }, { status: 401 })
  }

  // Primary authentication is the unguessable per-config `webhook_secret`
  // in the URL path (matched by the lookup above). As a cheap extra sanity
  // check, if the payload names an instance it must be ours.
  //
  // We deliberately do NOT require the payload/header `apikey` to match the
  // stored key: Evolution sends the *instance* api key (which can differ
  // from the global key the user pasted) and some versions omit it
  // entirely — requiring a match silently dropped every inbound event.
  const instanceMatches =
    !body.instance || body.instance === config.instance_name
  if (!instanceMatches) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let apiKey = ''
  try {
    apiKey = decrypt(config.api_key as string)
  } catch {
    return NextResponse.json({ error: 'config error' }, { status: 500 })
  }

  const accountId = config.account_id as string
  const ownerUserId = config.user_id as string
  const binding: EvolutionBinding = {
    baseUrl: config.base_url as string,
    instance: config.instance_name as string,
    apiKey,
  }
  const event = normEvent(body.event)
  const data = body.data

  after(async () => {
    try {
      console.log(
        `[evolution-webhook] event=${event} instance=${String(body.instance ?? '')}`,
      )
      if (event === 'MESSAGES_UPSERT') {
        const messages: Record<string, unknown>[] = Array.isArray(data)
          ? (data as Record<string, unknown>[])
          : data && typeof data === 'object' && 'messages' in (data as object)
            ? ((data as { messages: Record<string, unknown>[] }).messages ?? [])
            : data
              ? [data as Record<string, unknown>]
              : []
        for (const m of messages) {
          const normalized = normalizeEvolutionMessage(m)
          if (normalized) {
            if (MEDIA_CONTENT_TYPES.has(normalized.contentType) && !normalized.mediaUrl) {
              await resolveInboundMedia(binding, accountId, m, normalized)
            }
            await processInboundMessage({
              accountId,
              ownerUserId,
              provider: 'evolution',
              msg: normalized,
            })
          }
        }
      } else if (event === 'MESSAGES_UPDATE') {
        const updates: Record<string, unknown>[] = Array.isArray(data)
          ? (data as Record<string, unknown>[])
          : data
            ? [data as Record<string, unknown>]
            : []
        for (const u of updates) {
          const key = u.key as EvolutionKey | undefined
          const providerMessageId = (u.keyId as string | undefined) ?? key?.id
          const status = mapEvolutionStatus(
            u.status ?? (u.update as Record<string, unknown> | undefined)?.status,
          )
          if (providerMessageId && status) {
            await handleProviderStatusUpdate({
              providerMessageId,
              status,
              timestampMs: new Date().getTime(),
            })
          }
        }
      } else if (event === 'MESSAGES_DELETE') {
        const deletes: Record<string, unknown>[] = Array.isArray(data)
          ? (data as Record<string, unknown>[])
          : data
            ? [data as Record<string, unknown>]
            : []
        for (const d of deletes) {
          const key = d.key as EvolutionKey | undefined
          const providerMessageId = (d.keyId as string | undefined) ?? key?.id
          if (providerMessageId) {
            await markMessageDeletedByProviderId({ providerMessageId })
          }
        }
      } else if (event === 'CONNECTION_UPDATE') {
        const state = String(
          (data as Record<string, unknown> | undefined)?.state ?? 'unknown',
        )
        await supabaseAdmin()
          .from('whatsapp_config')
          .update({
            evolution_state: state,
            status: state === 'open' ? 'connected' : 'disconnected',
            ...(state === 'open' ? { connected_at: new Date().toISOString() } : {}),
          })
          .eq('id', config.id)
      } else if (event === 'QRCODE_UPDATED') {
        const qr =
          ((data as Record<string, unknown> | undefined)?.qrcode as
            | Record<string, unknown>
            | undefined) ?? (data as Record<string, unknown> | undefined)
        const base64 = qr?.base64 as string | undefined
        if (base64) {
          await supabaseAdmin()
            .from('whatsapp_config')
            .update({ qr_code: base64 })
            .eq('id', config.id)
        }
      }
    } catch (err) {
      console.error('[evolution-webhook] processing failed:', err)
    }
  })

  return NextResponse.json({ status: 'received' })
}
