/**
 * Render a template row to plain text (and an optional media header) for
 * the Evolution provider.
 *
 * Meta stores the approved template server-side and only needs the
 * variable *values* at send time (see `template-send-builder.ts`).
 * Evolution has no server-side template — the local row IS the template,
 * so we materialise the whole message here: substitute {{N}} variables,
 * inline the header/footer, and flatten buttons to text lines (Baileys
 * native interactive is unreliable — same rationale as the interactive
 * methods on the Evolution adapter).
 */

import type { MessageTemplate } from '@/types';

export interface EvolutionRenderParams {
  /** Values for body {{1}}, {{2}}, … indexed by variable position. */
  body?: string[];
  /** Value for a {{1}} in a TEXT header. */
  headerText?: string;
  /** Override the template's stored media-header URL for this send. */
  headerMediaUrl?: string;
  /** Per-button overrides keyed by the button's index (URL {{1}}, COPY_CODE). */
  buttonParams?: Record<number, string>;
}

export interface RenderedEvolutionTemplate {
  /** The full message text (header + body + footer + buttons). */
  text: string;
  /** Set when the template has a media header — send via `evoSendMedia`. */
  media?: { kind: 'image' | 'video' | 'document'; url: string };
}

/** Replace {{1}}, {{2}}… (1-indexed) with values; keep {{N}} literal when unfilled. */
function substitute(text: string, values: (string | undefined)[]): string {
  return text.replace(/\{\{(\d+)\}\}/g, (match, raw: string) => {
    const value = values[Number(raw) - 1];
    return value && value.trim().length > 0 ? value : match;
  });
}

export function renderEvolutionTemplate(
  template: MessageTemplate,
  params: EvolutionRenderParams = {},
): RenderedEvolutionTemplate {
  const blocks: string[] = [];

  // 1. Header — TEXT renders bold at the top; media rides along separately.
  let media: RenderedEvolutionTemplate['media'];
  if (template.header_type === 'text' && template.header_content) {
    blocks.push(`*${substitute(template.header_content, [params.headerText])}*`);
  } else if (template.header_type && template.header_type !== 'text') {
    const url = params.headerMediaUrl ?? template.header_media_url;
    if (url) media = { kind: template.header_type, url };
  }

  // 2. Body (required).
  blocks.push(substitute(template.body_text, params.body ?? []));

  // 3. Footer.
  if (template.footer_text) blocks.push(template.footer_text);

  // 4. Buttons → text lines.
  const buttonLines: string[] = [];
  (template.buttons ?? []).forEach((button, index) => {
    const override = params.buttonParams?.[index];
    switch (button.type) {
      case 'QUICK_REPLY':
        buttonLines.push(`▸ ${button.text}`);
        break;
      case 'URL':
        buttonLines.push(`${button.text}: ${substitute(button.url, [override])}`);
        break;
      case 'PHONE_NUMBER':
        buttonLines.push(`${button.text}: ${button.phone_number}`);
        break;
      case 'COPY_CODE':
        buttonLines.push(`${button.text}: ${override?.trim() || button.example}`);
        break;
    }
  });
  if (buttonLines.length) blocks.push(buttonLines.join('\n'));

  return { text: blocks.filter(Boolean).join('\n\n'), media };
}
