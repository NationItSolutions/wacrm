'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import type { WhatsAppProviderId } from '@/types';

/**
 * Which WhatsApp backend the current account talks to.
 *
 * DRYs the pattern that was duplicated inline in the inbox (see
 * message-thread.tsx). Meta imposes the 24-hour customer-service window
 * and template approval; Evolution (Baileys) has neither. Callers gate
 * provider-specific UI on `isEvolution` / `has24hWindow` rather than
 * sniffing the `whatsapp_config.provider` string themselves.
 *
 * Defaults to Meta (the restricted mode) until the async read resolves,
 * so the more permissive Evolution UI never flashes on a Meta account.
 */
export function useWhatsAppProvider() {
  const { accountId } = useAuth();
  const [provider, setProvider] = useState<WhatsAppProviderId | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('whatsapp_config')
        .select('provider')
        .eq('account_id', accountId)
        .maybeSingle();
      if (cancelled) return;
      setProvider(data?.provider === 'evolution' ? 'evolution' : 'meta');
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  return {
    provider,
    loading,
    isEvolution: provider === 'evolution',
    has24hWindow: provider !== 'evolution',
  };
}
