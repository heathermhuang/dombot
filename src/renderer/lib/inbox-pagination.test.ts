import { describe, expect, it } from 'vitest';
import { navigateInboxPage } from './inbox-pagination';

describe('inbox cursor navigation', () => {
  it('ignores every page action during loading', () => {
    const history = ['', 'page-2'];
    for (const direction of ['first', 'previous', 'next'] as const)
      expect(
        navigateInboxPage(history, 'page-2', direction, 'page-3', true),
      ).toBe(history);
  });
  it('ignores repeated Next clicks and retained duplicate response cursors', () => {
    const page2 = navigateInboxPage([''], '', 'next', 'page-2', false);
    expect(navigateInboxPage(page2, '', 'next', 'page-2', false)).toBe(page2);
    expect(navigateInboxPage(page2, 'page-2', 'next', 'page-2', false)).toBe(
      page2,
    );
  });
  it('backs up exactly one page, ignores a stale Previous, and retains earlier cursors', () => {
    const page3 = ['', 'page-2', 'page-3'];
    const page2 = navigateInboxPage(
      page3,
      'page-3',
      'previous',
      'page-4',
      false,
    );
    expect(page2).toEqual(['', 'page-2']);
    expect(
      navigateInboxPage(page2, 'page-3', 'previous', 'page-4', false),
    ).toBe(page2);
    expect(navigateInboxPage(page2, 'page-2', 'next', 'page-3', false)).toEqual(
      page3,
    );
    expect(
      navigateInboxPage(page3, 'page-3', 'first', undefined, false),
    ).toEqual(['']);
  });
});
