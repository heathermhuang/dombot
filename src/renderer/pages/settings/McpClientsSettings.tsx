import { MCP_CLIENT_NAME } from '../../../shared/product-brand';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import type { McpClient, McpInfo } from '../../../shared/ipc';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { SettingsCard } from './SettingsCard';
import { hasExternalMcpGate, isDemo, isWeb, webAuthMode } from '@/lib/platform';
import { useAppStore } from '../../store/app';

export default function McpClientsSettings() {
  const [info, setInfo] = useState<McpInfo | null>(null);
  const [clients, setClients] = useState<McpClient[]>([]);
  const settings = useAppStore((s) => s.settings);
  const loadSettings = useAppStore((s) => s.loadSettings);
  const setMcpEnabled = useAppStore((s) => s.setMcpEnabled);
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState('');
  const [revoking, setRevoking] = useState<string | null>(null);

  useEffect(() => {
    if (settings === null) void loadSettings();
  }, [settings, loadSettings]);

  const refresh = useCallback(async () => {
    setError('');
    try {
      const [mcpInfo, list] = await Promise.all([
        window.api.getMcpInfo(),
        window.api.listMcpClients(),
      ]);
      setInfo(mcpInfo);
      setClients(list);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Could not load MCP access. Retry to check the current state.',
      );
    }
  }, []);

  useEffect(() => {
    void refresh();
    // A client pairing (or being revoked) elsewhere updates the list live.
    return window.api.onApprovalsChanged(() => void refresh());
  }, [refresh]);

  const revoke = async (clientId: string) => {
    if (revoking) return;
    setRevoking(clientId);
    setError('');
    try {
      await window.api.revokeMcpClient(clientId);
      await refresh();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Revocation could not be confirmed. Retry loading access.',
      );
    } finally {
      setRevoking(null);
    }
  };

  const toggle = async (enabled: boolean) => {
    setToggling(true);
    try {
      await setMcpEnabled(enabled);
      await refresh();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Could not change MCP availability. Retry loading access.',
      );
    } finally {
      setToggling(false);
    }
  };

  const enabled = settings?.mcpEnabled ?? false;
  // Settings and server info arrive async; until both are here the toggle
  // has no honest state to show (it would read "Disabled", then flip).
  const loading = settings === null || info === null;
  const web = isWeb();
  // The hosted gateway exposes MCP and OAuth paths without an upstream gate.
  const gated = hasExternalMcpGate();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-bold">MCP</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Agents connect to Domains.Domains&apos;s {web ? '' : 'local '}MCP
          server to manage your portfolio. New connections must be approved
          here.
        </p>
      </div>

      {error && (
        <p role="alert">
          {error}{' '}
          <Button variant="outline" onClick={() => void refresh()}>
            Retry loading access
          </Button>
        </p>
      )}
      <SettingsCard title="MCP server">
        <div className="flex items-center justify-between gap-6">
          <div>
            <Label
              htmlFor="mcp-enabled"
              className={cn(
                'inline-flex items-center gap-1.5 text-sm font-medium',
                !loading && enabled && info?.running && 'text-brand',
              )}
            >
              <span
                className={cn(
                  'size-2 rounded-full',
                  loading
                    ? 'bg-muted-foreground/30'
                    : enabled && info?.running
                      ? 'bg-brand'
                      : enabled
                        ? 'bg-amber-500'
                        : 'bg-muted-foreground/30',
                )}
                aria-hidden
              />
              {loading
                ? error
                  ? 'Unavailable'
                  : 'Loading…'
                : !enabled
                  ? 'Disabled'
                  : info?.running
                    ? 'Enabled (running)'
                    : 'Enabled (starting…)'}
            </Label>
            <p className="mt-1 text-sm text-muted-foreground">
              {loading
                ? '\u00a0'
                : !enabled
                  ? 'Enable this to let Claude or another MCP client manage your domains.'
                  : web
                    ? webAuthMode() === 'gateway'
                      ? 'Connect your AI assistant and approve portfolio access. Shared connections can read and refresh your portfolio. Revoke each connection below.'
                      : 'Approved agents can read and change your domains. Only connections you approve here get access.'
                    : 'Approved agents can read and change your domains. The server only accepts connections from this computer.'}
            </p>
            {gated && (
              <p className="mt-2 text-sm text-amber-500 dark:text-amber-400">
                This deployment sits behind an external gate (Cloudflare Access
                or a platform login), which MCP clients can&apos;t pass. For MCP
                to work, the gate must exclude the MCP paths — see the
                self-hosting guide.
              </p>
            )}
          </div>
          <Switch
            id="mcp-enabled"
            className={cn(loading && 'invisible')}
            checked={enabled}
            disabled={loading || toggling || isDemo()}
            onCheckedChange={(v) => void toggle(v)}
          />
        </div>
      </SettingsCard>

      {enabled && info?.running && (
        <SettingsCard
          title="Connect a client"
          contentClassName="flex flex-col gap-4"
        >
          <CopyField label="Server URL" value={info.url} />
          <CopyField
            label="Claude Code"
            value={`claude mcp add ${MCP_CLIENT_NAME} --transport http ${info.url}`}
          />
          {!web && (
            <CopyField
              label="stdio command"
              value={shellQuote([info.stdioCommand, ...info.stdioArgs])}
            />
          )}
        </SettingsCard>
      )}

      <SettingsCard title="Paired clients">
        {loading ? (
          <p role="status">
            {error
              ? 'Client access could not be loaded.'
              : 'Loading client access…'}
          </p>
        ) : clients.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No clients paired yet. Connect one and approve it when asked.
          </p>
        ) : (
          <ul className="flex flex-col">
            {clients.map((c, i) => (
              <li key={c.clientId}>
                {i > 0 && <Separator />}
                <div className="flex items-center justify-between py-3">
                  <div>
                    <p className="text-sm font-medium">{c.clientName}</p>
                    <p className="text-xs text-muted-foreground">
                      Paired {formatDate(c.pairedAt)}
                      {' · '}
                      {c.scopes
                        ? c.scopes.includes('domains:spend')
                          ? 'Paid registrar access'
                          : c.scopes.includes('domains:write')
                            ? 'Management access'
                            : 'Read only'
                        : 'Legacy grant · review access before using'}
                      <span className="block">
                        Connection {c.clientId.slice(0, 8)}
                      </span>
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`Revoke ${c.clientName}, connection ${c.clientId.slice(0, 8)}`}
                    disabled={revoking !== null}
                    onClick={() => void revoke(c.clientId)}
                  >
                    {revoking === c.clientId ? 'Revoking…' : 'Revoke'}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SettingsCard>
    </div>
  );
}

/**
 * A labeled, read-only value with a copy button — mirrors the copy snippet on
 * the marketing site: a small uppercase label above a mono field that flips the
 * button to a check for a moment on copy.
 */
function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const copy = async () => {
    setCopyError('');
    try {
      if (!navigator.clipboard)
        throw new Error(
          'Clipboard unavailable. Select and copy the full value below.',
        );
      await navigator.clipboard.writeText(value);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
      setCopyError(
        'Could not copy automatically. Select and copy the full value below.',
      );
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </span>
      <div className="flex items-center gap-2 rounded-md border bg-muted/40 py-1.5 pr-1.5 pl-3">
        <code
          className="min-w-0 flex-1 break-all whitespace-pre-wrap select-text font-mono text-xs text-foreground"
          title={value}
        >
          {value}
        </code>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => void copy()}
          aria-label={`Copy ${label}`}
          className={cn(
            'shrink-0 text-muted-foreground hover:text-foreground',
            copied && 'text-brand hover:text-brand',
          )}
        >
          {copied ? <Check /> : <Copy />}
        </Button>
      </div>
      {copied && (
        <p role="status" className="text-xs">
          Copied {label}.
        </p>
      )}
      {copyError && (
        <p role="alert" className="text-xs">
          {copyError}
        </p>
      )}
    </div>
  );
}

/** Joins a command line, quoting any part with spaces (e.g. "Application Support"). */
function shellQuote(parts: string[]): string {
  return parts.map((p) => (/[\s"]/.test(p) ? `"${p}"` : p)).join(' ');
}

function formatDate(ms: number): string {
  if (!ms) return 'recently';
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? 'recently' : d.toLocaleString();
}
