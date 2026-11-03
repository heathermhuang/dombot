import { registrars } from '@aoxborrow/registrar-client';
import { escapeHtml as e, page } from './views';

export const importStartScriptPath = '/auth/import-start.js';
/** The entire editor/review runs before a tenant exists. */
export function importStart(id: string) {
  const base = '/w/' + id;
  return page(
    'Import your domains',
    `<style>
  .import-start{max-width:960px;margin:36px auto;padding:0 20px;min-width:0}.import-start form{max-width:none}.import-start textarea{width:100%;min-height:180px;max-height:360px;resize:vertical;box-sizing:border-box}.import-start select{font:inherit;max-width:100%;padding:10px}.import-start .options{display:flex;gap:20px;flex-wrap:wrap}.import-start .options label{flex:1;min-width:180px}.import-start .scroll{overflow:auto;max-height:400px;max-width:100%}.import-start table{border-collapse:collapse;width:100%}.import-start th,.import-start td{padding:12px;text-align:left;border-bottom:1px solid var(--line);overflow-wrap:anywhere}.import-start button{min-height:44px}.import-start [hidden]{display:none}.import-start input[type=file]{max-width:100%}.import-start [data-import-mapping]{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));gap:12px 20px}.import-start [data-import-mapping] label{display:flex;flex-direction:column;gap:6px;margin:0}
  </style><section class="import-start"><span class="eyebrow">Your private portfolio</span><h1>Import your domains.</h1><p>Choose a CSV or paste your list, check the columns, then review what you will save. Imported domains stay private.</p>
  <form data-first-import data-registrars="${e(JSON.stringify(Object.entries(registrars).map(([id, provider]) => ({ id, displayName: provider.displayName }))))}" data-base="${base}" action="${base}/api/importDomains">
  <label>Choose a CSV or text file<input type="file" accept=".csv,.txt,text/csv,text/plain" data-import-file></label>
  <label>Or paste your CSV or domain list<textarea data-import-text spellcheck="false" placeholder="Domain&#10;your-domain.com"></textarea></label>
  <div class="options"><label>Default currency<select data-import-currency></select></label><label>Dates such as 03/04/2026<select data-import-date><option value="mdy">Month / day / year</option><option value="dmy">Day / month / year</option></select></label></div>
  <section data-import-columns hidden><h2>Match your columns</h2><p>Choose what each column contains. Columns set to “Don’t import” are excluded.</p><div data-import-mapping></div></section>
  <button type="button" data-import-review>Review import</button>
  <p role="status" aria-live="polite"></p><ul data-import-issues></ul>
  <section data-import-preview hidden><h2>Review your import</h2><p data-import-summary></p><div class="scroll"><table><thead><tr><th>Domain</th><th>Details to import</th></tr></thead><tbody data-import-rows></tbody></table></div></section>
  <button type="submit" data-import-submit disabled>Save domains</button>
  <noscript><p>Enable JavaScript to preview and submit your import.</p></noscript>
  </form><p><a href="${base}/">Back to your portfolio</a></p></section>`,
  ).replace(
    '</head>',
    `<script type="module" src="${importStartScriptPath}"></script></head>`,
  );
}
