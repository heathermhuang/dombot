import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { hostPath, webAuthMode } from '../../lib/platform';

type AddressState = {
  enabled: boolean;
  address: { handle: string; url: string } | null;
};
const Context = createContext<{
  state: AddressState | null;
  claim: (handle: string) => Promise<void>;
  error: string;
  reload: () => void;
}>({ state: null, claim: async () => {}, error: '', reload: () => {} });
export const usePortfolioAddress = () => useContext(Context);
export function PortfolioAddressProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [state, setState] = useState<AddressState | null>(null);
  const [error, setError] = useState('');
  const call = async (handle?: string) => {
    const response = await fetch(hostPath('/site-address'), {
      method: handle === undefined ? 'GET' : 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      ...(handle === undefined ? {} : { body: JSON.stringify({ handle }) }),
    });
    const value = await response.json().catch(() => {
      throw new Error('Could not load your public address. Please try again.');
    });
    if (!response.ok)
      throw new Error(value.error || 'Could not load your public address.');
    return value as AddressState;
  };
  useEffect(() => {
    if (webAuthMode() !== 'gateway') return;
    let active = true;
    void call()
      .then((value) => {
        if (active) setState(value);
      })
      .catch((e: Error) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <Context.Provider
      value={{
        state,
        error,
        reload: () => {
          setError('');
          void call()
            .then(setState)
            .catch((e: Error) => setError(e.message));
        },
        claim: async (handle) => setState(await call(handle)),
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function PortfolioAddressPanel() {
  const { state, claim, error: loadError, reload } = usePortfolioAddress();
  const [handle, setHandle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  if (loadError)
    return (
      <section className="os-address">
        <p role="alert">{loadError}</p>
        <button type="button" onClick={reload}>
          Retry address information
        </button>
      </section>
    );
  if (!state?.enabled) return null;
  return (
    <section className="os-address" aria-label="Your public address">
      <h2>Your public address</h2>
      {state.address ? (
        <>
          <p className="os-address-url">{state.address.url}</p>
          <div className="os-actions">
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard
                  .writeText(state.address!.url)
                  .then(() => setCopied(true))
                  .catch(() =>
                    setError('Select the address above to copy it.'),
                  );
              }}
            >
              {copied ? 'Copied' : 'Copy address'}
            </button>
          </div>
          <p>
            This link shows only your published profile. Saving a draft does not
            publish it.
          </p>
        </>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setBusy(true);
            setError('');
            void claim(handle)
              .catch((e: Error) => setError(e.message))
              .finally(() => setBusy(false));
          }}
        >
          <p>
            Choose a short address you can share. Your domains stay private
            until you publish.
          </p>
          <label htmlFor="public-address-name">Your name or brand</label>
          <div className="os-address-input">
            <span>{window.location.host}/</span>
            <input
              id="public-address-name"
              value={handle}
              onChange={(e) => setHandle(e.target.value.toLowerCase())}
              required
              pattern="[a-z0-9](?:[a-z0-9-]*[a-z0-9])?"
              maxLength={40}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              disabled={busy}
              placeholder="yourname"
            />
          </div>
          <p>
            Choose once. This address stays yours; your display name can change.
          </p>
          <button disabled={busy}>{busy ? 'Saving…' : 'Save address'}</button>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
