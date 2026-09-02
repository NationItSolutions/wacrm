import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { MessageTemplate } from '@/types';

// Mock the low-level Evolution REST client so we assert on the calls the
// adapter makes, without any network.
vi.mock('@/lib/whatsapp/evolution-api', () => ({
  evoSendText: vi.fn(async () => ({ messageId: 'txt-1' })),
  evoSendMedia: vi.fn(async () => ({ messageId: 'media-1' })),
  evoSendAudio: vi.fn(async () => ({ messageId: 'audio-1' })),
  evoSendSticker: vi.fn(async () => ({ messageId: 'stk-1' })),
  evoSendReaction: vi.fn(async () => ({ messageId: 'rxn-1' })),
  evoDeleteMessage: vi.fn(async () => undefined),
  toRemoteJid: (phone: string) => `${phone}@s.whatsapp.net`,
}));

import { evoSendText, evoSendMedia } from '@/lib/whatsapp/evolution-api';
import { EvolutionProvider } from './evolution-adapter';

const creds = { baseUrl: 'https://evo.test', instance: 'inst', apiKey: 'k' };

function row(overrides: Partial<MessageTemplate> = {}): MessageTemplate {
  return {
    id: 'row-1',
    user_id: 'user-1',
    name: 'promo',
    category: 'Marketing',
    language: 'en_US',
    provider: 'evolution',
    body_text: 'Hi {{1}}',
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('EvolutionProvider capabilities', () => {
  it('advertises template support (local rendering)', () => {
    const p = new EvolutionProvider(creds);
    expect(p.capabilities.supportsTemplates).toBe(true);
    expect(typeof p.sendTemplate).toBe('function');
  });
});

describe('EvolutionProvider.sendTemplate', () => {
  it('renders a text template and sends via evoSendText', async () => {
    const p = new EvolutionProvider(creds);
    const result = await p.sendTemplate({
      to: '595991',
      templateName: 'promo',
      template: row(),
      params: ['Ana'],
    });
    expect(result.messageId).toBe('txt-1');
    expect(evoSendMedia).not.toHaveBeenCalled();
    expect(evoSendText).toHaveBeenCalledWith(
      expect.objectContaining({ to: '595991', text: 'Hi Ana' }),
    );
  });

  it('prefers messageParams.body over positional params', async () => {
    const p = new EvolutionProvider(creds);
    await p.sendTemplate({
      to: '595991',
      templateName: 'promo',
      template: row(),
      params: ['positional'],
      messageParams: { body: ['FromParams'] },
    });
    expect(evoSendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Hi FromParams' }),
    );
  });

  it('sends a media header via evoSendMedia with the body as caption', async () => {
    const p = new EvolutionProvider(creds);
    const result = await p.sendTemplate({
      to: '595991',
      templateName: 'promo',
      template: row({
        header_type: 'image',
        header_media_url: 'https://x/y.jpg',
        body_text: 'Enjoy',
      }),
    });
    expect(result.messageId).toBe('media-1');
    expect(evoSendText).not.toHaveBeenCalled();
    expect(evoSendMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '595991',
        mediatype: 'image',
        media: 'https://x/y.jpg',
        caption: 'Enjoy',
      }),
    );
  });

  it('throws when no template row is provided', async () => {
    const p = new EvolutionProvider(creds);
    await expect(
      p.sendTemplate({ to: '595991', templateName: 'promo' }),
    ).rejects.toThrow(/not found/i);
  });
});
