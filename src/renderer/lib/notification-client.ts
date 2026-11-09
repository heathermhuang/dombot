import { z } from 'zod';
import { notificationPreferencesSchema } from '../../shared/notification-policy';

export const savedNotificationSchema = z.object({
  preferences: notificationPreferencesSchema,
  revision: z.string().uuid().nullable(),
  verified: z.boolean(),
  deliveryEnabled: z.boolean(),
  deliveries: z.array(z.object({ state: z.string(), count: z.number() })),
});
export type SavedNotifications = z.infer<typeof savedNotificationSchema>;
export async function notificationRequest(
  path: string,
  method = 'GET',
  body?: unknown,
) {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    signal: AbortSignal.timeout(15_000),
    ...(body === undefined
      ? {}
      : {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
  });
  const value = await response.json();
  if (!response.ok)
    throw new Error(value.error ?? 'Notification settings are unavailable.');
  return value;
}
