'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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

interface EvolutionRow {
  base_url?: string | null;
  instance_name?: string | null;
  evolution_state?: string | null;
  status?: string | null;
  qr_code?: string | null;
  api_key?: string | null;
}

export function EvolutionConfig({ accountId }: { accountId: string | null }) {
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
        toast.success('WhatsApp connected via Evolution.');
      }
    } catch {
      // transient; keep polling
    }
  }, [stopPolling]);

  useEffect(() => stopPolling, [stopPolling]);

  const handleConnect = async () => {
    if (!baseUrl.trim() || !instanceName.trim()) {
      toast.error('Base URL and instance name are required.');
      return;
    }
    if (!apiKeySaved && !apiKey.trim()) {
      toast.error('API key is required.');
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
        toast.error(json.error || 'Connection failed.');
        return;
      }
      setState(json.state ?? 'unknown');
      setApiKeySaved(true);
      if (apiKey && apiKey !== MASKED) setApiKey(MASKED);
      if (json.webhook_set === false) {
        toast.warning('Connected, but could not set the webhook automatically. Retry, or set it manually on the instance.');
      }
      if (json.connected) {
        toast.success('WhatsApp connected via Evolution.');
        setQrCode(null);
      } else {
        toast.message('Saved. Scan the QR code to finish connecting.');
        // Kick off polling for state + QR.
        stopPolling();
        await pollState();
        pollRef.current = setInterval(pollState, 3000);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Connection failed.');
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('Disconnect this Evolution instance from ConstruSuite?')) return;
    try {
      const res = await fetch('/api/whatsapp/evolution/connect', { method: 'DELETE' });
      if (!res.ok) {
        toast.error('Failed to disconnect.');
        return;
      }
      stopPolling();
      setState('unknown');
      setQrCode(null);
      setApiKey('');
      setApiKeySaved(false);
      toast.success('Disconnected.');
    } catch {
      toast.error('Failed to disconnect.');
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
              Evolution API connection
            </CardTitle>
            <CardDescription>
              Connect ConstruSuite to your existing Evolution API server. ConstruSuite will
              register its inbound webhook on the instance automatically.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Status:</span>
              {connected ? (
                <span className="inline-flex items-center gap-1 text-green-500">
                  <CheckCircle2 className="size-4" /> Connected (open)
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-amber-500">
                  <XCircle className="size-4" /> {loading ? 'Loading…' : state}
                </span>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="evo-base-url">Base URL</Label>
              <Input
                id="evo-base-url"
                placeholder="https://evolution.your-server.com"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="evo-instance">Instance name</Label>
              <Input
                id="evo-instance"
                placeholder="my-instance"
                value={instanceName}
                onChange={(e) => setInstanceName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="evo-api-key">API key</Label>
              <Input
                id="evo-api-key"
                type="password"
                placeholder={apiKeySaved ? MASKED : 'Evolution global or instance API key'}
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
              <p className="text-xs text-muted-foreground">
                Stored encrypted (AES-256-GCM). Re-enter to change it.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={handleConnect} disabled={connecting}>
                {connecting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Connecting…
                  </>
                ) : (
                  <>
                    <Link2 className="size-4" /> {connected ? 'Reconnect / Save' : 'Connect'}
                  </>
                )}
              </Button>
              {(connected || apiKeySaved) && (
                <Button variant="outline" onClick={handleDisconnect}>
                  <RotateCcw className="size-4" /> Disconnect
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {qrSrc && !connected && (
          <Card>
            <CardHeader>
              <CardTitle>Scan to connect</CardTitle>
              <CardDescription>
                Open WhatsApp → Linked devices → Link a device, and scan this code.
                It refreshes automatically.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qrSrc}
                alt="Evolution QR code"
                className="mx-auto size-64 rounded-lg bg-white p-2"
              />
            </CardContent>
          </Card>
        )}
      </div>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle>How it works</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>1. Paste your Evolution server URL, the instance name, and its API key.</p>
          <p>2. Click Connect — ConstruSuite verifies the instance and registers its webhook.</p>
          <p>3. If the instance isn&apos;t linked yet, scan the QR code with your phone.</p>
          <p>
            Free-form messaging, media, stickers, replies, reactions and deletes are
            supported. Meta-approved templates are not used with Evolution.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
