import { useCallback, useEffect, useRef, useState } from 'react';
import { hostPath } from './platform';

export async function salesRequest<T>(
  path: string,
  method = 'GET',
  body?: unknown,
): Promise<T> {
  const controller = method === 'GET' ? new AbortController() : null;
  const timer = controller
    ? setTimeout(() => controller.abort(), 15_000)
    : null;
  try {
    const response = await fetch(hostPath(`/sales${path}`), {
      method,
      credentials: 'same-origin',
      ...(controller ? { signal: controller.signal } : {}),
      ...(body === undefined
        ? {}
        : {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }),
    });
    const value = await response.json();
    if (!response.ok)
      throw Object.assign(
        new Error(
          value.error ?? 'Could not reach Sales. Your edits are still here.',
        ),
        { status: response.status, code: value.code, reauth: value.reauth },
      );
    return value;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
export function useSalesData<T>(path: string) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
  const latest = useRef(0);
  const reload = useCallback(async () => {
    const seq = ++latest.current;
    setLoading(true);
    setError('');
    try {
      const value = await salesRequest<T>(path);
      if (seq === latest.current) setData(value);
    } catch (e) {
      if (seq === latest.current)
        setError(e instanceof Error ? e.message : 'Loading failed.');
    } finally {
      if (seq === latest.current) setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, error, loading, reload };
}
export function useSalesAction() {
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('');
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Could not save. Your edits are still here.',
      );
    } finally {
      setBusy(false);
    }
  };
  return { error, busy, notice, setNotice, run };
}
export function downloadSales(name: string, value: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
