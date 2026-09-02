// ============================================================
// Find (or create) the single conversation for a (account, contact).
//
// Invariant: at most ONE conversation per (account_id, contact_id),
// enforced by a UNIQUE index (migration 038). This helper is the only
// safe way to resolve that conversation from a contact.
//
// A naive "SELECT then INSERT" races: two near-simultaneous messages
// for the same contact (e.g. an inbound message + an auto-reply, or a
// burst of sends) both miss the SELECT and both INSERT — which is
// exactly how duplicate threads piled up in the inbox. Worse, once two
// rows existed, `.maybeSingle()` erred on "multiple rows" and the
// caller (which ignored the error) created yet another every time.
//
// We mirror the contact-dedup pattern already used for `contacts`
// (unique index + catch the violation + re-select): try the insert,
// and if the unique index rejects our duplicate, return the row the
// winner created instead of a new one.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { isUniqueViolation } from '@/lib/contacts/dedupe';

export async function findOrCreateConversationId(
  db: SupabaseClient,
  params: { accountId: string; userId: string; contactId: string },
): Promise<string | null> {
  const { accountId, userId, contactId } = params;

  const found = await db
    .from('conversations')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .maybeSingle();
  if (found.data?.id) return found.data.id;

  const { data: created, error } = await db
    .from('conversations')
    .insert({ account_id: accountId, user_id: userId, contact_id: contactId })
    .select('id')
    .single();
  if (!error && created?.id) return created.id;

  // Lost the race: the unique index rejected our duplicate. The winner's
  // row is now visible — return it rather than failing or duplicating.
  if (isUniqueViolation(error)) {
    const raced = await db
      .from('conversations')
      .select('id')
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .maybeSingle();
    if (raced.data?.id) return raced.data.id;
  }

  console.error(
    '[conversations] find-or-create failed for contact',
    contactId,
    error?.message,
  );
  return null;
}
