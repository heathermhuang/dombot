import { afterEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { markWeb } from '../../lib/platform';
import type { AppInfo } from '../../../shared/ipc';
import AboutSettings from './AboutSettings';

const viewState = vi.hoisted(() => ({
  appInfo: null as AppInfo | null,
  settings: { updateChecks: true },
  loadAppInfo: vi.fn(async () => {}),
  loadSettings: vi.fn(async () => {}),
  setUpdateChecks: vi.fn(async () => {}),
}));
vi.mock('../../store/app', () => ({
  useAppStore: (selector: (state: typeof viewState) => unknown) =>
    selector(viewState),
}));
afterEach(() => {
  viewState.appInfo = null;
  markWeb('password');
});
const render = () =>
  renderToStaticMarkup(
    <MemoryRouter>
      <AboutSettings />
    </MemoryRouter>,
  );

it('shows the deployed managed release and source revision with service branding', () => {
  markWeb('gateway');
  viewState.appInfo = {
    name: 'DomBot',
    version: '1.5.2',
    platform: 'web',
    electron: '',
    chrome: '',
    node: '',
    hosted: {
      engineVersion: '1.5.2-hosted.16',
      engineSource: 'b'.repeat(64),
      sourceCommit: 'a'.repeat(40),
    },
  };
  const html = render();
  expect(html).toContain('About domains.domains');
  expect(html).toContain('1.5.2-hosted.16');
  expect(html).toContain('aaaaaaa');
  expect(html).toContain('href="/source"');
  expect(html).toContain('href="/privacy"');
  expect(html).toContain('href="/terms"');
  expect(html).toContain('aoxborrow/dombot');
  expect(html).toContain('Aaron Oxborrow');
  expect(html).toContain('Heatherm Huang');
  expect(html).toContain('href="https://github.com/heathermhuang"');
  expect(html).toContain('href="https://x.com/heathermhuang"');
  expect(html).not.toContain('Self-hosted');
  expect(html).not.toContain('Check now');
  expect(html).not.toContain('Sponsor DomBot');
  expect(html).not.toContain('How to update');
  expect(html).not.toContain('You’re on the latest version');
});

it('does not present the base package version as the deployed managed release when metadata is absent', () => {
  markWeb('gateway');
  viewState.appInfo = {
    name: 'DomBot',
    version: '1.5.2',
    platform: 'web',
    electron: '',
    chrome: '',
    node: '',
  };
  const html = render();
  expect(html).toContain('Release details are unavailable.');
  expect(html).not.toContain('1.5.2');
});

it('retains the existing self-hosted update controls', () => {
  markWeb('password');
  viewState.appInfo = {
    name: 'DomBot',
    version: '1.5.2',
    platform: 'web',
    electron: '',
    chrome: '',
    node: '',
  };
  const html = render();
  expect(html).toContain('Self-hosted');
  expect(html).toContain('Check now');
  expect(html).toContain('Check for updates automatically');
});
