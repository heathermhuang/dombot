/**
 * One non-resetting allowance across auth and inquiry email. This is an
 * operator-configured cap, never a client-supplied campaign or limit.
 */
export async function reserveCampaignEmail(
  env: HostedEnv,
): Promise<{ allowed: boolean; retryAfter: number }> {
  const configured = [
    env.EMAIL_CAMPAIGN_ID,
    env.EMAIL_CAMPAIGN_LIMIT,
    env.EMAIL_CAMPAIGN_DAILY_LIMIT,
  ];
  if (configured.every((value) => !value))
    return { allowed: true, retryAfter: 0 };
  const [id, total, daily] = configured;
  const validLimit = (value: string | undefined, max: number) =>
    !!value && /^[1-9]\d*$/.test(value) && Number(value) <= max;
  if (
    !id ||
    !/^[a-z0-9-]{1,64}$/.test(id) ||
    !validLimit(total, 25_000) ||
    !validLimit(daily, 10_000)
  )
    return { allowed: false, retryAfter: 0 };
  const now = new Date();
  const midnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
  );
  const buckets = [
    // Hourly cleanup must never reset the approved lifetime allowance.
    { key: `campaign:${id}`, limit: Number(total), expires: 253402300799000 },
    {
      key: `campaign-day:${id}:${now.toISOString().slice(0, 10)}`,
      limit: Number(daily),
      expires: midnight + 86400_000,
    },
  ];
  const rows = await env.CONTROL_DB.batch<{ count: number }>(
    buckets.map((bucket) =>
      env.CONTROL_DB.prepare(
        'INSERT INTO email_budgets(bucket,count,expires_at) VALUES(?1,1,?2) ON CONFLICT(bucket) DO UPDATE SET count=count+1 RETURNING count',
      ).bind(bucket.key, bucket.expires),
    ),
  );
  if (
    rows.some(
      (row) =>
        !Number.isSafeInteger(row.results[0]?.count) ||
        row.results[0].count < 1,
    )
  )
    return { allowed: false, retryAfter: 0 };
  if (Number(rows[0].results[0]?.count) > buckets[0].limit)
    return { allowed: false, retryAfter: 0 };
  if (Number(rows[1].results[0]?.count) > buckets[1].limit)
    return {
      allowed: false,
      retryAfter: Math.max(1, Math.ceil((midnight - Date.now()) / 1000)),
    };
  return { allowed: true, retryAfter: 0 };
}
