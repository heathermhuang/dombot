import { useEffect } from 'react';
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import {
  CalendarClock,
  Globe,
  History,
  Menu,
  RefreshCw,
  Settings as SettingsIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAppStore } from './store/app';
import Domains from './pages/Domains';
import Renewals from './pages/Renewals';
import Activity from './pages/Activity';
import Settings from './pages/Settings';
import ApprovalModal from './components/ApprovalModal';
import DemoBanner from './components/DemoBanner';
import { useWeeklyUpdateCheck } from './lib/updates';
import StatusBar from './components/StatusBar';
import {
  isDemo,
  supportsPublishing,
  supportsSales,
  webAuthMode,
} from './lib/platform';
import SalesListings from './pages/sales/Listings';
import SalesListingEditor from './pages/sales/ListingEditor';
import SalesReview from './pages/sales/PublicationReview';
import SalesInbox from './pages/sales/Inbox';
import SalesShop from './pages/sales/Shop';
import SalesChannels from './pages/sales/Channels';
import SalesDomainSetup from './pages/sales/DomainSetup';
import YourSite from './pages/YourSite';
import { useTabMetrics, type TabMetrics } from './lib/tab-metrics';
import {
  TabLink,
  TabPill,
  TabStrip,
  type TabProps,
} from './components/TabStrip';
import { useSyncState } from './lib/sync-state';
import { ActivityBell } from './components/activity/ActivityBell';
import { Toaster } from '@/components/ui/sonner';
import { portfolioEditor, usePortfolioEditor } from './lib/publication-client';
import './hosted-shell.css';

/**
 * How each page shows as a header tab, by route: which metric its pill shows
 * (a key of useTabMetrics) and how it compacts in narrower windows. Pages
 * themselves are listed in NAV_ITEMS.
 */
const TAB_OPTIONS: Record<
  string,
  { metric?: keyof TabMetrics } & Omit<TabProps, 'icon' | 'label' | 'metric'>
> = {
  '/': { metric: 'domains', pillFrom: 'md' },
  '/public-page': { iconOnlyBelow: 'xl' },
  '/renewals': { metric: 'renewals', pillFrom: 'lg' },
  '/activity': { metric: 'activity', pillFrom: 'lg' },
  '/settings': {
    pillFrom: 'lg',
    // The gear is drawn smaller than the other icons, so it's bumped up.
    iconClassName: 'size-[17px]',
  },
};

export default function App() {
  useEffect(() => {
    if (webAuthMode() !== 'gateway') return;
    // Radix renders dialogs and menus under body, outside the app shell.
    // Give those surfaces the same managed palette as the page they belong to.
    document.documentElement.classList.add('hosted-theme');
    return () => document.documentElement.classList.remove('hosted-theme');
  }, []);
  const { search } = useLocation();
  const publication = usePortfolioEditor();
  useEffect(() => {
    if (!portfolioEditor.isDirty()) return;
    const protect = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [publication]);
  useWeeklyUpdateCheck();
  const appInfo = useAppStore((s) => s.appInfo);
  const displayedVersion =
    webAuthMode() === 'gateway'
      ? appInfo?.hosted?.engineVersion
      : appInfo?.version;
  const hostedCommit =
    webAuthMode() === 'gateway' ? appInfo?.hosted?.sourceCommit : null;
  const displayedRevision =
    hostedCommit && /^[a-f0-9]{40}$/i.test(hostedCommit)
      ? hostedCommit.slice(0, 7)
      : null;
  const hydrateFromCache = useAppStore((s) => s.hydrateFromCache);
  const applyPortfolioCacheUpdate = useAppStore(
    (s) => s.applyPortfolioCacheUpdate,
  );
  const loadFolders = useAppStore((s) => s.loadFolders);
  const loadSettings = useAppStore((s) => s.loadSettings);
  const loadPurchases = useAppStore((s) => s.loadPurchases);
  const loadListPrices = useAppStore((s) => s.loadListPrices);
  const loadDomainEvents = useAppStore((s) => s.loadDomainEvents);
  const loadRegistrars = useAppStore((s) => s.loadRegistrars);
  const attachBulk = useAppStore((s) => s.attachBulk);
  const applyBulkProgress = useAppStore((s) => s.applyBulkProgress);
  const applyBulkFinished = useAppStore((s) => s.applyBulkFinished);
  const navigate = useNavigate();
  const metrics = useTabMetrics();

  // Restore the last-cached portfolio, detail, and pricing on launch so the app
  // opens fully populated with no network calls. The user
  // refreshes manually; we never auto-refresh, even when the data is stale.
  useEffect(() => {
    void hydrateFromCache();
  }, [hydrateFromCache]);

  // Load the user's folders (definitions + assignments) on launch, alongside the
  // cache hydration, so the Domains table paints folder chips immediately.
  useEffect(() => {
    void loadFolders();
    void loadSettings();
    void loadPurchases();
    void loadListPrices();
    void loadDomainEvents();
    // The bell lists sync errors from any page.
    void loadRegistrars();
  }, [
    loadFolders,
    loadSettings,
    loadPurchases,
    loadListPrices,
    loadDomainEvents,
    loadRegistrars,
  ]);

  // The macOS app menu's About DomBot / Check for Updates… / Settings….
  useEffect(
    () => window.api.onNavigateRequested((route) => navigate(route)),
    [navigate],
  );

  // An MCP tool write mutates the on-disk cache out of band; re-read it and
  // overlay the change so an open Domains table updates live, without a Sync.
  useEffect(() => {
    const off = window.api.onPortfolioChanged(
      () => void applyPortfolioCacheUpdate(),
    );
    return off;
  }, [applyPortfolioCacheUpdate]);

  // Mirror the main-process bulk job: pick up one already running (or the last
  // finished one) on launch, then stream item results onto the rows.
  useEffect(() => {
    void attachBulk();
    const offProgress = window.api.onBulkProgress(applyBulkProgress);
    const offFinished = window.api.onBulkFinished(applyBulkFinished);
    return () => {
      offProgress();
      offFinished();
    };
  }, [attachBulk, applyBulkProgress, applyBulkFinished]);

  return (
    <div
      className={cn(
        'flex h-dvh flex-col overflow-hidden bg-background text-foreground',
        webAuthMode() === 'gateway' && 'hosted-app',
      )}
    >
      {isDemo() && <DemoBanner />}
      {/* Three columns: the logo, the tab strip (centered, so the two side
          columns match), and the bell just right of the tabs. The tabs run
          along the bottom edge, on the tab bar color that also shows above
          them. */}
      <header
        className={cn(
          'hosted-topbar relative h-12 border-b bg-tab-bar px-4 sm:px-6',
          supportsPublishing()
            ? 'flex items-center'
            : 'grid grid-cols-[1fr_auto_1fr]',
        )}
      >
        <div className="flex flex-1 items-center">
          <button
            type="button"
            onClick={() => navigate('/')}
            aria-label={
              webAuthMode() === 'gateway'
                ? 'domains.domains — go to Domains'
                : 'DomBot — go to Domains'
            }
            className="group relative -top-px -ml-1 flex items-center gap-2"
          >
            {webAuthMode() === 'gateway' ? (
              <span
                className="text-lg font-semibold tracking-tight whitespace-nowrap"
                style={{ fontFamily: 'Archivo, sans-serif' }}
              >
                domains.domains
              </span>
            ) : (
              <>
                <svg
                  viewBox="0 0 32 32"
                  aria-hidden="true"
                  className="size-[34px]"
                  fill="var(--brand)"
                >
                  <path d="m25 6h-18c-1.06087 0-2.07828.42143-2.82843 1.17157-.75014.75015-1.17157 1.76756-1.17157 2.82843v14c0 1.0609.42143 2.0783 1.17157 2.8284.75015.7502 1.76756 1.1716 2.82843 1.1716h18c1.0609 0 2.0783-.4214 2.8284-1.1716.7502-.7501 1.1716-1.7675 1.1716-2.8284v-14c0-1.06087-.4214-2.07828-1.1716-2.82843-.7501-.75014-1.7675-1.17157-2.8284-1.17157zm2 18c0 .5304-.2107 1.0391-.5858 1.4142s-.8838.5858-1.4142.5858h-18c-.53043 0-1.03914-.2107-1.41421-.5858-.37508-.3751-.58579-.8838-.58579-1.4142v-14c0-.53043.21071-1.03914.58579-1.41421.37507-.37508.88378-.58579 1.41421-.58579h18c.5304 0 1.0391.21071 1.4142.58579.3751.37507.5858.88378.5858 1.41421zm-6.5-7h-9c-.9283 0-1.8185.3687-2.47487 1.0251-.65638.6564-1.02513 1.5466-1.02513 2.4749s.36875 1.8185 1.02513 2.4749c.65637.6564 1.54657 1.0251 2.47487 1.0251h9c.9283 0 1.8185-.3687 2.4749-1.0251s1.0251-1.5466 1.0251-2.4749-.3687-1.8185-1.0251-2.4749-1.5466-1.0251-2.4749-1.0251zm-3.5 2v3h-2v-3zm-7 1.5c0-.3978.158-.7794.4393-1.0607s.6629-.4393 1.0607-.4393h1.5v3h-1.5c-.3978 0-.7794-.158-1.0607-.4393s-.4393-.6629-.4393-1.0607zm10.5 1.5h-1.5v-3h1.5c.3978 0 .7794.158 1.0607.4393s.4393.6629.4393 1.0607-.158.7794-.4393 1.0607-.6629.4393-1.0607.4393z" />
                  <circle cx="10.5" cy="12" r="2" />
                  <circle cx="21.5" cy="12" r="2" />
                </svg>
                <span className="max-w-0 overflow-hidden text-xl font-bold tracking-tight whitespace-nowrap opacity-0 transition-all duration-200 lg:group-hover:max-w-[7ch] lg:group-hover:opacity-100">
                  Dom<span className="text-brand">Bot</span>
                </span>
              </>
            )}
          </button>
        </div>
        {/* Desktop: the tab strip. On phones it collapses into the hamburger
            menu on the right (MobileNav). */}
        <TabStrip
          aria-label="Portfolio navigation"
          className={cn(
            'hosted-nav mr-4 hidden self-end justify-self-end',
            supportsPublishing() ? 'xl:flex' : 'sm:flex',
          )}
        >
          {NAV_ITEMS.filter(
            (item) =>
              (item.to !== '/public-page' || supportsPublishing()) &&
              (item.to !== '/sales' || supportsSales()),
          ).map(({ to, label, icon }) => {
            const { metric, ...options } = TAB_OPTIONS[to] ?? {};
            return (
              <TabLink
                key={to}
                to={to}
                end={to === '/'}
                label={label}
                className={
                  supportsPublishing()
                    ? 'px-2 text-sm xl:px-2 xl:pr-2 2xl:px-4'
                    : undefined
                }
                icon={icon}
                metric={metric ? metrics[metric] : null}
                {...options}
              />
            );
          })}
        </TabStrip>
        {/* Hosted account access, activity, and the global hosted Sync action. */}
        <div
          className={cn(
            'flex items-center gap-2',
            supportsPublishing()
              ? 'shrink-0 justify-end'
              : 'col-start-3 justify-end sm:justify-start sm:pl-3',
          )}
        >
          {webAuthMode() === 'gateway' && (
            <a
              href="/account"
              className="mr-2 hidden text-sm text-muted-foreground hover:text-foreground sm:inline-flex"
            >
              Account
            </a>
          )}
          <span className="mr-2 inline-flex sm:mr-0">
            <ActivityBell />
          </span>
          <MobileNav />
          {supportsPublishing() && <HostedSyncControl />}
          {/* The running version, dim, tucked into the window's top-right
              corner; opens Settings → About. Hidden below lg, where the tab
              pills hide too and the header gets tight. */}
          {displayedVersion && (
            <button
              type="button"
              onClick={() => navigate('/settings?tab=about')}
              className={cn(
                'hidden rounded-sm text-[11px] leading-none text-muted-foreground/40 hover:text-muted-foreground lg:inline',
                !supportsPublishing() && 'absolute top-[7px] right-[10px]',
              )}
              title={
                displayedRevision
                  ? `About this release · source ${displayedRevision}`
                  : 'About this version'
              }
              aria-label={
                displayedRevision
                  ? `About domains.domains release ${displayedVersion}, source ${displayedRevision}`
                  : undefined
              }
            >
              {/* A serif italic "v", dimmer than the monospace digits (like
                  the domain names) and set a little apart from them. */}
              <span className="block">
                <span className="mr-px font-serif text-[12px] italic opacity-60">
                  v
                </span>
                <span className="font-mono text-[10px]">
                  {displayedVersion}
                </span>
              </span>
              {displayedRevision && (
                <span className="mt-1 block font-mono text-[9px]">
                  {displayedRevision}
                </span>
              )}
            </button>
          )}
        </div>
      </header>

      {/* The window never scrolls: header and status bar stay put and this
          area between them scrolls when a page is taller. Its scrollbar gutter
          is always reserved so pages of different heights line up. The top 8px
          fades out, so scrolled content doesn't cut off hard at the tabs. */}
      <main
        id="portfolio-content"
        className="flex min-h-0 flex-1 flex-col overflow-y-auto [scrollbar-gutter:stable] [mask-image:linear-gradient(to_bottom,transparent,black_8px)] px-4 pt-[22px] pb-4 sm:px-6 sm:pt-[31px]"
      >
        <Routes>
          <Route
            path="/"
            element={
              supportsPublishing() ? <YourSite inventory /> : <Domains />
            }
          />
          <Route path="/renewals" element={<Renewals />} />
          <Route path="/activity" element={<Activity />} />
          <Route path="/settings" element={<Settings />} />
          {supportsPublishing() && (
            <>
              <Route path="/sales" element={<SalesListings />} />
              <Route
                path="/sales/listings/:id"
                element={<SalesListingEditor />}
              />
              <Route
                path="/sales/listings/:id/setup"
                element={<SalesDomainSetup />}
              />
              <Route
                path="/sales/bulk-review/:jobId"
                element={<SalesReview />}
              />
              <Route path="/sales/review/:reviewId" element={<SalesReview />} />
              <Route path="/sales/inbox" element={<SalesInbox />} />
              <Route path="/sales/inbox/:id" element={<SalesInbox />} />
              <Route path="/sales/shop" element={<SalesShop />} />
              <Route path="/sales/channels" element={<SalesChannels />} />
            </>
          )}
          {supportsPublishing() && (
            <>
              <Route path="/public-page" element={<YourSite />} />
              <Route
                path="/public-portfolio"
                element={
                  <Navigate to={{ pathname: '/public-page', search }} replace />
                }
              />
            </>
          )}
        </Routes>
      </main>

      {/* App-wide bottom status bar (MCP status + background-load lights). */}
      <StatusBar />

      {/* App-wide: surfaces MCP connection approvals regardless of route. */}
      <ApprovalModal />

      {/* App-wide toast host. Offset above the fixed status bar (h-6). */}
      <Toaster position="bottom-right" offset={32} />
    </div>
  );
}

/** The hosted inventory has its own header; keep its global Sync action. */
function HostedSyncControl() {
  const { sync, syncing, disabled, title } = useSyncState();
  return (
    <Button
      size="sm"
      className="hidden lg:inline-flex"
      onClick={sync}
      disabled={disabled}
      title={title}
    >
      <RefreshCw className={cn('size-3.5', syncing && 'animate-spin')} />
      {syncing ? 'Syncing…' : 'Sync'}
    </Button>
  );
}

const NAV_ITEMS = [
  { to: '/', label: 'Domains', icon: Globe },
  { to: '/sales', label: 'Sales', icon: Globe },
  { to: '/public-page', label: 'Public profile', icon: Globe },
  { to: '/renewals', label: 'Renewals', icon: CalendarClock },
  { to: '/activity', label: 'Activity', icon: History },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
] as const;

/**
 * Phone-only hamburger: the primary destinations in a dropdown, since the
 * labeled nav doesn't fit a narrow header. Hidden at sm+, where the centered nav
 * takes over. The active route is checked.
 */
function MobileNav() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const isActive = (to: string) =>
    to === '/' ? pathname === '/' : pathname.startsWith(to);
  const {
    sync,
    syncing,
    disabled: syncDisabled,
    title: syncTitle,
  } = useSyncState();
  const metrics = useTabMetrics();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          aria-label="Open navigation menu"
          className={supportsPublishing() ? 'xl:hidden' : 'sm:hidden'}
        >
          <Menu />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {NAV_ITEMS.filter(
          (item) =>
            (item.to !== '/public-page' || supportsPublishing()) &&
            (item.to !== '/sales' || supportsSales()),
        ).map(({ to, label, icon: Icon }) => {
          const active = isActive(to);
          const metric = TAB_OPTIONS[to]?.metric;
          return (
            <DropdownMenuItem
              key={to}
              onSelect={() => navigate(to)}
              // The current route is marked by the green fill (matching the
              // desktop nav pill), not a trailing check.
              className={cn(
                'gap-2.5',
                active &&
                  'bg-primary text-primary-foreground focus:bg-primary focus:text-primary-foreground [&_svg]:text-primary-foreground!',
              )}
            >
              <Icon className="size-4 shrink-0" />
              {label}
              <TabPill
                metric={metric ? metrics[metric] : null}
                className={cn(
                  'ml-auto',
                  active && 'bg-white/20 text-primary-foreground',
                )}
              />
            </DropdownMenuItem>
          );
        })}
        {webAuthMode() === 'gateway' && (
          <DropdownMenuItem onSelect={() => window.location.assign('/account')}>
            Account security
          </DropdownMenuItem>
        )}
        {/* The Sync action lives here on phones; on wider screens it's in the
            status bar. Domains has its own in the page header. */}
        {(pathname !== '/' || supportsPublishing()) && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => sync()}
              disabled={syncDisabled}
              title={syncTitle}
              className="gap-2.5"
            >
              <RefreshCw
                className={cn('size-4 shrink-0', syncing && 'animate-spin')}
              />
              {syncing ? 'Syncing…' : 'Sync'}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
