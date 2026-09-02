import { describe, expect, it } from 'vitest';
import { renderEvolutionTemplate } from './template-render';
import type { MessageTemplate } from '@/types';

function row(overrides: Partial<MessageTemplate> = {}): MessageTemplate {
  return {
    id: 'row-1',
    user_id: 'user-1',
    name: 'promo',
    category: 'Marketing',
    language: 'en_US',
    provider: 'evolution',
    body_text: 'Your order is on its way.',
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('renderEvolutionTemplate — body', () => {
  it('renders a static body with no media', () => {
    expect(renderEvolutionTemplate(row())).toEqual({
      text: 'Your order is on its way.',
      media: undefined,
    });
  });

  it('substitutes {{1}}, {{2}} from params.body (1-indexed)', () => {
    const out = renderEvolutionTemplate(
      row({ body_text: 'Hi {{1}}, order {{2}} confirmed.' }),
      { body: ['John', 'ORD-42'] },
    );
    expect(out.text).toBe('Hi John, order ORD-42 confirmed.');
  });

  it('keeps {{N}} literal when a value is missing or blank', () => {
    const out = renderEvolutionTemplate(row({ body_text: 'Hi {{1}} {{2}}' }), {
      body: ['John'],
    });
    expect(out.text).toBe('Hi John {{2}}');
  });
});

describe('renderEvolutionTemplate — header', () => {
  it('renders a TEXT header in bold above the body', () => {
    const out = renderEvolutionTemplate(
      row({ header_type: 'text', header_content: 'Welcome {{1}}' }),
      { headerText: 'Ana', body: [] },
    );
    expect(out.text).toBe('*Welcome Ana*\n\nYour order is on its way.');
    expect(out.media).toBeUndefined();
  });

  it('returns media for an image header, body as the caption', () => {
    const out = renderEvolutionTemplate(
      row({ header_type: 'image', header_media_url: 'https://x/y.jpg' }),
    );
    expect(out.media).toEqual({ kind: 'image', url: 'https://x/y.jpg' });
    expect(out.text).toBe('Your order is on its way.');
  });

  it('honours a headerMediaUrl override', () => {
    const out = renderEvolutionTemplate(
      row({ header_type: 'video', header_media_url: 'https://x/old.mp4' }),
      { headerMediaUrl: 'https://x/new.mp4' },
    );
    expect(out.media).toEqual({ kind: 'video', url: 'https://x/new.mp4' });
  });

  it('degrades to text-only when a media header has no URL', () => {
    const out = renderEvolutionTemplate(row({ header_type: 'document' }));
    expect(out.media).toBeUndefined();
    expect(out.text).toBe('Your order is on its way.');
  });
});

describe('renderEvolutionTemplate — footer and buttons', () => {
  it('appends the footer as its own block', () => {
    const out = renderEvolutionTemplate(
      row({ footer_text: 'Reply STOP to opt out' }),
    );
    expect(out.text).toBe(
      'Your order is on its way.\n\nReply STOP to opt out',
    );
  });

  it('flattens every button type to text lines', () => {
    const out = renderEvolutionTemplate(
      row({
        buttons: [
          { type: 'QUICK_REPLY', text: 'Yes' },
          { type: 'URL', text: 'Track', url: 'https://x/track/{{1}}' },
          { type: 'PHONE_NUMBER', text: 'Call', phone_number: '+595991' },
          { type: 'COPY_CODE', text: 'Code', example: 'SAVE10' },
        ],
      }),
      { buttonParams: { 1: 'ORD-42', 3: 'PROMO99' } },
    );
    expect(out.text).toBe(
      [
        'Your order is on its way.',
        '',
        '▸ Yes',
        'Track: https://x/track/ORD-42',
        'Call: +595991',
        'Code: PROMO99',
      ].join('\n'),
    );
  });

  it('falls back to the COPY_CODE example when no override is given', () => {
    const out = renderEvolutionTemplate(
      row({ buttons: [{ type: 'COPY_CODE', text: 'Code', example: 'SAVE10' }] }),
    );
    expect(out.text.endsWith('Code: SAVE10')).toBe(true);
  });
});
