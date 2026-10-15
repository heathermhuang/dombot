import { Building2 } from 'lucide-react';
import type { RegistrarName } from '../../shared/ipc';
import { cn } from '@/lib/utils';

// Brand SVGs live with the marketing site (site/src/assets/logos); share that
// one folder so adding a registrar is just dropping in `<name>.svg` — the glob
// picks it up here, no import to edit. Keyed by filename, which matches the
// RegistrarName (e.g. godaddy.svg → "godaddy").
const LOGO_RAW = import.meta.glob('../../../site/src/assets/logos/*.svg', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const LOGOS: Record<string, string> = Object.fromEntries(
  Object.entries(LOGO_RAW).map(([path, svg]) => [
    path
      .split('/')
      .pop()!
      .replace(/\.svg$/, ''),
    svg,
  ]),
);

/** SVGs are decoded only as CSS images, never inserted as document markup.
 * Alpha masking preserves the monochrome currentColor treatment without
 * interpreting exported style/comment strings as a sanitizer. */
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
  const svg = LOGOS[name];
  if (!svg) return null;
  return (
    <span
      role="img"
      aria-label={`${label} logo`}
      className={cn(
        'inline-flex size-[27px] shrink-0 items-center justify-center text-muted-foreground/70',
        className,
      )}
      style={{
        backgroundColor: 'currentColor',
        maskImage: `url("data:image/svg+xml,${encodeURIComponent(svg)}")`,
        maskRepeat: 'no-repeat',
        maskPosition: 'center',
        maskSize: 'contain',
      }}
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
