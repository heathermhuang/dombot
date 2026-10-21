export type ComposeMode = 'reply' | 'private-note';
interface MessageDraft {
  body: string;
  key: string;
}
interface InquiryDraftState {
  mode: ComposeMode;
  reply: MessageDraft;
  'private-note': MessageDraft;
}
/** Document-memory only: buyer text must not persist on a shared device. */
export class InquiryDraft {
  private state: InquiryDraftState = {
    mode: 'reply',
    reply: { body: '', key: crypto.randomUUID() },
    'private-note': { body: '', key: crypto.randomUUID() },
  };
  private listeners = new Set<() => void>();
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(state: InquiryDraftState) {
    this.state = state;
    this.listeners.forEach((listener) => listener());
  }
  setMode(mode: ComposeMode) {
    this.update({ ...this.state, mode });
  }
  setBody(mode: ComposeMode, body: string) {
    this.update({ ...this.state, [mode]: { body, key: crypto.randomUUID() } });
  }
  sent(mode: ComposeMode, key: string) {
    // A response from a different route must not clear text typed meanwhile.
    if (this.state[mode].key === key) this.setBody(mode, '');
  }
  clear() {
    this.setBody('reply', '');
    this.setBody('private-note', '');
  }
  isDirty = () => !!(this.state.reply.body || this.state['private-note'].body);
}
export function localDateTime(timestamp: number | null): string {
  if (timestamp === null) return '';
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
