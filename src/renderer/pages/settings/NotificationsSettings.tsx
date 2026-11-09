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

export default function NotificationsSettings() {
  const [saved, setSaved] = useState<SavedNotifications | null>(null);
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [draft, setDraft] = useState<NotificationPreferences | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  useEffect(() => {
    let live = true;
    void notificationRequest('/account/notifications')
      .then((value) => {
        if (!live) return;
        const data = savedNotificationSchema.parse(value);
        setSaved(data);
        setPrefs(
          data.revision === null
            ? {
                ...data.preferences,
                timeZone:
                  Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
              }
            : data.preferences,
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
  }, []);
  const save = async () => {
    if (!prefs || !saved || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await notificationRequest(
        '/account/notifications',
        'PATCH',
        { preferences: prefs, revision: saved.revision },
      );
      setSaved({
        ...saved,
        preferences: result.preferences,
        revision: result.revision,
      });
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
  ) => setPrefs((p) => (p ? { ...p, [key]: value } : p));
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
          {error}
        </p>
      )}
      {!prefs || !saved ? (
        !error && <p role="status">Loading notification settings…</p>
      ) : (
        <>
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
          <div className="flex items-center gap-3">
            <Button onClick={() => void save()} disabled={busy}>
              {busy ? 'Saving…' : 'Save preferences'}
            </Button>
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
