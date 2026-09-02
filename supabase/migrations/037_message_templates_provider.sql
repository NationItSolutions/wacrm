-- ============================================================
-- Migration 037: message_templates.provider
--
-- Templates were 100% Meta-specific. The Evolution provider (Baileys)
-- has no template-approval concept — an "Evolution template" is just a
-- local row rendered to plain text/media at send time. Tag each row with
-- the provider that owns it so the manager, pickers, and send path can
-- keep the two namespaces apart.
--
-- DEFAULT 'meta' backfills every existing row, so the Meta flow is
-- unchanged. The unique index stays (user_id, name, language): an account
-- has exactly one whatsapp_config (one provider at a time), so the two
-- provider namespaces never coexist for the same account.
-- ============================================================

ALTER TABLE message_templates
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'meta'
    CHECK (provider IN ('meta', 'evolution'));

CREATE INDEX IF NOT EXISTS idx_message_templates_provider
  ON message_templates (account_id, provider);
