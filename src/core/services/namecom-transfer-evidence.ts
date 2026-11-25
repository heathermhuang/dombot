import { z } from 'zod';
import { isDomainKey, toAscii } from '../../shared/domain-name';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const accountId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,159}$/i);
const evidenceSchema = z
  .object({
    workspace: z.string().uuid(),
    transfers: z
      .array(
        z
          .object({
            domain: z
              .string()
              .refine(
                (value) => isDomainKey(value) && toAscii(value) === value,
              ),
            namecomAccount: accountId,
            dynadotAccount: accountId,
            namecomExpiry: day,
            dynadotExpiry: day,
          })
          .strict(),
      )
      .max(100),
  })
  .strict();

type Transfer = z.infer<typeof evidenceSchema>['transfers'][number];
let evidence = new Map<string, Map<string, Transfer>>();

/** A hosted operator may supply exact observations from the authoritative
 * registry for this workspace. Invalid or mismatched input applies nothing. */
export function configureNamecomTransferEvidence(
  workspace: string | undefined,
  input: unknown,
): void {
  evidence = new Map();
  if (!workspace || typeof input !== 'string' || input.length > 30_000) return;
  try {
    const verified = evidenceSchema.parse(JSON.parse(input));
    if (verified.workspace !== workspace) return;
    const results = new Map<string, Map<string, Transfer>>();
    for (const row of verified.transfers) {
      if (
        row.namecomAccount === row.dynadotAccount ||
        row.namecomExpiry >= row.dynadotExpiry
      )
        return;
      const account = results.get(row.namecomAccount) ?? new Map();
      if (account.has(row.domain)) return;
      account.set(row.domain, row);
      results.set(row.namecomAccount, account);
    }
    evidence = results;
  } catch {
    // Ignore unavailable or malformed operator evidence without logging it.
  }
}

export function namecomTransferEvidence(
  account: string,
): ReadonlyMap<string, Transfer> | undefined {
  return evidence.get(account);
}
