import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { findOrCreateConversationId } from './find-or-create-conversation';

interface Result {
  data: { id: string } | null;
  error: unknown;
}
interface Scenario {
  initialFind: Result;
  insertResult?: Result;
  reselect?: Result;
}

// Minimal chainable Supabase mock. The helper issues: select→eq→eq→
// maybeSingle (initial find), then insert→select→single (create), then
// possibly select→eq→eq→maybeSingle again (re-select after a race). We
// return `initialFind` on the 1st maybeSingle and `reselect` on the 2nd.
function makeDb(s: Scenario) {
  let maybeSingleCalls = 0;
  const inserts: unknown[] = [];
  function from() {
    const b = {
      select: () => b,
      eq: () => b,
      insert: (row: unknown) => {
        inserts.push(row);
        return b;
      },
      single: () => Promise.resolve(s.insertResult ?? { data: null, error: null }),
      maybeSingle: () => {
        maybeSingleCalls += 1;
        return Promise.resolve(
          maybeSingleCalls === 1
            ? s.initialFind
            : (s.reselect ?? { data: null, error: null }),
        );
      },
    };
    return b;
  }
  return {
    db: { from } as unknown as SupabaseClient,
    inserts: () => inserts,
  };
}

const P = { accountId: 'acct-1', userId: 'user-1', contactId: 'contact-1' };

describe('findOrCreateConversationId', () => {
  it('returns the existing conversation without inserting', async () => {
    const { db, inserts } = makeDb({
      initialFind: { data: { id: 'conv-existing' }, error: null },
    });
    expect(await findOrCreateConversationId(db, P)).toBe('conv-existing');
    expect(inserts()).toHaveLength(0);
  });

  it('creates a conversation when none exists', async () => {
    const { db, inserts } = makeDb({
      initialFind: { data: null, error: null },
      insertResult: { data: { id: 'conv-new' }, error: null },
    });
    expect(await findOrCreateConversationId(db, P)).toBe('conv-new');
    expect(inserts()).toHaveLength(1);
    expect(inserts()[0]).toMatchObject({
      account_id: 'acct-1',
      contact_id: 'contact-1',
    });
  });

  it('re-selects the winner on a unique-violation race (no duplicate)', async () => {
    const { db } = makeDb({
      initialFind: { data: null, error: null },
      // Our insert lost the race — the unique index (migration 038) rejects it.
      insertResult: { data: null, error: { code: '23505' } },
      reselect: { data: { id: 'conv-winner' }, error: null },
    });
    expect(await findOrCreateConversationId(db, P)).toBe('conv-winner');
  });

  it('returns null on a non-unique insert error', async () => {
    const { db } = makeDb({
      initialFind: { data: null, error: null },
      insertResult: { data: null, error: { code: '42501' } }, // e.g. RLS denial
    });
    expect(await findOrCreateConversationId(db, P)).toBeNull();
  });
});
