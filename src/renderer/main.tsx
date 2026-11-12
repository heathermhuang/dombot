import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import Login from './pages/Login';
import WebEntry from './pages/WebEntry';
import { ThemeProvider } from '@/components/theme-provider';
import { createHttpApi, setSessionActive } from './api/http';
import { markDemo, markWeb, hostPath, webAuthMode } from './lib/platform';
import {
  readWebAuthStatus,
  isManagedWorkspacePath,
} from './lib/web-auth-bootstrap';
import './index.css';
import './app-surfaces.css';

// HashRouter is used because the packaged app loads over the file:// protocol,
// where BrowserRouter's history paths do not resolve.
const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root not found');
}

const root = createRoot(container);

function render(node: React.ReactNode) {
  root.render(
    <React.StrictMode>
      <ThemeProvider
        defaultTheme={webAuthMode() === 'gateway' ? 'light' : 'dark'}
      >
        {node}
      </ThemeProvider>
    </React.StrictMode>,
  );
}

const app = (
  <HashRouter>
    <App />
  </HashRouter>
);

// On desktop the preload script has already put `window.api` in place. In a
// browser (the self-hosted web build) there is none, so install the HTTP
// implementation and, in password mode, show the login screen until the
// session cookie is in place. See src/renderer/api/http.ts. The demo build
// (vite.demo.config.mts) instead runs the whole core in the page against an
// invented portfolio; see src/renderer/api/demo.ts.
if (window.api) {
  render(app);
} else if (__DOMBOT_DEMO__) {
  void (async () => {
    const { createDemoApi } = await import('./api/demo');
    const { api } = await createDemoApi({ sampleChanges: true });
    window.api = api;
    markDemo();
    setSessionActive(true);
    render(app);
  })();
} else {
  window.api = createHttpApi();
  const managed = isManagedWorkspacePath(location.pathname);
  if (managed) {
    markWeb('gateway');
    document.documentElement.classList.add('hosted-theme');
  }
  const bootstrap = async () => {
    setSessionActive(false);
    const entry = (state: 'loading' | 'unavailable' | 'sign-in') =>
      render(
        <WebEntry
          state={state}
          managed={managed}
          onRetry={() => void bootstrap()}
          returnTo={location.pathname + location.search + location.hash}
        />,
      );
    entry('loading');
    let status;
    try {
      status = await readWebAuthStatus(hostPath('/auth/status'), managed);
    } catch {
      entry('unavailable');
      return;
    }
    markWeb(status.mode, status.sales === true, status.notifications === true);
    const start = () => {
      setSessionActive(true);
      render(app);
    };
    if (status.authenticated) start();
    else if (status.mode === 'password') render(<Login onSuccess={start} />);
    else entry(status.mode === 'gateway' ? 'sign-in' : 'unavailable');
  };
  void bootstrap();
}
