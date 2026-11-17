import { hostPath } from '../../lib/platform';
import { notificationPreferencesSchema } from '../../../shared/notification-policy';
import { useEffect, useState } from 'react';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { SettingsCard, SettingsField } from './SettingsCard';
import {
  notificationRequest,
  savedNotificationSchema,
  type SavedNotifications,
} from '../../lib/notification-client';
import type { NotificationPreferences } from '../../../shared/notification-policy';
import {
  notificationDraftKey,
  readNotificationDraft,
  serializeNotificationDraft,
} from '../../lib/notification-draft';

export default function NotificationsSettings() {
  const [saved, setSaved] = useState<SavedNotifications | null>(null);
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [draft, setDraft] = useState<NotificationPreferences | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [attempt, setAttempt] = useState(0);
  const draftKey = notificationDraftKey(saved?.workspaceId);
  const dirty =
    !!prefs &&
    !!saved &&
    JSON.stringify(prefs) !== JSON.stringify(saved.preferences);
  useEffect(() => {
    let live = true;
    setError('');
    void notificationRequest('/account/notifications')
      .then((value) => {
        if (!live) return;
        const data = savedNotificationSchema.parse(value);
        setSaved(data);
        let localDraft: NotificationPreferences | null = null;
        try {
          const key = notificationDraftKey(data.workspaceId);
          if (key)
            localDraft = readNotificationDraft(
              sessionStorage.getItem(key),
              data.workspaceId,
            );
        } catch {
          /* Invalid drafts never change saved preferences. */
        }
        setPrefs(
          localDraft ??
            (data.revision === null
              ? {
                  ...data.preferences,
                  timeZone:
                    Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
                }
              : data.preferences),
        );
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    void notificationRequest(hostPath('/notifications/preference-draft'))
      .then((value) => {
        if (live && value.preferences)
          setDraft(notificationPreferencesSchema.parse(value.preferences));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [attempt]);
  useEffect(() => {
    if (!saved?.workspaceId || !prefs || !draftKey) return;
    try {
      if (dirty)
        sessionStorage.setItem(
          draftKey,
          serializeNotificationDraft(saved.workspaceId, prefs),
        );
      else sessionStorage.removeItem(draftKey);
    } catch {
      /* Browser storage can be unavailable; the in-memory draft remains. */
    }
  }, [dirty, draftKey, prefs, saved]);
  useEffect(() => {
    if (!dirty) return;
    const protect = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [dirty]);
  const save = async () => {
    if (!prefs || !saved || busy) return;
    const parsed = notificationPreferencesSchema.safeParse(prefs);
    if (!parsed.success) {
      setNotice('');
      setError(parsed.error.issues[0]?.message ?? 'Check your preferences.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await notificationRequest(
        '/account/notifications',
        'PATCH',
        { preferences: parsed.data, revision: saved.revision },
      );
      setSaved({
        ...saved,
        preferences: result.preferences,
        revision: result.revision,
      });
      setPrefs(result.preferences);
      setNotice('Notification preferences saved.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Settings could not be saved.');
    } finally {
      setBusy(false);
    }
  };
  const change = (
    key: keyof NotificationPreferences,
    value: boolean | string,
  ) => {
    setNotice('');
    setPrefs((p) => (p ? { ...p, [key]: value } : p));
  };
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-bold">Notifications</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Useful updates for your portfolio. Sign-in and security messages stay
          separate.
        </p>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}{' '}
          <Button variant="outline" onClick={() => setAttempt((n) => n + 1)}>
            Retry loading preferences
          </Button>
        </p>
      )}
      {!prefs || !saved ? (
        !error && <p role="status">Loading notification settings…</p>
      ) : (
        <>
          {saved.address && (
            <p className="text-sm">
              Delivery address: <strong>{saved.address}</strong> ·{' '}
              {saved.verified ? 'Email confirmed' : 'Email confirmation needed'}
              .{' '}
              <a className="underline" href="/account">
                Account security
              </a>
            </p>
          )}
          {draft && (
            <div className="rounded-lg border p-4">
              <p className="text-sm">
                This portfolio has preferences from a restored backup. Review
                them before applying.
              </p>
              <Button
                variant="outline"
                className="mt-2"
                onClick={() => {
                  setNotice('');
                  setPrefs(draft);
                  setDraft(null);
                }}
              >
                Review restored preferences
              </Button>
            </div>
          )}
          <SettingsCard
            title="Email preferences"
            contentClassName="flex flex-col gap-5"
          >
            <SettingsField
              label="Domain inquiries"
              htmlFor="notify-inquiries"
              description="Email me when an inquiry is confirmed or a buyer sends a message. Your replies still reach the buyer when this is off."
            >
              <div className="flex items-center">
                <Switch
                  id="notify-inquiries"
                  checked={prefs.inquiryEmails}
                  disabled={busy}
                  onCheckedChange={(v) => change('inquiryEmails', v)}
                />
              </div>
            </SettingsField>
            <SettingsField
              label="Renewal reminders"
              htmlFor="notify-renewals"
              description="Group new renewal reviews into one weekly email. Near deadlines that cannot wait get a separate alert. No daily report."
            >
              <div className="flex items-center">
                <Switch
                  id="notify-renewals"
                  checked={prefs.renewalReminders}
                  disabled={busy || !saved.verified}
                  onCheckedChange={(v) => change('renewalReminders', v)}
                />
              </div>
            </SettingsField>
            <SettingsField
              label="Weekly renewal overview"
              htmlFor="notify-overview"
              description="An optional Monday overview of upcoming renewals, including names with auto-renew enabled. Empty overviews are skipped."
            >
              <div className="flex items-center">
                <Switch
                  id="notify-overview"
                  checked={prefs.weeklyOverview}
                  disabled={busy || !saved.verified}
                  onCheckedChange={(v) => change('weeklyOverview', v)}
                />
              </div>
            </SettingsField>
            <SettingsField
              label="Timezone"
              htmlFor="notify-timezone"
              description="Weekly emails are prepared on Monday at 09:00 in this timezone."
            >
              <Input
                id="notify-timezone"
                list="notification-timezones"
                className="w-full max-w-xs"
                value={prefs.timeZone}
                disabled={busy}
                onChange={(e) => change('timeZone', e.target.value)}
                placeholder="Asia/Singapore"
              />
            </SettingsField>
          </SettingsCard>
          {!saved.verified && (
            <p className="text-sm text-muted-foreground">
              To enable portfolio reminders, verify your account address by
              signing in with an email link. A passkey alone does not verify an
              email address.
            </p>
          )}
          {!saved.deliveryEnabled && (
            <p className="text-sm text-muted-foreground">
              Portfolio email delivery is being prepared. You can save
              preferences now; reminders will start after delivery is enabled.
            </p>
          )}
          {saved.deliveries.some((d) =>
            ['unknown', 'failed', 'suppressed'].includes(d.state),
          ) && (
            <p className="text-sm text-muted-foreground">
              Some portfolio email needs delivery review. Unknown outcomes are
              held to avoid sending duplicates. Contact domains@domains.domains
              if a message is missing.
            </p>
          )}
          <datalist id="notification-timezones">
            {timezoneChoices.map((zone) => (
              <option key={zone} value={zone} />
            ))}
          </datalist>
          <p className="text-sm text-muted-foreground">
            {timezonePreview(prefs.timeZone)}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => void save()} disabled={busy || !dirty}>
              {busy ? 'Saving…' : 'Save preferences'}
            </Button>
            {dirty && (
              <p role="status" className="text-sm">
                Unsaved changes
              </p>
            )}
            {notice && (
              <p role="status" className="text-sm">
                {notice}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

const timezoneChoices = [
  ...new Set(['UTC', ...(Intl.supportedValuesOf?.('timeZone') ?? [])]),
];
function timezonePreview(timeZone: string) {
  try {
    return `Weekly emails: Monday at 09:00. Current local time: ${new Intl.DateTimeFormat(undefined, { timeZone, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date())}.`;
  } catch {
    return 'Choose a valid timezone from the suggestions before saving.';
  }
}
