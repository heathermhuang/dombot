import type { RegistrarName } from '@aoxborrow/registrar-client';
import { parseProxy, type ProxyRoute } from '../../shared/proxy';

// Host configuration only: never persisted in customer stores or exports.
// The Worker installs this under its request lock and reconfigures on env changes.
let managed: ProxyRoute | null = null;

export function configureManagedProxy(url?: string, ip?: string): void {
  managed = null;
  if (!url && !ip) return;
  try {
    managed = parseProxy({ url: url ?? '', egressIp: ip ?? '' });
    if (!managed) throw new Error();
  } catch {
    throw new Error(
      'The managed registrar connection is not configured correctly.',
    );
  }
}

export function managedProxyFor(name: RegistrarName): ProxyRoute | null {
  return name === 'namecheap' || name === 'dynadot' ? managed : null;
}

export function managedProxyInfo(): { egressIp: string } | null {
  return managed ? { egressIp: managed.ip } : null;
}
