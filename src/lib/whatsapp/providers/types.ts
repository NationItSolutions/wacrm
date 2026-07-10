// ============================================================
// WhatsApp provider abstraction.
//
// wacrm speaks to WhatsApp through one of two backends:
//   - 'meta'      — the official Meta Cloud API (graph.facebook.com)
//   - 'evolution' — a self-hosted Evolution API (Baileys) instance
//
// Every outbound send goes through a `WhatsAppProvider` bound to a
// single account's credentials. The Meta adapter is a pass-through
// over `meta-api.ts`; the Evolution adapter wraps `evolution-api.ts`.
// A `getProvider(config)` factory (./index) picks the adapter from
// `whatsapp_config.provider`.
//
// Design goals:
//   - The Meta path behaves BYTE-IDENTICALLY to before — the adapter
//     only injects credentials and forwards. The phone-variant retry,
//     wamid capture, and DB persistence stay in the callers.
//   - Capability flags let call sites gate provider-specific features
//     (templates, interactive, the 24h window, delete, stickers)
//     without sniffing `provider` strings everywhere.
// ============================================================

import type {
  MediaKind,
  InteractiveButton,
  InteractiveListSection,
  MetaSendResult,
} from '@/lib/whatsapp/meta-api'
import type { SendTimeParams } from '@/lib/whatsapp/template-send-builder'
import type { MessageTemplate } from '@/types'

export type ProviderId = 'meta' | 'evolution'

/** Same shape `meta-api.ts` returns — the provider's message id (wamid / Baileys key id). */
export type ProviderSendResult = MetaSendResult

/**
 * A reference to a previously-exchanged message being replied to.
 * Meta only needs the provider message id (`context.message_id`);
 * Evolution needs to reconstruct the full quoted key, which also
 * requires whether *we* sent the quoted message (`fromMe`).
 */
export interface ReplyRef {
  providerMessageId: string
  fromMe: boolean
}

export interface ProviderCapabilities {
  /** Meta-approved message templates (create/submit/send). Meta only. */
  supportsTemplates: boolean
  /** Native interactive buttons/lists. Meta only; Evolution degrades to numbered text. */
  supportsInteractive: boolean
  /** The 24-hour customer-service window gating free-form sends. Meta only. */
  has24hWindow: boolean
  supportsReactions: boolean
  /** Quoted replies. Both — Evolution reconstructs the quoted key. */
  supportsReplyContext: boolean
  /** delete-for-everyone. Evolution only (Meta has no delete API). */
  supportsDeleteMessage: boolean
  /** First-class sticker sends. Evolution only for now. */
  supportsStickers: boolean
}

export interface SendTextArgs {
  to: string
  text: string
  replyTo?: ReplyRef
}

export interface SendMediaArgs {
  to: string
  kind: MediaKind
  /** Public URL the provider fetches at send time. */
  link: string
  caption?: string
  filename?: string
  replyTo?: ReplyRef
}

export interface SendStickerArgs {
  to: string
  /** Public URL of a .webp sticker. */
  link: string
  replyTo?: ReplyRef
}

export interface SendReactionArgs {
  to: string
  targetMessageId: string
  /** Whether the reacted-to message was sent by us. Meta ignores this; Evolution needs it. */
  targetFromMe?: boolean
  /** Single emoji, or empty string to remove. */
  emoji: string
}

export interface SendInteractiveButtonsArgs {
  to: string
  bodyText: string
  headerText?: string
  footerText?: string
  buttons: InteractiveButton[]
  replyTo?: ReplyRef
}

export interface SendInteractiveListArgs {
  to: string
  bodyText: string
  buttonLabel: string
  headerText?: string
  footerText?: string
  sections: InteractiveListSection[]
  replyTo?: ReplyRef
}

export interface SendTemplateArgs {
  to: string
  templateName: string
  language?: string
  params?: string[]
  template?: MessageTemplate
  messageParams?: SendTimeParams
  replyTo?: ReplyRef
}

export interface DeleteMessageArgs {
  to: string
  providerMessageId: string
  fromMe: boolean
}

export interface WhatsAppProvider {
  readonly id: ProviderId
  readonly capabilities: ProviderCapabilities

  sendText(args: SendTextArgs): Promise<ProviderSendResult>
  sendMedia(args: SendMediaArgs): Promise<ProviderSendResult>
  sendReaction(args: SendReactionArgs): Promise<ProviderSendResult>
  sendInteractiveButtons(args: SendInteractiveButtonsArgs): Promise<ProviderSendResult>
  sendInteractiveList(args: SendInteractiveListArgs): Promise<ProviderSendResult>

  /** Present only when `capabilities.supportsStickers`. */
  sendSticker?(args: SendStickerArgs): Promise<ProviderSendResult>
  /** Present only when `capabilities.supportsTemplates`. */
  sendTemplate?(args: SendTemplateArgs): Promise<ProviderSendResult>
  /** Present only when `capabilities.supportsDeleteMessage`. */
  deleteMessage?(args: DeleteMessageArgs): Promise<void>
  /** Best-effort read receipt. Optional per provider. */
  markRead?(args: { providerMessageId: string; remoteJid?: string }): Promise<void>
}
