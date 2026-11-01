import { Building2, Store } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { RegistrarName } from '../../shared/ipc';
import { cn } from '@/lib/utils';

// Brand SVGs live with the marketing site (site/src/assets/logos); share that
// one folder so adding a registrar or market is just dropping in `<name>.svg`
// — the glob picks it up here, no import to edit. Keyed by filename, which
// matches the RegistrarName or market id (e.g. godaddy.svg → "godaddy").
const LOGO_URLS = import.meta.glob('../../../site/src/assets/logos/*.svg', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const LOGOS: Record<string, string> = Object.fromEntries(
  Object.entries(LOGO_URLS).map(([path, src]) => [
    path
      .split('/')
      .pop()!
      .replace(/\.svg$/, ''),
    src,
  ]),
);

/** Render reviewed SVG assets as isolated image masks, never injected HTML. */
function logoStyle(src: string): CSSProperties {
  const image = `url(${JSON.stringify(src)})`;
  return {
    maskImage: image,
    WebkitMaskImage: image,
    maskSize: 'contain',
    WebkitMaskSize: 'contain',
    maskRepeat: 'no-repeat',
    WebkitMaskRepeat: 'no-repeat',
    maskPosition: 'center',
    WebkitMaskPosition: 'center',
  };
}

/**
 * The registrar's logo, shown as a small grey mark before the name. Reuses the
 * marketing site's brand SVGs, flattened to `currentColor` for a uniform tint.
 */
export function RegistrarLogo({
  name,
  label,
  className,
}: {
  name: RegistrarName;
  label: string;
  className?: string;
}) {
  const src = Object.hasOwn(LOGOS, name) ? LOGOS[name] : undefined;
  if (!src) return null;
  return (
    <span
      role="img"
      aria-label={`${label} logo`}
      className={cn(
        'inline-block size-[27px] shrink-0 bg-current text-muted-foreground/85',
        className,
      )}
      style={logoStyle(src)}
    />
  );
}

/**
 * A market's logo (e.g. Afternic), drawn like RegistrarLogo; a store icon
 * when there's none, or no single market to show.
 */
export function MarketLogo({
  market,
  label,
  className,
}: {
  market: string | null;
  label: string;
  className?: string;
}) {
  const src =
    market && Object.hasOwn(LOGOS, market) ? LOGOS[market] : undefined;
  if (!src) return <Store className={cn('shrink-0', className)} aria-hidden />;
  return (
    <span
      role="img"
      aria-label={`${label} logo`}
      className={cn('inline-block size-4 shrink-0 bg-current', className)}
      style={logoStyle(src)}
    />
  );
}

/**
 * The mark for a registrar on a name you added by hand: a faint building, no
 * brand logo, so it reads apart from a connected account's names.
 */
export function ImportedRegistrarIcon({ className }: { className?: string }) {
  return (
    <Building2
      className={cn('size-4 shrink-0 text-muted-foreground/40', className)}
      aria-hidden
    />
  );
}
