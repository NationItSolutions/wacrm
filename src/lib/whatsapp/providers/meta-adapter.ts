// ============================================================
// Meta Cloud API adapter.
//
// A thin pass-through over `meta-api.ts`: it closes over one account's
// { phoneNumberId, accessToken } and forwards each call 1:1, injecting
// the credentials and mapping the provider-neutral `replyTo` to Meta's
// `contextMessageId`. Behaviour and return shape are identical to the
// pre-abstraction inline calls — this is a credential shim, not new
// logic.
// ============================================================

import {
  sendTextMessage,
  sendMediaMessage,
  sendTemplateMessage,
  sendReactionMessage,
  sendInteractiveButtons as metaSendInteractiveButtons,
  sendInteractiveList as metaSendInteractiveList,
} from '@/lib/whatsapp/meta-api'
import type {
  WhatsAppProvider,
  ProviderCapabilities,
  ProviderSendResult,
  SendTextArgs,
  SendMediaArgs,
  SendReactionArgs,
  SendInteractiveButtonsArgs,
  SendInteractiveListArgs,
  SendTemplateArgs,
} from './types'

const META_CAPABILITIES: ProviderCapabilities = {
  supportsTemplates: true,
  supportsInteractive: true,
  has24hWindow: true,
  supportsReactions: true,
  supportsReplyContext: true,
  supportsDeleteMessage: false,
  supportsStickers: false,
}

export interface MetaProviderCreds {
  phoneNumberId: string
  accessToken: string
}

export class MetaProvider implements WhatsAppProvider {
  readonly id = 'meta' as const
  readonly capabilities = META_CAPABILITIES

  private readonly phoneNumberId: string
  private readonly accessToken: string

  constructor(creds: MetaProviderCreds) {
    this.phoneNumberId = creds.phoneNumberId
    this.accessToken = creds.accessToken
  }

  private get base() {
    return { phoneNumberId: this.phoneNumberId, accessToken: this.accessToken }
  }

  sendText(a: SendTextArgs): Promise<ProviderSendResult> {
    return sendTextMessage({
      ...this.base,
      to: a.to,
      text: a.text,
      contextMessageId: a.replyTo?.providerMessageId,
    })
  }

  sendMedia(a: SendMediaArgs): Promise<ProviderSendResult> {
    return sendMediaMessage({
      ...this.base,
      to: a.to,
      kind: a.kind,
      link: a.link,
      caption: a.caption,
      filename: a.filename,
      contextMessageId: a.replyTo?.providerMessageId,
    })
  }

  sendReaction(a: SendReactionArgs): Promise<ProviderSendResult> {
    return sendReactionMessage({
      ...this.base,
      to: a.to,
      targetMessageId: a.targetMessageId,
      emoji: a.emoji,
    })
  }

  sendInteractiveButtons(a: SendInteractiveButtonsArgs): Promise<ProviderSendResult> {
    return metaSendInteractiveButtons({
      ...this.base,
      to: a.to,
      bodyText: a.bodyText,
      headerText: a.headerText,
      footerText: a.footerText,
      buttons: a.buttons,
      contextMessageId: a.replyTo?.providerMessageId,
    })
  }

  sendInteractiveList(a: SendInteractiveListArgs): Promise<ProviderSendResult> {
    return metaSendInteractiveList({
      ...this.base,
      to: a.to,
      bodyText: a.bodyText,
      buttonLabel: a.buttonLabel,
      headerText: a.headerText,
      footerText: a.footerText,
      sections: a.sections,
      contextMessageId: a.replyTo?.providerMessageId,
    })
  }

  sendTemplate(a: SendTemplateArgs): Promise<ProviderSendResult> {
    return sendTemplateMessage({
      ...this.base,
      to: a.to,
      templateName: a.templateName,
      language: a.language,
      params: a.params,
      template: a.template,
      messageParams: a.messageParams,
      contextMessageId: a.replyTo?.providerMessageId,
    })
  }
}
