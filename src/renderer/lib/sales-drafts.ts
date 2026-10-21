import { useSyncExternalStore } from 'react';
import { ManualDraft } from './manual-draft';
import { InquiryDraft } from './inquiry-draft';
import { hostPath } from './platform';
import type { SaleDraft, SaleShop } from '../../shared/sales';

const listings = new Map<string, ManualDraft<SaleDraft>>();
const shops = new Map<string, ManualDraft<SaleShop>>();
const inquiries = new Map<string, InquiryDraft>();
let listening = false;
function guardDocumentExit() {
  if (listening) return;
  listening = true;
  window.addEventListener('beforeunload', (event) => {
    if (
      ![...listings.values(), ...shops.values(), ...inquiries.values()].some(
        (draft) => draft.isDirty(),
      )
    )
      return;
    event.preventDefault();
    event.returnValue = '';
  });
}
export function useListingDraft(id: string) {
  const key = hostPath(`/sales/listings/${id}`);
  if (!listings.has(key)) listings.set(key, new ManualDraft<SaleDraft>());
  guardDocumentExit();
  const editor = listings.get(key)!;
  return {
    editor,
    state: useSyncExternalStore(editor.subscribe, editor.getSnapshot),
  };
}
export function useShopDraft() {
  const key = hostPath('/sales/shop');
  if (!shops.has(key)) shops.set(key, new ManualDraft<SaleShop>());
  guardDocumentExit();
  const editor = shops.get(key)!;
  return {
    editor,
    state: useSyncExternalStore(editor.subscribe, editor.getSnapshot),
  };
}

export function useInquiryDraft(id: string) {
  const key = hostPath(`/sales/inbox/${id}`);
  if (!inquiries.has(key)) inquiries.set(key, new InquiryDraft());
  guardDocumentExit();
  const editor = inquiries.get(key)!;
  return {
    editor,
    state: useSyncExternalStore(editor.subscribe, editor.getSnapshot),
  };
}
