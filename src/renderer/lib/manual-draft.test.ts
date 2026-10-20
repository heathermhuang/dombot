import { describe, expect, it } from 'vitest';
import { ManualDraft } from './manual-draft';

describe('manual sales drafts', () => {
  it('retains edits and the original revision when a route reloads newer server data', () => {
    const editor = new ManualDraft<{ description: string }>();
    editor.initialize({ description: 'saved' }, 'first');
    editor.update({ description: 'unsaved' });
    editor.initialize({ description: 'another tab' }, 'second');
    expect(editor.getSnapshot()).toEqual({
      draft: { description: 'unsaved' },
      saved: { description: 'saved' },
      revision: 'first',
    });
    expect(editor.isDirty()).toBe(true);
  });
  it('does not erase edits made during a save, and explicit reload discards them', () => {
    const editor = new ManualDraft<string[]>();
    editor.initialize(['one'], 'first');
    editor.update(['one', 'two']);
    const saving = editor.getSnapshot()!.draft;
    editor.update(['one', 'two', 'three']);
    editor.saved(saving, 'second');
    expect(editor.getSnapshot()!.draft).toEqual(['one', 'two', 'three']);
    expect(editor.isDirty()).toBe(true);
    editor.reset(['one', 'two'], 'second');
    expect(editor.isDirty()).toBe(false);
  });
});
