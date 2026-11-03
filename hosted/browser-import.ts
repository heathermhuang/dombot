import {
  readTable,
  guessSetup,
  buildRows,
  MAX_IMPORT_ROWS,
  type ImportTable,
  type ImportSetup,
} from '../src/shared/domain-import';
import { FIELD_INFO, type ImportField } from '../src/shared/import-columns';
import { RATE_CURRENCIES } from '../src/shared/currencies';
import type { ImportRow } from '../src/shared/ipc';

const form = document.querySelector<HTMLFormElement>('[data-first-import]');
if (form) start(form);
function start(form: HTMLFormElement) {
  const find = <T extends Element>(selector: string) =>
    form.querySelector<T>(selector)!;
  const text = find<HTMLTextAreaElement>('[data-import-text]');
  const file = find<HTMLInputElement>('[data-import-file]');
  const currency = find<HTMLSelectElement>('[data-import-currency]');
  const dateOrder = find<HTMLSelectElement>('[data-import-date]');
  const mapping = find<HTMLDivElement>('[data-import-mapping]');
  const preview = find<HTMLElement>('[data-import-preview]');
  const status = find<HTMLElement>('[role=status]');
  const submit = find<HTMLButtonElement>('[data-import-submit]');
  const review = find<HTMLButtonElement>('[data-import-review]');
  const issues = find<HTMLUListElement>('[data-import-issues]');
  let table: ImportTable | null = null,
    setup: ImportSetup | null = null;
  let rows: ImportRow[] = [],
    importId = '',
    busy = false,
    revision = 0;
  for (const code of RATE_CURRENCIES) currency.add(new Option(code, code));
  currency.value = 'USD';
  const context = () => ({
    preferredCurrency: currency.value,
    numberFormat: 'us' as const,
    registrars: JSON.parse(form.dataset.registrars ?? '[]'),
    today: new Date().toISOString().slice(0, 10),
  });
  const invalidate = () => {
    revision++;
    rows = [];
    importId = '';
    submit.disabled = true;
    preview.hidden = true;
    issues.replaceChildren();
    status.textContent = '';
  };
  function load() {
    invalidate();
    table = readTable(text.value);
    setup = guessSetup(table, context());
    dateOrder.value = setup.dateOrder;
    mapping.replaceChildren();
    find<HTMLElement>('[data-import-columns]').hidden = !table.rows.length;
    table.headers.forEach((header, index) => {
      const label = document.createElement('label');
      label.textContent = header || `Column ${index + 1}`;
      const select = document.createElement('select');
      select.setAttribute('aria-label', `Import column ${header || index + 1}`);
      select.add(new Option('Don’t import', ''));
      for (const [key, field] of Object.entries(FIELD_INFO))
        select.add(new Option(field.label, key));
      select.value = setup!.columns[index] ?? '';
      select.addEventListener('change', () => {
        invalidate();
        const field = (select.value || null) as ImportField | null;
        setup!.columns = setup!.columns.map((old, i) =>
          i === index ? field : field && old === field ? null : old,
        );
        mapping
          .querySelectorAll('select')
          .forEach((item, i) => (item.value = setup!.columns[i] ?? ''));
      });
      label.append(select);
      mapping.append(label);
    });
  }
  text.addEventListener('input', load);
  file.addEventListener('change', async () => {
    const selected = file.files?.[0];
    invalidate();
    const current = revision;
    if (!selected) return;
    if (selected.size > 8 * 1024 * 1024) {
      status.textContent = 'Choose a file smaller than 8 MB.';
      return;
    }
    try {
      const value = await selected.text();
      if (current !== revision) return;
      text.value = value;
      load();
    } catch {
      status.textContent =
        'The file could not be read. Try again or paste its contents.';
    }
  });
  currency.addEventListener('change', invalidate);
  dateOrder.addEventListener('change', invalidate);
  review.addEventListener('click', () => {
    invalidate();
    if (!table || !setup || !table.rows.length) {
      status.textContent = 'Choose a file or paste at least one domain.';
      return;
    }
    if (!setup.columns.includes('domain') && !setup.columns.includes('idn')) {
      status.textContent = 'Match a column to Domain before reviewing.';
      return;
    }
    if (table.rows.length > MAX_IMPORT_ROWS) {
      status.textContent = `Import up to ${MAX_IMPORT_ROWS.toLocaleString('en-US')} rows at a time.`;
      return;
    }
    setup.defaults.currency = currency.value;
    setup.dateOrder = dateOrder.value as 'mdy' | 'dmy';
    try {
      const built = buildRows(table, setup, context());
      for (const issue of built.issues.slice(0, 100)) {
        const li = document.createElement('li');
        li.textContent = `Line ${issue.line}: ${issue.message}`;
        issues.append(li);
      }
      if (built.issues.some((i) => i.level === 'error')) {
        status.textContent =
          'Correct the invalid rows before saving. Nothing has been submitted.';
        return;
      }
      if (!built.rows.length) {
        status.textContent =
          'No valid domains were found. Check your list and column matching.';
        return;
      }
      rows = built.rows;
      importId = crypto.randomUUID();
      const body = find<HTMLTableSectionElement>('[data-import-rows]');
      body.replaceChildren();
      for (const row of rows.slice(0, 100)) {
        const tr = document.createElement('tr'),
          domain = document.createElement('td'),
          details = document.createElement('td');
        domain.textContent = row.domain;
        const values = [
          row.registration?.registrar &&
            `Registrar: ${row.registration.registrar}`,
          row.registration?.registrarLabel &&
            `Registrar: ${row.registration.registrarLabel}`,
          row.registration?.createdDate &&
            `Registered: ${row.registration.createdDate}`,
          row.registration?.expirationDate &&
            `Expires: ${row.registration.expirationDate}`,
          row.registration?.autoRenew !== undefined &&
            `Auto-renew: ${row.registration.autoRenew ? 'Yes' : 'No'}`,
          row.renewal &&
            `Renewal: ${row.renewal.amount} ${row.renewal.currency}`,
          row.listPrice?.amount &&
            `BIN: ${row.listPrice.amount} ${row.listPrice.currency}`,
          row.listPrice?.minOffer &&
            `Minimum offer: ${row.listPrice.minOffer} ${row.listPrice.currency}`,
          row.listPrice?.floor &&
            `Floor: ${row.listPrice.floor} ${row.listPrice.currency}`,
          row.purchase &&
            `Purchase: ${[row.purchase.type, row.purchase.date, row.purchase.amount, row.purchase.currency, row.purchase.years && `${row.purchase.years} years`].filter(Boolean).join(' ')}`,
          row.sale &&
            `Sale: ${[row.sale.date, row.sale.amount, row.sale.currency].filter(Boolean).join(' ')}`,
          row.status && `Status: ${row.status}`,
          row.folder && `Folder: ${row.folder}`,
          row.notes && `Notes: ${row.notes}`,
        ].filter(Boolean);
        details.textContent = values.join(' · ') || 'Domain name only';
        tr.append(domain, details);
        body.append(tr);
      }
      find<HTMLElement>('[data-import-summary]').textContent =
        `${rows.length.toLocaleString('en-US')} domain${rows.length === 1 ? '' : 's'} ready to save. ${built.merged} duplicate rows merged; ${built.skipped} blank or non-domain rows skipped.${rows.length > 100 ? ' Showing the first 100 domains.' : ''}`;
      preview.hidden = false;
      submit.disabled = false;
      status.textContent =
        'Review complete. Save domains to finish your import.';
    } catch (error) {
      status.textContent =
        error instanceof Error
          ? error.message +
            ' Your list is still here; retrying keeps any saved rows.'
          : 'Check the import fields and try again.';
    }
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy || !rows.length || !importId || submit.disabled) return;
    busy = true;
    submit.disabled = true;
    review.disabled = true;
    const inputs = Array.from(
      form.querySelectorAll<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >('input,textarea,select'),
    );
    inputs.forEach((input) => (input.disabled = true));
    status.textContent = 'Saving your domains…';
    try {
      for (let offset = 0; offset < rows.length; offset += 2000) {
        status.textContent = `Saving domains ${offset + 1}–${Math.min(offset + 2000, rows.length)} of ${rows.length}…`;
        const response = await fetch(form.action, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            args: [rows.slice(offset, offset + 2000), { importId }],
          }),
        });
        const result = await response.json();
        if (!response.ok || result.error)
          throw Error(
            result.error || 'Import could not complete. Please retry.',
          );
      }
      location.assign(form.dataset.base + '/');
    } catch (error) {
      status.textContent =
        error instanceof Error
          ? error.message +
            ' Your list is still here; retrying keeps any saved rows.'
          : 'Import could not complete. Your list is still here; please retry.';
      busy = false;
      submit.disabled = false;
      review.disabled = false;
      inputs.forEach((input) => (input.disabled = false));
    }
  });
}
