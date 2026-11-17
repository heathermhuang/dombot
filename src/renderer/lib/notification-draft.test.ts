import { describe, expect, it } from 'vitest';
import {
  notificationDefaults,
  notificationPreferencesSchema,
} from '../../shared/notification-policy';
import { savedNotificationSchema } from './notification-client';
import {
  notificationDraftKey,
  readNotificationDraft,
  serializeNotificationDraft,
} from './notification-draft';

const first = '11111111-1111-4111-8111-111111111111';
const second = '22222222-2222-4222-8222-222222222222';

describe('notification form draft ownership', () => {
  it('cannot restore another workspace, an unscoped draft, or a legacy gateway response', () => {
    const raw = serializeNotificationDraft(first, notificationDefaults);
    expect(notificationDraftKey(first)).not.toBe(notificationDraftKey(second));
    expect(readNotificationDraft(raw, second)).toBeNull();
    expect(
      readNotificationDraft(JSON.stringify(notificationDefaults), first),
    ).toBeNull();
    expect(readNotificationDraft(raw, undefined)).toBeNull();
    expect(notificationDraftKey(undefined)).toBeNull();
    expect(
      savedNotificationSchema.parse({
        preferences: notificationDefaults,
        revision: null,
        verified: false,
        deliveryEnabled: false,
        deliveries: [],
      }).workspaceId,
    ).toBeUndefined();
  });

  it.each(['', 'Asia/', 'unfinished-invalid-zone'])(
    'retains an unfinished timezone %j and switch edits, but rejects it for Save',
    (timeZone) => {
      const draft = {
        ...notificationDefaults,
        renewalReminders: true,
        inquiryEmails: false,
        timeZone,
      };
      expect(
        readNotificationDraft(serializeNotificationDraft(first, draft), first),
      ).toEqual(draft);
      expect(notificationPreferencesSchema.safeParse(draft).success).toBe(
        false,
      );
    },
  );

  it('rejects corrupt or structurally invalid stored forms', () => {
    expect(readNotificationDraft('{bad', first)).toBeNull();
    expect(
      readNotificationDraft(
        JSON.stringify({
          workspaceId: first,
          preferences: { ...notificationDefaults, inquiryEmails: 'yes' },
        }),
        first,
      ),
    ).toBeNull();
  });
});
