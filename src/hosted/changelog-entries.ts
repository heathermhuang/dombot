import feed from '../../site/public/changelog.json';
import { parseChangelogFeed } from './changelog-schema';

/** Bundled recovery snapshot; the public page refreshes the same feed from main. */
export const changelogEntries = parseChangelogFeed(feed);
export type { ChangelogEntry } from './changelog-schema';
