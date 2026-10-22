'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { CheckCircle2, Loader2, XCircle, Link2, RotateCcw } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';

const MASKED = '••••••••••••••••';

/** Error codes returned by /api/whatsapp/evolution/connect (see route.ts). */
const KNOWN_ERROR_CODES = new Set([
  'missing_fields',
  'invalid_instance_name',
  'url_not_allowed',
  'unreachable',
  'unauthorized',
  'create_needs_global_key',
  'create_failed',
  'save_failed',
  'disconnect_failed',
]);

const KNOWN_STATES = new Set(['open', 'connecting', 'close', 'unknown']);

interface EvolutionRow {
  base_url?: string | null;
  instance_name?: string | null;
  evolution_state?: string | null;
  status?: string | null;
  qr_code?: string | null;
  api_key?: string | null;
}

export function EvolutionConfig({ accountId }: { accountId: string | null }) {
  const t = useTranslations('Settings.evolution');
  const supabase = createClient();

  const [baseUrl, setBaseUrl] = useState('');
  const [instanceName, setInstanceName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiKeySaved, setApiKeySaved] = useState(false);
  const [state, setState] = useState<string>('unknown');
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const connected = state === 'open';
  const stateLabel = KNOWN_STATES.has(state) ? t(`state.${state}`) : state;

  /** Translate an API error body ({ error, code }) for a toast. */
  const apiError = (json: { error?: string; code?: string }, fallback: string) =>
    json.code && KNOWN_ERROR_CODES.has(json.code) ? t(`errors.${json.code}`) : json.error || fallback;

  const load = useCallback(
    async (acct: string) => {
      setLoading(true);
      const { data } = await supabase
        .from('whatsapp_config')
        .select('base_url, instance_name, evolution_state, status, qr_code, api_key')
        .eq('account_id', acct)
        .maybeSingle();
      const row = data as EvolutionRow | null;
      if (row) {
        setBaseUrl(row.base_url ?? '');
        setInstanceName(row.instance_name ?? '');
        setState(row.evolution_state ?? (row.status === 'connected' ? 'open' : 'unknown'));
        setQrCode(row.qr_code ?? null);
        if (row.api_key) {
          setApiKey(MASKED);
          setApiKeySaved(true);
        }
      }
      setLoading(false);
    },
    [supabase],
  );

  useEffect(() => {
    if (accountId) load(accountId);
  }, [accountId, load]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const pollState = useCallback(async () => {
    try {
      const res = await fetch('/api/whatsapp/evolution/state');
      const json = await res.json();
      if (typeof json.state === 'string') setState(json.state);
      setQrCode(json.qr_code ?? null);
      if (json.connected) {
        stopPolling();
        setQrCode(null);
        toast.success(t('toastConnected'));
      }
    } catch {
      // transient; keep polling
    }
  }, [stopPolling, t]);

  useEffect(() => stopPolling, [stopPolling]);

  const handleConnect = async () => {
    if (!baseUrl.trim() || !instanceName.trim()) {
      toast.error(t('toastRequiredFields'));
      return;
    }
    if (!apiKeySaved && !apiKey.trim()) {
      toast.error(t('toastApiKeyRequired'));
      return;
    }
    setConnecting(true);
    try {
      const res = await fetch('/api/whatsapp/evolution/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          base_url: baseUrl.trim(),
          instance_name: instanceName.trim(),
          // If the key is still the mask, the user didn't change it — but
          // connect requires a real key, so only send when edited.
          api_key: apiKey === MASKED ? '' : apiKey.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(apiError(json, t('toastConnectionFailed')));
        return;
      }
      setState(json.state ?? 'unknown');
      setApiKeySaved(true);
      if (apiKey && apiKey !== MASKED) setApiKey(MASKED);
      if (json.webhook_set === false) {
        toast.warning(t('toastWebhookFailed'));
      }
      if (json.connected) {
        toast.success(t('toastConnected'));
        setQrCode(null);
      } else {
        toast.message(json.created ? t('toastInstanceCreated') : t('toastScanQr'));
        // Kick off polling for state + QR.
        stopPolling();
        await pollState();
        pollRef.current = setInterval(pollState, 3000);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('toastConnectionFailed'));
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm(t('confirmDisconnect'))) return;
    try {
      const res = await fetch('/api/whatsapp/evolution/connect', { method: 'DELETE' });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        toast.error(apiError(json, t('toastDisconnectFailed')));
        return;
      }
      stopPolling();
      setState('unknown');
      setQrCode(null);
      setApiKey('');
      setApiKeySaved(false);
      toast.success(t('toastDisconnected'));
    } catch {
      toast.error(t('toastDisconnectFailed'));
    }
  };

  const qrSrc = qrCode
    ? qrCode.startsWith('data:')
      ? qrCode
      : `data:image/png;base64,${qrCode}`
    : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Link2 className="size-5" />
              {t('title')}
            </CardTitle>
            <CardDescription>{t('description')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">{t('statusLabel')}</span>
              {connected ? (
                <span className="inline-flex items-center gap-1 text-green-500">
                  <CheckCircle2 className="size-4" /> {t('statusConnected')}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-amber-500">
                  <XCircle className="size-4" /> {loading ? t('statusLoading') : stateLabel}
                </span>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="evo-base-url">{t('baseUrl')}</Label>
              <Input
                id="evo-base-url"
                placeholder={t('baseUrlPlaceholder')}
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="evo-instance">{t('instanceName')}</Label>
              <Input
                id="evo-instance"
                placeholder={t('instancePlaceholder')}
                value={instanceName}
                onChange={(e) => setInstanceName(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">{t('instanceHint')}</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="evo-api-key">{t('apiKey')}</Label>
              <Input
                id="evo-api-key"
                type="password"
                placeholder={apiKeySaved ? MASKED : t('apiKeyPlaceholder')}
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setApiKeySaved(false);
                }}
                onFocus={() => {
                  if (apiKey === MASKED) {
                    setApiKey('');
                    setApiKeySaved(false);
                  }
                }}
              />
              <p className="text-xs text-muted-foreground">{t('apiKeyHint')}</p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={handleConnect} disabled={connecting}>
                {connecting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> {t('connecting')}
                  </>
                ) : (
                  <>
                    <Link2 className="size-4" /> {connected ? t('reconnect') : t('connect')}
                  </>
                )}
              </Button>
              {(connected || apiKeySaved) && (
                <Button variant="outline" onClick={handleDisconnect}>
                  <RotateCcw className="size-4" /> {t('disconnect')}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {qrSrc && !connected && (
          <Card>
            <CardHeader>
              <CardTitle>{t('scanTitle')}</CardTitle>
              <CardDescription>{t('scanDescription')}</CardDescription>
            </CardHeader>
            <CardContent>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qrSrc}
                alt={t('qrAlt')}
                className="mx-auto size-64 rounded-lg bg-white p-2"
              />
            </CardContent>
          </Card>
        )}
      </div>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle>{t('howTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>{t('howStep1')}</p>
          <p>{t('howStep2')}</p>
          <p>{t('howStep3')}</p>
          <p>{t('howStep4')}</p>
        </CardContent>
      </Card>
    </div>
  );
}
