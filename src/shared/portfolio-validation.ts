import { draftSchema, type PortfolioDraft } from './publication';
export const currencies = [
  'USD',
  'HKD',
  'EUR',
  'GBP',
  'SGD',
  'CNY',
  'JPY',
  'AUD',
  'CAD',
  'CHF',
  'NZD',
  'INR',
  'KRW',
  'AED',
];
export interface PortfolioIssue {
  field: string;
  domain?: string;
  message: string;
}
const messages: Record<string, string> = {
  handle: 'Use 1–40 lowercase letters, numbers or internal hyphens.',
  title: 'Enter a portfolio name (up to 100 characters).',
  contactEmail: 'Enter a valid email address, or leave it empty.',
  askingPrice:
    'Enter a price greater than zero and no more than 1 trillion, or leave it empty.',
  currency: 'Choose a three-letter currency.',
};
export function portfolioIssues(draft: PortfolioDraft): PortfolioIssue[] {
  const result = draftSchema.safeParse(draft);
  if (result.success) return [];
  return result.error.issues.map((issue) => {
    const field = String(issue.path[issue.path.length - 1]);
    const domain =
      issue.path[0] === 'listings' && typeof issue.path[1] === 'number'
        ? draft.listings[issue.path[1]]?.domain
        : undefined;
    return { field, domain, message: messages[field] ?? issue.message };
  });
}
/** Save independent valid edits while the invalid values remain in the editor. */
export function validDraftEdits(
  input: PortfolioDraft,
  previous: PortfolioDraft,
): PortfolioDraft {
  const next = structuredClone(input);
  const result = draftSchema.safeParse(input);
  if (result.success) return input;
  for (const issue of result.error.issues) {
    if (
      issue.path[0] === 'listings' &&
      typeof issue.path[1] === 'number' &&
      issue.path.length === 3
    ) {
      const index = issue.path[1];
      const old = previous.listings.find(
        (item) => item.domain === input.listings[index].domain,
      );
      if (!old) return previous;
      const key = issue.path[2] as keyof typeof old;
      Object.assign(next.listings[index], { [key]: old[key] });
    } else if (issue.path.length === 1 && issue.path[0] !== 'listings') {
      const key = issue.path[0] as keyof PortfolioDraft;
      Object.assign(next, { [key]: previous[key] });
    } else return previous;
  }
  return next;
}
