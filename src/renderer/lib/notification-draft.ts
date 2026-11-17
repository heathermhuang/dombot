import { z } from 'zod';
import { notificationPreferencesSchema } from '../../shared/notification-policy';

// A form draft may contain an unfinished timezone. Validate the complete
// preferences only on Save, without dropping the other unsaved fields.
const draftPreferencesSchema = notificationPreferencesSchema.extend({
  timeZone: z.string(),
});
const draftSchema = z
  .object({
    workspaceId: z.string().uuid(),
    preferences: draftPreferencesSchema,
  })
  .strict();

export function notificationDraftKey(workspaceId?: string): string | null {
  return workspaceId && z.string().uuid().safeParse(workspaceId).success
    ? `notification-form:workspace:${workspaceId}`
    : null;
}

export function readNotificationDraft(
  raw: string | null,
  workspaceId?: string,
) {
  if (!raw || !notificationDraftKey(workspaceId)) return null;
  try {
    const result = draftSchema.safeParse(JSON.parse(raw));
    return result.success && result.data.workspaceId === workspaceId
      ? result.data.preferences
      : null;
  } catch {
    return null;
  }
}

export function serializeNotificationDraft(
  workspaceId: string,
  preferences: z.infer<typeof draftPreferencesSchema>,
) {
  return JSON.stringify(draftSchema.parse({ workspaceId, preferences }));
}
