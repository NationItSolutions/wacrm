/**
 * Evolution API helpers (self-hosted WhatsApp via Baileys).
 *
 * Sibling to `meta-api.ts`. Every function takes a single named-args
 * object; the first field group is always the instance binding
 * `{ baseUrl, instance, apiKey }`. Auth is the `apikey` header (global
 * or per-instance key). Errors throw a plain `Error` with the server's
 * message, matching `meta-api.ts`'s convention so callers can keep
 * pattern-matching on `err.message`.
 *
 * Evolution's REST surface varies slightly across versions; response
 * parsing is defensive (multiple fallbacks for the sent-message id).
 */

export interface EvolutionBinding {
  baseUrl: string
  instance: string
  apiKey: string
}

export interface EvolutionSendResult {
  messageId: string
}

/** A Baileys message key — needed for reactions, quoted replies, deletes, media fetch. */
export interface EvolutionMessageKey {
  id: string
  remoteJid: string
  fromMe: boolean
  participant?: string
}

/** Strip everything but digits — Evolution's `number` wants CC+number, no '+'. */
export function toEvolutionNumber(phone: string): string {
  return phone.replace(/\D/g, '')
}

/** Build the individual-chat JID Evolution uses in keys. */
export function toRemoteJid(phone: string): string {
  return `${toEvolutionNumber(phone)}@s.whatsapp.net`
}

function trimBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

interface EvolutionErrorBody {
  message?: unknown
  error?: unknown
  response?: { message?: unknown }
}

async function throwEvolutionError(response: Response, fallback: string): Promise<never> {
  let message = fallback
  try {
    const data = (await response.json()) as EvolutionErrorBody
    const raw =
      data?.response?.message ?? data?.message ?? data?.error ?? null
    if (raw) message = Array.isArray(raw) ? raw.join('; ') : String(raw)
  } catch {
    // body wasn't JSON — keep the fallback
  }
  throw new Error(`Evolution API error: ${message}`)
}

async function evoFetch(
  binding: EvolutionBinding,
  path: string,
  init: { method: string; body?: unknown },
): Promise<unknown> {
  const url = `${trimBaseUrl(binding.baseUrl)}${path}`
  const response = await fetch(url, {
    method: init.method,
    headers: {
      'Content-Type': 'application/json',
      apikey: binding.apiKey,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  if (!response.ok) {
    await throwEvolutionError(response, `${response.status} ${response.statusText}`)
  }
  // Some endpoints (e.g. delete) return empty bodies.
  const text = await response.text()
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text }
  }
}

/** Pull the sent-message id from Evolution's varied response shapes. */
function extractMessageId(data: unknown): string {
  const d = data as Record<string, unknown> | null
  const key = d?.key as Record<string, unknown> | undefined
  const nestedKey = (d?.message as Record<string, unknown> | undefined)?.key as
    | Record<string, unknown>
    | undefined
  const id =
    (key?.id as string | undefined) ??
    (d?.messageId as string | undefined) ??
    (d?.id as string | undefined) ??
    (nestedKey?.id as string | undefined)
  return id ?? ''
}

// ============================================================
// Messaging
// ============================================================

export interface EvolutionQuoted {
  key: { id: string; remoteJid: string; fromMe: boolean }
}

export interface EvoSendTextArgs extends EvolutionBinding {
  to: string
  text: string
  quoted?: EvolutionQuoted
}
export async function evoSendText(args: EvoSendTextArgs): Promise<EvolutionSendResult> {
  const { baseUrl, instance, apiKey, to, text, quoted } = args
  const data = await evoFetch({ baseUrl, instance, apiKey }, `/message/sendText/${instance}`, {
    method: 'POST',
    body: { number: toEvolutionNumber(to), text, ...(quoted ? { quoted } : {}) },
  })
  return { messageId: extractMessageId(data) }
}

export type EvolutionMediaType = 'image' | 'video' | 'document'

export interface EvoSendMediaArgs extends EvolutionBinding {
  to: string
  mediatype: EvolutionMediaType
  media: string // public URL
  caption?: string
  fileName?: string
  quoted?: EvolutionQuoted
}
export async function evoSendMedia(args: EvoSendMediaArgs): Promise<EvolutionSendResult> {
  const { baseUrl, instance, apiKey, to, mediatype, media, caption, fileName, quoted } = args
  const data = await evoFetch({ baseUrl, instance, apiKey }, `/message/sendMedia/${instance}`, {
    method: 'POST',
    body: {
      number: toEvolutionNumber(to),
      mediatype,
      media,
      ...(caption ? { caption } : {}),
      ...(fileName ? { fileName } : {}),
      ...(quoted ? { quoted } : {}),
    },
  })
  return { messageId: extractMessageId(data) }
}

export interface EvoSendAudioArgs extends EvolutionBinding {
  to: string
  audio: string // public URL
  quoted?: EvolutionQuoted
}
export async function evoSendAudio(args: EvoSendAudioArgs): Promise<EvolutionSendResult> {
  const { baseUrl, instance, apiKey, to, audio, quoted } = args
  const data = await evoFetch(
    { baseUrl, instance, apiKey },
    `/message/sendWhatsAppAudio/${instance}`,
    { method: 'POST', body: { number: toEvolutionNumber(to), audio, ...(quoted ? { quoted } : {}) } },
  )
  return { messageId: extractMessageId(data) }
}

export interface EvoSendStickerArgs extends EvolutionBinding {
  to: string
  sticker: string // public URL of a .webp
  quoted?: EvolutionQuoted
}
export async function evoSendSticker(args: EvoSendStickerArgs): Promise<EvolutionSendResult> {
  const { baseUrl, instance, apiKey, to, sticker, quoted } = args
  const data = await evoFetch({ baseUrl, instance, apiKey }, `/message/sendSticker/${instance}`, {
    method: 'POST',
    body: { number: toEvolutionNumber(to), sticker, ...(quoted ? { quoted } : {}) },
  })
  return { messageId: extractMessageId(data) }
}

export interface EvoSendReactionArgs extends EvolutionBinding {
  to: string
  targetMessageId: string
  targetFromMe: boolean
  reaction: string
}
export async function evoSendReaction(args: EvoSendReactionArgs): Promise<EvolutionSendResult> {
  const { baseUrl, instance, apiKey, to, targetMessageId, targetFromMe, reaction } = args
  const data = await evoFetch({ baseUrl, instance, apiKey }, `/message/sendReaction/${instance}`, {
    method: 'POST',
    body: {
      key: { remoteJid: toRemoteJid(to), fromMe: targetFromMe, id: targetMessageId },
      reaction,
    },
  })
  return { messageId: extractMessageId(data) }
}

export interface EvoDeleteMessageArgs extends EvolutionBinding {
  to: string
  targetMessageId: string
  fromMe: boolean
}
export async function evoDeleteMessage(args: EvoDeleteMessageArgs): Promise<void> {
  const { baseUrl, instance, apiKey, to, targetMessageId, fromMe } = args
  await evoFetch(
    { baseUrl, instance, apiKey },
    `/chat/deleteMessageForEveryone/${instance}`,
    {
      method: 'DELETE',
      body: { id: targetMessageId, remoteJid: toRemoteJid(to), fromMe },
    },
  )
}

export interface EvoMarkReadArgs extends EvolutionBinding {
  key: EvolutionMessageKey
}
export async function evoMarkRead(args: EvoMarkReadArgs): Promise<void> {
  const { baseUrl, instance, apiKey, key } = args
  await evoFetch({ baseUrl, instance, apiKey }, `/chat/markMessageAsRead/${instance}`, {
    method: 'POST',
    body: { readMessages: [{ remoteJid: key.remoteJid, fromMe: key.fromMe, id: key.id }] },
  })
}

// ============================================================
// Media download (inbound)
// ============================================================

export interface EvoGetBase64Args extends EvolutionBinding {
  key: EvolutionMessageKey
  /** Some versions want the whole message object; the key is enough on v2. */
  convertToMp4?: boolean
}
export interface EvoBase64Result {
  base64: string
  mimetype?: string
  fileName?: string
}
export async function evoGetBase64FromMediaMessage(
  args: EvoGetBase64Args,
): Promise<EvoBase64Result> {
  const { baseUrl, instance, apiKey, key, convertToMp4 } = args
  const data = (await evoFetch(
    { baseUrl, instance, apiKey },
    `/chat/getBase64FromMediaMessage/${instance}`,
    { method: 'POST', body: { message: { key }, convertToMp4: convertToMp4 ?? false } },
  )) as Record<string, unknown>
  return {
    base64: String(data.base64 ?? ''),
    mimetype: (data.mimetype as string | undefined) ?? undefined,
    fileName: (data.fileName as string | undefined) ?? undefined,
  }
}

// ============================================================
// Instance lifecycle / connection
// ============================================================

export interface EvoConnectionState {
  state: string // open | connecting | close | unknown
}
export async function evoConnectionState(binding: EvolutionBinding): Promise<EvoConnectionState> {
  const data = (await evoFetch(binding, `/instance/connectionState/${binding.instance}`, {
    method: 'GET',
  })) as Record<string, unknown>
  const inner = (data.instance as Record<string, unknown> | undefined) ?? data
  return { state: String((inner?.state as string | undefined) ?? 'unknown') }
}

export interface EvoConnectResult {
  base64?: string
  code?: string
  pairingCode?: string
}
export async function evoConnect(binding: EvolutionBinding): Promise<EvoConnectResult> {
  const data = (await evoFetch(binding, `/instance/connect/${binding.instance}`, {
    method: 'GET',
  })) as Record<string, unknown>
  const qr = (data.qrcode as Record<string, unknown> | undefined) ?? data
  return {
    base64: (qr?.base64 as string | undefined) ?? undefined,
    code: (qr?.code as string | undefined) ?? undefined,
    pairingCode: (qr?.pairingCode as string | undefined) ?? undefined,
  }
}

export interface EvoCreateInstanceArgs extends EvolutionBinding {
  token?: string
}
export async function evoCreateInstance(args: EvoCreateInstanceArgs): Promise<unknown> {
  const { baseUrl, instance, apiKey, token } = args
  return evoFetch({ baseUrl, instance, apiKey }, `/instance/create`, {
    method: 'POST',
    body: {
      instanceName: instance,
      integration: 'WHATSAPP-BAILEYS',
      qrcode: true,
      ...(token ? { token } : {}),
    },
  })
}

export interface EvoSetWebhookArgs extends EvolutionBinding {
  url: string
  events: string[]
}
export async function evoSetWebhook(args: EvoSetWebhookArgs): Promise<unknown> {
  const { baseUrl, instance, apiKey, url, events } = args
  // v2 nested shape. `webhookByEvents:false` = single URL for all events;
  // `base64:true` asks Evolution to inline media as base64 in webhooks.
  return evoFetch({ baseUrl, instance, apiKey }, `/webhook/set/${instance}`, {
    method: 'POST',
    body: {
      webhook: {
        enabled: true,
        url,
        events,
        webhookByEvents: false,
        webhookBase64: true,
      },
    },
  })
}
