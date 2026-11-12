import { Button } from '@/components/ui/button';

export default function WebEntry({
  state,
  managed,
  onRetry,
  returnTo,
}: {
  state: 'loading' | 'unavailable' | 'sign-in';
  managed: boolean;
  onRetry: () => void;
  returnTo: string;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <section
        aria-live="polite"
        className="w-full max-w-sm space-y-4 rounded-lg border p-6"
      >
        <p className="text-xl font-bold tracking-tight">
          {managed ? 'domains.domains' : 'DomBot'}
        </p>
        <h1 className="text-lg font-semibold">
          {state === 'loading'
            ? 'Opening your portfolio…'
            : state === 'sign-in'
              ? 'Sign in to your account'
              : 'Couldn’t open your portfolio'}
        </h1>
        <p className="text-sm text-muted-foreground">
          {state === 'loading'
            ? 'Checking your session.'
            : state === 'sign-in'
              ? 'Continue with your account to open this portfolio.'
              : 'Your account status could not be checked. Try again to continue.'}
        </p>
        {state === 'unavailable' && (
          <Button onClick={onRetry} className="w-full">
            Try again
          </Button>
        )}
        {state !== 'loading' && managed && (
          <Button
            asChild
            variant={state === 'sign-in' ? 'default' : 'outline'}
            className="w-full"
          >
            <a href={`/login?next=${encodeURIComponent(returnTo)}`}>
              Continue to account sign-in
            </a>
          </Button>
        )}
      </section>
    </main>
  );
}
