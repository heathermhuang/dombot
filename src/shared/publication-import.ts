import {
  canonicalDomain,
  listingSchema,
  privateListing,
  type PortfolioListing,
} from './publication';

function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = '',
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && (char === ',' || char === '\t' || char === '\n')) {
      row.push(cell.replace(/\r$/, ''));
      cell = '';
      if (char === '\n') {
        if (row.some((v) => v.trim())) rows.push(row);
        row = [];
      }
    } else cell += char;
  }
  if (quoted) throw new Error('Unclosed quote in CSV.');
  row.push(cell.replace(/\r$/, ''));
  if (row.some((v) => v.trim())) rows.push(row);
  return rows;
}

/** Imports are candidates, never publication authorization. Existing edits win. */
export function importPublication(
  text: string,
  existing: PortfolioListing[],
): { listings: PortfolioListing[]; added: number; duplicates: number } {
  if (text.length > 4 * 1024 * 1024)
    throw new Error('Choose a file smaller than 4 MB.');
  const source = text.replace(/^\uFEFF/, '').trim();
  if (!source) throw new Error('Add domain names or a CSV file first.');
  let candidates: unknown[];
  if (source.startsWith('[')) {
    const parsed: unknown = JSON.parse(source);
    if (!Array.isArray(parsed)) throw new Error('Expected a JSON array.');
    candidates = parsed;
  } else {
    const rows = csvRows(source);
    const headers = rows[0].map((v) =>
      v.trim().toLowerCase().replace(/[ _-]/g, ''),
    );
    const domainIndex = headers.findIndex((v) =>
      ['domain', 'domainname', 'name'].includes(v),
    );
    if (domainIndex >= 0) {
      const at = (row: string[], key: string) =>
        row[headers.indexOf(key)]?.trim() ?? '';
      candidates = rows.slice(1).map((row) => ({
        domain: row[domainIndex]?.trim(),
        collection: at(row, 'collection'),
        description: at(row, 'description'),
        askingPrice: at(row, 'askingprice')
          ? Number(at(row, 'askingprice'))
          : null,
        currency: at(row, 'currency') || 'USD',
      }));
    } else
      candidates = rows
        .flat()
        .map((domain) => ({ domain: domain.trim() }))
        .filter((v) => v.domain);
  }
  if (candidates.length > 20_000)
    throw new Error('Import at most 20,000 domains at once.');
  const result = new Map(existing.map((item) => [item.domain, item]));
  let duplicates = 0;
  for (const [index, raw] of candidates.entries()) {
    try {
      if (!raw || typeof raw !== 'object') throw new Error('Invalid row');
      const row = raw as Record<string, unknown>;
      if (typeof row.domain !== 'string') throw new Error('Missing domain');
      const name = canonicalDomain(row.domain);
      const item = listingSchema.parse({
        ...privateListing(name),
        collection: row.collection ?? '',
        description: row.description ?? '',
        askingPrice: row.askingPrice ?? null,
        currency: row.currency ?? 'USD',
      });
      if (result.has(name)) duplicates++;
      else result.set(name, item);
    } catch {
      throw new Error(
        `Import row ${index + 1} is invalid. Check its domain, asking price, and currency. Nothing was imported.`,
      );
    }
  }
  if (result.size > 20_000)
    throw new Error('The combined draft exceeds 20,000 domains.');
  return {
    listings: [...result.values()],
    added: result.size - existing.length,
    duplicates,
  };
}
