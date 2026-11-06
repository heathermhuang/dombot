import feed from '../../site/public/changelog-legacy.json';
import { parseChangelogFeed } from './changelog-schema';

/** Bundled recovery snapshot; legacy root permalinks remain available while new history is paged. */
export const changelogEntries = parseChangelogFeed(feed);
export type { ChangelogEntry } from './changelog-schema';
