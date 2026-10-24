import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { DraftSession, type DraftClient } from './draft-session';

const schema = z.object({ url: z.string().url() });
type Draft = z.infer<typeof schema>;
type State = {
  draft: Draft;
  revision: string;
  publishedSnapshot: object | null;
};
function fixture() {
  const api: DraftClient<Draft, State> = {
    load: vi.fn(async () => ({
      draft: { url: 'https://saved.example' },
      revision: 'r0',
      publishedSnapshot: {},
    })),
    save: vi.fn(async () => ({ revision: 'r1' })),
    publish: vi.fn(async () => ({ url: '/p/sample' })),
    unpublish: vi.fn(async () => ({ revision: 'removed-r1' })),
  };
  const session = new DraftSession(
    api,
    {
      schema,
      editable: (s) => s.draft,
      issues: (d) => (schema.safeParse(d).success ? [] : ['Invalid URL']),
      valid: (_draft, saved) => saved,
    },
    60_000,
  );
  return { api, session };
}

describe('public removal independent of unfinished draft edits', () => {
  it('removes with the saved revision, keeps invalid fields, and uses the removal receipt for the next save', async () => {
    const { api, session } = fixture();
    await session.load();
    session.update({ url: '' });
    await session.unpublish();
    expect(api.save).not.toHaveBeenCalled();
    expect(api.unpublish).toHaveBeenCalledWith('r0');
    expect(api.load).toHaveBeenCalledTimes(1);
    expect(session.getSnapshot()).toMatchObject({
      draft: { url: '' },
      status: 'unsaved',
      state: { revision: 'removed-r1', publishedSnapshot: null },
    });
    session.update({ url: 'https://next.example' });
    await session.flush();
    expect(api.save).toHaveBeenCalledWith(
      { url: 'https://next.example' },
      'removed-r1',
    );
    expect(api.publish).not.toHaveBeenCalled();
  });

  it('settles an already-sent save before removing, without draining newer invalid edits', async () => {
    const { api, session } = fixture();
    let finish!: (value: { revision: string }) => void;
    api.save = vi.fn(
      () =>
        new Promise<{ revision: string }>((resolve) => {
          finish = resolve;
        }),
    );
    await session.load();
    session.update({ url: 'https://first.example' });
    const saving = session.flush();
    session.update({ url: '' });
    const removing = session.unpublish();
    await Promise.resolve();
    finish({ revision: 'saved-r1' });
    await removing;
    await expect(saving).rejects.toThrow('highlighted fields');
    expect(api.save).toHaveBeenCalledTimes(1);
    expect(api.unpublish).toHaveBeenCalledWith('saved-r1');
    expect(session.getSnapshot().draft).toEqual({ url: '' });
    expect(session.getSnapshot().state?.publishedSnapshot).toBeNull();
  });

  it('holds saves during removal and keeps edits made while waiting', async () => {
    const { api, session } = fixture();
    let finish!: (value: { revision: string }) => void;
    api.unpublish = vi.fn(
      () =>
        new Promise<{ revision: string }>((resolve) => {
          finish = resolve;
        }),
    );
    await session.load();
    const removing = session.unpublish();
    await Promise.resolve();
    session.update({ url: 'https://while-removing.example' });
    const saving = session.flush();
    expect(api.save).not.toHaveBeenCalled();
    finish({ revision: 'removed-r2' });
    await removing;
    await saving;
    expect(api.save).toHaveBeenCalledWith(
      { url: 'https://while-removing.example' },
      'removed-r2',
    );
  });

  it('does not adopt a later foreign revision and surfaces a concurrent save conflict', async () => {
    const { api, session } = fixture();
    await session.load();
    api.load = vi.fn(async () => ({
      draft: { url: 'https://other-tab.example' },
      revision: 'foreign',
      publishedSnapshot: null,
    }));
    api.save = vi.fn(async (_draft, revision) => {
      expect(revision).toBe('removed-r1');
      throw Object.assign(new Error('Changed in another tab'), { status: 409 });
    });
    await session.unpublish();
    session.update({ url: 'https://my-edit.example' });
    await expect(session.flush()).rejects.toThrow('another tab');
    expect(api.load).not.toHaveBeenCalled();
    expect(session.getSnapshot().draft?.url).toBe('https://my-edit.example');
  });

  it('preserves the public baseline and edits on rejected removal, then permits a request retry', async () => {
    const { api, session } = fixture();
    api.unpublish = vi
      .fn()
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValueOnce({ revision: 'removed-r1' });
    await session.load();
    session.update({ url: '' });
    await expect(session.unpublish()).rejects.toThrow('Offline');
    expect(session.getSnapshot().state?.publishedSnapshot).toEqual({});
    await session.unpublish();
    expect(session.getSnapshot().draft?.url).toBe('');
    expect(session.getSnapshot().state?.publishedSnapshot).toBeNull();
  });

  it('locks editing safely when an older coordinator omits the removal revision', async () => {
    const { api, session } = fixture();
    api.unpublish = vi.fn(async () => ({ ok: true }));
    await session.load();
    session.update({ url: '' });
    await session.unpublish();
    expect(session.getSnapshot()).toMatchObject({
      status: 'error',
      state: { publishedSnapshot: null },
      draft: { url: '' },
    });
    expect(session.getSnapshot().error).toContain('Public profile removed');
    await expect(session.flush()).rejects.toThrow('Reload');
    expect(api.load).toHaveBeenCalledTimes(1);
    expect(api.save).not.toHaveBeenCalled();
  });
});
