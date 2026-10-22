import { describe, expect, it, vi, beforeEach } from 'vitest';

const upserts: Record<string, unknown>[] = [];
vi.mock('@/lib/auth/account', () => {
  const chain: Record<string, unknown> = {};
  for (const m of ['from', 'select', 'eq', 'delete']) chain[m] = () => chain;
  chain.maybeSingle = async () => ({ data: null });
  chain.upsert = async (row: Record<string, unknown>) => {
    upserts.push(row);
    return { error: null };
  };
  return {
    requireRole: vi.fn(async () => ({ supabase: chain, accountId: 'acc-1', userId: 'user-1' })),
    toErrorResponse: (err: unknown) => {
      throw err;
    },
  };
});
vi.mock('@/lib/whatsapp/url-guard', () => ({
  assertPublicHttpUrl: vi.fn(async () => undefined),
  UrlNotAllowedError: class extends Error {},
}));
vi.mock('@/lib/whatsapp/evolution-api', async (orig) => {
  const actual = await orig<typeof import('@/lib/whatsapp/evolution-api')>();
  return {
    EvolutionApiError: actual.EvolutionApiError,
    evoConnectionState: vi.fn(),
    evoCreateInstance: vi.fn(async () => ({})),
    evoSetWebhook: vi.fn(async () => ({})),
  };
});

import {
  EvolutionApiError,
  evoConnectionState,
  evoCreateInstance,
  evoSetWebhook,
} from '@/lib/whatsapp/evolution-api';
import { POST } from './route';

function connect(body: Record<string, unknown>) {
  return POST(
    new Request('https://crm.test/api/whatsapp/evolution/connect', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  );
}
const valid = { base_url: 'evo.example.com/', api_key: 'global', instance_name: 'comercial' };

beforeEach(() => {
  vi.clearAllMocks();
  upserts.length = 0;
});

describe('POST /api/whatsapp/evolution/connect', () => {
  it('saves an existing, already linked instance and registers the webhook', async () => {
    vi.mocked(evoConnectionState).mockResolvedValueOnce({ state: 'open' });
    const res = await connect(valid);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json).toMatchObject({ connected: true, state: 'open', created: false, webhook_set: true });
    expect(evoCreateInstance).not.toHaveBeenCalled();
    expect(evoSetWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: 'https://evo.example.com', instance: 'comercial' }),
    );
    expect(upserts[0]).toMatchObject({ provider: 'evolution', status: 'connected' });
  });

  it('creates the instance when the server answers 404', async () => {
    vi.mocked(evoConnectionState).mockRejectedValueOnce(
      new EvolutionApiError('The "comercial" instance does not exist', 404),
    );
    const res = await connect(valid);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(evoCreateInstance).toHaveBeenCalledWith(
      expect.objectContaining({ instance: 'comercial', apiKey: 'global' }),
    );
    expect(json).toMatchObject({ connected: false, created: true, state: 'close' });
  });

  it('asks for the global key when an instance key cannot create the instance', async () => {
    vi.mocked(evoConnectionState).mockRejectedValueOnce(new EvolutionApiError('not found', 404));
    vi.mocked(evoCreateInstance).mockRejectedValueOnce(new EvolutionApiError('Unauthorized', 401));
    const res = await connect(valid);
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe('create_needs_global_key');
    expect(upserts).toHaveLength(0);
  });

  it('reports a rejected key and an unreachable server with distinct codes', async () => {
    vi.mocked(evoConnectionState).mockRejectedValueOnce(new EvolutionApiError('Unauthorized', 401));
    expect((await (await connect(valid)).json()).code).toBe('unauthorized');
    vi.mocked(evoConnectionState).mockRejectedValueOnce(new TypeError('fetch failed'));
    expect((await (await connect(valid)).json()).code).toBe('unreachable');
  });

  it('rejects instance names that would break the URL path', async () => {
    const res = await connect({ ...valid, instance_name: 'a/b' });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('invalid_instance_name');
  });
});
