-- ============================================================
-- 036_whatsapp_provider_evolution.sql
--
-- Adds Evolution API as a second WhatsApp provider alongside the
-- existing Meta Cloud API. Each account keeps ONE whatsapp_config
-- row (UNIQUE(account_id) from migration 017) but now picks a
-- `provider`. Meta stays the default so every existing row keeps
-- working unchanged.
--
-- Also adds the plumbing for three Evolution-era features the Meta
-- path never had: soft-deleting messages (delete-for-everyone),
-- first-class stickers (a new content_type + a per-account sticker
-- library for re-sending).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- 1. Provider discriminator + Evolution columns ---------------

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'meta'
    CHECK (provider IN ('meta', 'evolution'));

-- Evolution credentials/state. All nullable — a Meta row leaves them
-- empty. `api_key` is AES-256-GCM-encrypted at rest, exactly like
-- `access_token` (same encrypt()/decrypt() + ENCRYPTION_KEY).
ALTER TABLE whatsapp_config ADD COLUMN IF NOT EXISTS base_url        text;
ALTER TABLE whatsapp_config ADD COLUMN IF NOT EXISTS instance_name   text;
ALTER TABLE whatsapp_config ADD COLUMN IF NOT EXISTS api_key         text;
ALTER TABLE whatsapp_config ADD COLUMN IF NOT EXISTS evolution_state text;   -- open | connecting | close
ALTER TABLE whatsapp_config ADD COLUMN IF NOT EXISTS qr_code         text;   -- transient base64 PNG
ALTER TABLE whatsapp_config ADD COLUMN IF NOT EXISTS webhook_secret  text;   -- unguessable path segment for the inbound webhook

-- 2. Relax Meta-only NOT NULLs so an Evolution row is valid ----
-- (phone_number_id / access_token are meaningless for Evolution.)
ALTER TABLE whatsapp_config ALTER COLUMN phone_number_id DROP NOT NULL;
ALTER TABLE whatsapp_config ALTER COLUMN access_token    DROP NOT NULL;

-- 3. Uniqueness: per-number is Meta-only; per-instance is Evolution.
-- Replace the global UNIQUE(phone_number_id) from migration 013 with a
-- partial index so it only constrains Meta rows (Evolution rows have a
-- NULL phone_number_id and must not collide on it).
ALTER TABLE whatsapp_config DROP CONSTRAINT IF EXISTS whatsapp_config_phone_number_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_config_phone_number_id_meta_uidx
  ON whatsapp_config (phone_number_id)
  WHERE provider = 'meta' AND phone_number_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_config_instance_evolution_uidx
  ON whatsapp_config (instance_name)
  WHERE provider = 'evolution' AND instance_name IS NOT NULL;
-- webhook_secret must be globally unique (it's the routing key for the
-- Evolution webhook — a shared secret would cross-route tenants).
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_config_webhook_secret_uidx
  ON whatsapp_config (webhook_secret)
  WHERE webhook_secret IS NOT NULL;

-- 4. Per-provider required-column invariant -------------------
-- Existing Meta rows already satisfy this (they require phone_number_id
-- + access_token at save time), so no data migration is needed.
ALTER TABLE whatsapp_config DROP CONSTRAINT IF EXISTS whatsapp_config_provider_shape;
ALTER TABLE whatsapp_config ADD CONSTRAINT whatsapp_config_provider_shape CHECK (
  (provider = 'meta'
     AND phone_number_id IS NOT NULL
     AND access_token IS NOT NULL)
  OR
  (provider = 'evolution'
     AND base_url IS NOT NULL
     AND instance_name IS NOT NULL
     AND api_key IS NOT NULL)
);

-- 5. Messages: soft-delete + sticker content type -------------

-- delete-for-everyone marks the row instead of removing it (so the
-- thread can render "message deleted" and the audit trail survives).
ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Widen content_type to allow 'sticker'. Current allow-list comes from
-- migration 010 (which added 'interactive' on top of migration 001's
-- text/image/document/audio/video/location/template).
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_content_type_check;
ALTER TABLE messages ADD CONSTRAINT messages_content_type_check
  CHECK (content_type IN (
    'text', 'image', 'document', 'audio', 'video',
    'location', 'template', 'interactive', 'sticker'
  ));

-- 6. Sticker library (per-account, for re-sending) ------------
CREATE TABLE IF NOT EXISTS stickers (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- author / audit only; ON DELETE SET NULL so removing a teammate
  -- doesn't drop the workspace's saved stickers.
  user_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  media_url   text NOT NULL,          -- public URL in the chat-media bucket (.webp)
  mime        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, media_url)
);

CREATE INDEX IF NOT EXISTS idx_stickers_account ON stickers(account_id);

ALTER TABLE stickers ENABLE ROW LEVEL SECURITY;

-- Same tenancy model as automations / quick_replies: any account member
-- may read + manage the shared sticker library.
DROP POLICY IF EXISTS stickers_select ON stickers;
CREATE POLICY stickers_select ON stickers FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS stickers_insert ON stickers;
CREATE POLICY stickers_insert ON stickers FOR INSERT
  WITH CHECK (is_account_member(account_id));

DROP POLICY IF EXISTS stickers_delete ON stickers;
CREATE POLICY stickers_delete ON stickers FOR DELETE
  USING (is_account_member(account_id));
