-- ============================================================
-- Migration 038: one conversation per (account, contact)
--
-- The inbox showed the same contact as many separate threads. Root
-- cause: `conversations` had NO unique constraint on (account_id,
-- contact_id), and the find-or-create logic did a non-atomic
-- SELECT-then-INSERT. Two near-simultaneous messages for one contact
-- (e.g. an inbound message + an auto-reply, or a burst of sends) both
-- missed the SELECT and both INSERTed. Once duplicates existed,
-- `.maybeSingle()` erred on "multiple rows" and every later send/inbound
-- created yet another thread.
--
-- This migration (1) merges existing duplicate threads into the oldest
-- one per (account, contact), repointing every child row, then (2) adds
-- the UNIQUE index that makes the invariant impossible to violate. The
-- app code catches the resulting unique-violation and re-selects the
-- winner (mirroring the existing `contacts` dedup pattern).
-- ============================================================

BEGIN;

-- Canonical survivor per (account, contact) = the oldest conversation
-- (tie-break by id). Everything else is a duplicate to fold in.
CREATE TEMP TABLE conv_merge ON COMMIT DROP AS
WITH ranked AS (
  SELECT
    id,
    first_value(id) OVER (
      PARTITION BY account_id, contact_id
      ORDER BY created_at ASC, id ASC
    ) AS canonical_id
  FROM conversations
)
SELECT id AS dup_id, canonical_id
FROM ranked
WHERE id <> canonical_id;

-- Repoint every table that references conversations(id) onto the
-- canonical row (see FK map: messages, message_reactions, deals,
-- flow_runs, notifications, ai_usage_log).
UPDATE messages m
  SET conversation_id = cm.canonical_id
  FROM conv_merge cm WHERE m.conversation_id = cm.dup_id;

UPDATE message_reactions r
  SET conversation_id = cm.canonical_id
  FROM conv_merge cm WHERE r.conversation_id = cm.dup_id;

UPDATE deals d
  SET conversation_id = cm.canonical_id
  FROM conv_merge cm WHERE d.conversation_id = cm.dup_id;

UPDATE flow_runs f
  SET conversation_id = cm.canonical_id
  FROM conv_merge cm WHERE f.conversation_id = cm.dup_id;

UPDATE notifications n
  SET conversation_id = cm.canonical_id
  FROM conv_merge cm WHERE n.conversation_id = cm.dup_id;

UPDATE ai_usage_log a
  SET conversation_id = cm.canonical_id
  FROM conv_merge cm WHERE a.conversation_id = cm.dup_id;

-- Drop the now-empty duplicate threads.
DELETE FROM conversations c
  USING conv_merge cm WHERE c.id = cm.dup_id;

-- Refresh the canonical thread's preview to the latest merged message
-- so the inbox sorts/labels correctly (the canonical is the OLDEST
-- thread, so its last_message_at may predate a merged-in message).
-- unread_count is left untouched — it's an app-maintained counter and
-- recomputing it here risks mislabeling already-read messages.
UPDATE conversations c
SET
  last_message_text = lm.content_text,
  last_message_at = lm.created_at
FROM (
  SELECT DISTINCT ON (conversation_id)
    conversation_id, content_text, created_at
  FROM messages
  WHERE conversation_id IN (SELECT canonical_id FROM conv_merge)
  ORDER BY conversation_id, created_at DESC
) lm
WHERE c.id = lm.conversation_id;

-- Enforce the invariant going forward.
CREATE UNIQUE INDEX IF NOT EXISTS conversations_account_contact_uniq
  ON conversations (account_id, contact_id);

COMMIT;
