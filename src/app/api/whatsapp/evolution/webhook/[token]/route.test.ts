import { describe, expect, it, vi, beforeEach } from 'vitest';

// ---- mocks ---------------------------------------------------------
// `after()` runs the callback inline so assertions see its effects.
const afterTasks: Promise<unknown>[] = [];
vi.mock('next/server', async (orig) => {
  const actual = await orig<typeof import('next/server')>();
  return {
    ...actual,
    after: (fn: () => Promise<unknown>) => {
      afterTasks.push(fn());
    },
  };
});

// Config lookup (service-role client) + the few updates the route does.
const configRow = {
  id: 'cfg-1',
  account_id: 'acc-1',
  user_id: 'user-1',
  provider: 'evolution',
  base_url: 'https://evo.test',
  instance_name: 'comercial',
  api_key: 'enc-key',
};
vi.mock('@supabase/supabase-js', () => {
  const chain: Record<string, unknown> = {};
  for (const m of ['from', 'select', 'eq', 'update', 'upsert']) chain[m] = () => chain;
  chain.maybeSingle = async () => ({ data: configRow });
  return { createClient: () => chain };
});
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: () => 'plain-key' }));
vi.mock('@/lib/storage/upload-media-server', () => ({
  uploadAccountMediaServer: vi.fn(async () => ({ publicUrl: 'https://cdn.test/m.jpg' })),
}));
vi.mock('@/lib/whatsapp/evolution-api', () => ({
  evoGetBase64FromMediaMessage: vi.fn(async () => ({ base64: 'aGk=', mimetype: 'image/jpeg' })),
}));
vi.mock('@/lib/whatsapp/inbound', () => ({
  processInboundMessage: vi.fn(async () => undefined),
  recordOutboundFromPhone: vi.fn(async () => undefined),
  handleProviderStatusUpdate: vi.fn(async () => undefined),
  markMessageDeletedByProviderId: vi.fn(async () => undefined),
}));

import {
  processInboundMessage,
  recordOutboundFromPhone,
  handleProviderStatusUpdate,
  markMessageDeletedByProviderId,
} from '@/lib/whatsapp/inbound';
import { POST } from './route';

async function deliver(body: Record<string, unknown>) {
  const res = await POST(
    new Request('https://crm.test/api/whatsapp/evolution/webhook/secret', {
      method: 'POST',
      body: JSON.stringify({ instance: 'comercial', ...body }),
    }),
    { params: Promise.resolve({ token: 'secret' }) },
  );
  await Promise.all(afterTasks.splice(0));
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('Evolution webhook — messages.upsert', () => {
  it('routes a customer text to the inbound pipeline', async () => {
    const res = await deliver({
      event: 'messages.upsert',
      data: {
        key: { id: 'M1', remoteJid: '595981111111@s.whatsapp.net', fromMe: false },
        pushName: 'Ana',
        message: { conversation: 'Hola, quiero un presupuesto' },
        messageTimestamp: 1761150000,
      },
    });
    expect(res.status).toBe(200);
    expect(processInboundMessage).toHaveBeenCalledTimes(1);
    const { msg } = vi.mocked(processInboundMessage).mock.calls[0][0];
    expect(msg).toMatchObject({
      providerMessageId: 'M1',
      fromPhone: '595981111111',
      senderName: 'Ana',
      contentType: 'text',
      contentText: 'Hola, quiero un presupuesto',
    });
    expect(msg).not.toHaveProperty('fromMe');
    expect(recordOutboundFromPhone).not.toHaveBeenCalled();
  });

  it('resolves an @lid chat through remoteJidAlt (Baileys 7)', async () => {
    await deliver({
      event: 'MESSAGES_UPSERT',
      data: {
        key: {
          id: 'M2',
          remoteJid: '123456789012345@lid',
          remoteJidAlt: '5511999999999@s.whatsapp.net',
          fromMe: false,
        },
        message: { extendedTextMessage: { text: 'oi' } },
      },
    });
    expect(vi.mocked(processInboundMessage).mock.calls[0][0].msg.fromPhone).toBe('5511999999999');
  });

  it('skips an @lid chat it cannot map to a phone, and groups', async () => {
    await deliver({
      event: 'messages.upsert',
      data: [
        { key: { id: 'M3', remoteJid: '123@lid', fromMe: false }, message: { conversation: 'x' } },
        { key: { id: 'M4', remoteJid: '1203@g.us', fromMe: false }, message: { conversation: 'x' } },
      ],
    });
    expect(processInboundMessage).not.toHaveBeenCalled();
  });

  it('records a message sent from the phone (fromMe) as outbound, without our pushName', async () => {
    vi.useFakeTimers();
    const pending = deliver({
      event: 'messages.upsert',
      data: {
        key: {
          id: 'M5',
          remoteJid: '595982222222@s.whatsapp.net',
          fromMe: true,
          // On fromMe, senderPn is the business's own number — must be ignored.
          senderPn: '595990000000@s.whatsapp.net',
        },
        pushName: 'Nation Comercial',
        message: { conversation: 'Te paso la propuesta' },
      },
    });
    await vi.runAllTimersAsync();
    await pending;
    expect(processInboundMessage).not.toHaveBeenCalled();
    expect(recordOutboundFromPhone).toHaveBeenCalledTimes(1);
    const { msg } = vi.mocked(recordOutboundFromPhone).mock.calls[0][0];
    expect(msg.fromPhone).toBe('595982222222');
    expect(msg.senderName).toBeUndefined();
    expect(msg.contentText).toBe('Te paso la propuesta');
  });
});

describe('Evolution webhook — updates and deletes', () => {
  it('maps v2 ack statuses', async () => {
    await deliver({
      event: 'messages.update',
      data: { keyId: 'M1', remoteJid: '595981111111@s.whatsapp.net', fromMe: true, status: 'READ' },
    });
    expect(handleProviderStatusUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ providerMessageId: 'M1', status: 'read' }),
    );
  });

  it('treats a DELETED status update as a revoke', async () => {
    await deliver({
      event: 'messages.update',
      data: { keyId: 'M1', status: 'DELETED' },
    });
    expect(markMessageDeletedByProviderId).toHaveBeenCalledWith({ providerMessageId: 'M1' });
    expect(handleProviderStatusUpdate).not.toHaveBeenCalled();
  });

  it('reads the bare key Evolution v2 sends on messages.delete', async () => {
    await deliver({
      event: 'messages.delete',
      data: { remoteJid: '595981111111@s.whatsapp.net', fromMe: false, id: 'M9' },
    });
    expect(markMessageDeletedByProviderId).toHaveBeenCalledWith({ providerMessageId: 'M9' });
  });

  it('rejects a payload naming another instance', async () => {
    const res = await deliver({ instance: 'otra', event: 'messages.upsert', data: {} });
    expect(res.status).toBe(401);
  });
});
