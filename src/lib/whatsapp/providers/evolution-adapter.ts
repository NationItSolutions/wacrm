// ============================================================
// Evolution API adapter.
//
// Wraps `evolution-api.ts`, bound to one account's
// { baseUrl, instance, apiKey }. Maps the provider-neutral interface
// onto Evolution's REST surface:
//   - `replyTo` → Evolution `quoted.key` (reconstructed from the stored
//     provider message id + the recipient JID + fromMe).
//   - interactive buttons/lists → a numbered plain-text menu (Baileys
//     native interactive is unreliable), so the customer can reply with
//     the number/label and it flows through as text.
// ============================================================

import {
  evoSendText,
  evoSendMedia,
  evoSendAudio,
  evoSendSticker,
  evoSendReaction,
  evoDeleteMessage,
  toRemoteJid,
  type EvolutionQuoted,
} from '@/lib/whatsapp/evolution-api'
import { renderEvolutionTemplate } from '@/lib/whatsapp/template-render'
import type {
  WhatsAppProvider,
  ProviderCapabilities,
  ProviderSendResult,
  ReplyRef,
  SendTextArgs,
  SendMediaArgs,
  SendStickerArgs,
  SendReactionArgs,
  SendInteractiveButtonsArgs,
  SendInteractiveListArgs,
  SendTemplateArgs,
  DeleteMessageArgs,
} from './types'

const EVOLUTION_CAPABILITIES: ProviderCapabilities = {
  // Local, unapproved templates: the row is rendered to text/media at
  // send time (renderEvolutionTemplate) rather than submitted to Meta.
  supportsTemplates: true,
  supportsInteractive: false, // degraded to numbered text below
  has24hWindow: false,
  supportsReactions: true,
  supportsReplyContext: true,
  supportsDeleteMessage: true,
  supportsStickers: true,
}

export interface EvolutionProviderCreds {
  baseUrl: string
  instance: string
  apiKey: string
}

export class EvolutionProvider implements WhatsAppProvider {
  readonly id = 'evolution' as const
  readonly capabilities = EVOLUTION_CAPABILITIES

  private readonly baseUrl: string
  private readonly instance: string
  private readonly apiKey: string

  constructor(creds: EvolutionProviderCreds) {
    this.baseUrl = creds.baseUrl
    this.instance = creds.instance
    this.apiKey = creds.apiKey
  }

  private get base() {
    return { baseUrl: this.baseUrl, instance: this.instance, apiKey: this.apiKey }
  }

  /** Reconstruct Evolution's quoted-message key from a stored reply ref + recipient. */
  private quoted(to: string, replyTo?: ReplyRef): EvolutionQuoted | undefined {
    if (!replyTo?.providerMessageId) return undefined
    return {
      key: {
        id: replyTo.providerMessageId,
        remoteJid: toRemoteJid(to),
        fromMe: replyTo.fromMe,
      },
    }
  }

  sendText(a: SendTextArgs): Promise<ProviderSendResult> {
    return evoSendText({ ...this.base, to: a.to, text: a.text, quoted: this.quoted(a.to, a.replyTo) })
  }

  sendMedia(a: SendMediaArgs): Promise<ProviderSendResult> {
    const quoted = this.quoted(a.to, a.replyTo)
    if (a.kind === 'audio') {
      return evoSendAudio({ ...this.base, to: a.to, audio: a.link, quoted })
    }
    return evoSendMedia({
      ...this.base,
      to: a.to,
      mediatype: a.kind, // image | video | document
      media: a.link,
      caption: a.caption,
      fileName: a.filename,
      quoted,
    })
  }

  // Evolution has no server-side templates — the local row IS the
  // template. Render it to text (+ optional media header) and send.
  // async so the missing-row guard rejects rather than throwing
  // synchronously (the method's contract is to return a Promise).
  async sendTemplate(a: SendTemplateArgs): Promise<ProviderSendResult> {
    if (!a.template) {
      throw new Error(
        'Evolution template not found locally — create it in Settings → Templates.',
      )
    }
    const rendered = renderEvolutionTemplate(a.template, {
      body: a.messageParams?.body ?? a.params,
      headerText: a.messageParams?.headerText,
      headerMediaUrl: a.messageParams?.headerMediaUrl,
      buttonParams: a.messageParams?.buttonParams,
    })
    const quoted = this.quoted(a.to, a.replyTo)
    if (rendered.media) {
      return evoSendMedia({
        ...this.base,
        to: a.to,
        mediatype: rendered.media.kind,
        media: rendered.media.url,
        caption: rendered.text || undefined,
        quoted,
      })
    }
    return evoSendText({ ...this.base, to: a.to, text: rendered.text, quoted })
  }

  sendSticker(a: SendStickerArgs): Promise<ProviderSendResult> {
    return evoSendSticker({
      ...this.base,
      to: a.to,
      sticker: a.link,
      quoted: this.quoted(a.to, a.replyTo),
    })
  }

  sendReaction(a: SendReactionArgs): Promise<ProviderSendResult> {
    return evoSendReaction({
      ...this.base,
      to: a.to,
      targetMessageId: a.targetMessageId,
      targetFromMe: a.targetFromMe ?? false,
      reaction: a.emoji,
    })
  }

  // Baileys interactive is unreliable — render a numbered text menu so
  // the customer replies with a number/label, which the inbound path
  // treats as a normal text reply.
  sendInteractiveButtons(a: SendInteractiveButtonsArgs): Promise<ProviderSendResult> {
    const lines = a.buttons.map((b, i) => `${i + 1}) ${b.title}`)
    const text = [a.headerText, a.bodyText, lines.join('\n'), a.footerText]
      .filter(Boolean)
      .join('\n\n')
    return evoSendText({ ...this.base, to: a.to, text, quoted: this.quoted(a.to, a.replyTo) })
  }

  sendInteractiveList(a: SendInteractiveListArgs): Promise<ProviderSendResult> {
    const rows: string[] = []
    let n = 1
    for (const section of a.sections) {
      if (section.title) rows.push(`*${section.title}*`)
      for (const row of section.rows) {
        rows.push(`${n}) ${row.title}${row.description ? ` — ${row.description}` : ''}`)
        n += 1
      }
    }
    const text = [a.headerText, a.bodyText, rows.join('\n'), a.footerText]
      .filter(Boolean)
      .join('\n\n')
    return evoSendText({ ...this.base, to: a.to, text, quoted: this.quoted(a.to, a.replyTo) })
  }

  deleteMessage(a: DeleteMessageArgs): Promise<void> {
    return evoDeleteMessage({
      ...this.base,
      to: a.to,
      targetMessageId: a.providerMessageId,
      fromMe: a.fromMe,
    })
  }
}
