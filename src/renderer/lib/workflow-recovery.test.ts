import { describe, expect, it } from 'vitest';
import { portfolioPagePath } from './portfolio-navigation';
import { InquiryDraft, localDateTime } from './inquiry-draft';

describe('legacy publication journey', () => {
  it('keeps legacy mode across edit, preview, review and back to settings', () => {
    let path = '/public-page?legacy=1';
    for (const view of ['preview', 'domains', 'review', 'settings'] as const) {
      path = portfolioPagePath(
        view,
        new URL(path, 'https://app.example').search,
      );
      const params = new URL(path, 'https://app.example').searchParams;
      expect(params.get('legacy')).toBe('1');
      expect(params.get('view')).toBe(
        view === 'settings' || view === 'domains' ? null : view,
      );
    }
    expect(portfolioPagePath('domains', '?legacy=1')).toBe('/?legacy=1');
    expect(portfolioPagePath('review', '')).toBe('/public-page?view=review');
  });
});
describe('inquiry compose recovery', () => {
  it('keeps reply and private-note contents and retry keys separate', () => {
    const draft = new InquiryDraft();
    draft.setBody('reply', 'Buyer reply');
    const replyKey = draft.getSnapshot().reply.key;
    draft.setMode('private-note');
    draft.setBody('private-note', 'Private floor');
    draft.setMode('reply');
    expect(draft.getSnapshot().reply).toEqual({
      body: 'Buyer reply',
      key: replyKey,
    });
    draft.sent('reply', replyKey);
    expect(draft.getSnapshot().reply.body).toBe('');
    expect(draft.getSnapshot()['private-note'].body).toBe('Private floor');
    expect(draft.isDirty()).toBe(true);
  });
  it('preserves a newer edit when an earlier send finishes', () => {
    const draft = new InquiryDraft();
    draft.setBody('reply', 'First reply');
    const key = draft.getSnapshot().reply.key;
    draft.setBody('reply', 'New reply while response is pending');
    draft.sent('reply', key);
    expect(draft.getSnapshot().reply.body).toBe(
      'New reply while response is pending',
    );
  });
  it('releases unsent work after a successful inquiry deletion', () => {
    const draft = new InquiryDraft();
    draft.setBody('reply', 'Unsent');
    draft.setBody('private-note', 'Private');
    draft.clear();
    expect(draft.isDirty()).toBe(false);
    expect(draft.getSnapshot().reply.body).toBe('');
    expect(draft.getSnapshot()['private-note'].body).toBe('');
  });
  it('formats the saved reminder in the input local time, including empty state', () => {
    const date = new Date(2026, 9, 22, 13, 5);
    expect(localDateTime(date.getTime())).toBe('2026-10-22T13:05');
    expect(new Date(localDateTime(date.getTime())).getTime()).toBe(
      date.getTime(),
    );
    expect(localDateTime(null)).toBe('');
  });
});
