import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// These surfaces name the original software or historical upstream releases.
// Keep these credits and technical identifiers instead of rewriting provenance.
const originalProjectFiles = new Set([
  'src/core/app-info.ts',
  'src/hosted/changelog-schema.ts',
  'src/hosted/changelog.ts',
  'src/hosted/legal.ts',
  'src/shared/releases.ts',
]);

function legacyCopy(file, source) {
  if (originalProjectFiles.has(file)) return [];
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const found = [];
  function visit(node) {
    if (
      ts.isStringLiteralLike(node) ||
      ts.isJsxText(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      const text = node.getText(ast);
      const technicalId =
        [
          'src/hosted/reserved-portfolio-handles.ts',
          'src/shared/import-columns.ts',
        ].includes(file) &&
        ts.isStringLiteralLike(node) &&
        node.text === 'dombot';
      const protocolHeader =
        ts.isStringLiteralLike(node) && /^x-dombot-/i.test(node.text);
      let copy = text;
      if (file === 'src/renderer/pages/settings/AboutSettings.tsx')
        copy = copy.replace(
          /Original DomBot|Sponsor DomBot|DomBot\.ai/g,
          'upstream credit',
        );
      if (
        file === 'src/renderer/components/DemoBanner.tsx' &&
        text.trim() === 'DomBot.ai'
      )
        copy = '';
      if (file === 'src/hosted/source.ts')
        copy = copy.replace(
          /original DomBot project|original DomBot copyright|Original DomBot by Aaron Oxborrow|maintained DomBot engine source/g,
          'upstream credit',
        );
      // Hyphenated storage/format ids, URLs and X-DomBot-* headers are stable
      // contracts. Download filenames and copied setup commands are copy.
      if (
        !technicalId &&
        !protocolHeader &&
        (/\bDomBot\b/.test(copy) ||
          /(?<![\w./-])dombot(?![\w./-])/i.test(copy) ||
          /dombot-(?:domains|sales|bulk|import-issues)-|dombot-import-issues\.csv|dombot-data-.*\.json/i.test(
            copy,
          ))
      )
        found.push(
          `${file}:${ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1}: ${text.trim().replace(/\s+/g, ' ').slice(0, 100)}`,
        );
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return found;
}

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(file);
    return /\.tsx?$/.test(file) &&
      !/\.(test|spec|live)\./.test(file) &&
      !file.startsWith('src/electron/') &&
      !file.includes('/test-fixtures/')
      ? [file]
      : [];
  });
}

describe('service branding across upstream merges', () => {
  it('flags old names in rendered copy, tool descriptions and downloads', () => {
    for (const source of [
      'const description = "Check your DomBot portfolio";',
      'const description = "DomBot-local edits need no registrar call";',
      'const view = <p>DomBot keeps your domains</p>;',
      'const name = `dombot-sales-${day}.csv`;',
      'const command = "claude mcp add dombot --transport http URL";',
    ])
      expect(legacyCopy('src/renderer/example.tsx', source)).toHaveLength(1);
  });

  it('does not let an upstream credit hide product copy on the source page', () => {
    expect(
      legacyCopy(
        'src/hosted/source.ts',
        'const html = `<h1>DomBot, hosted for you.</h1><p>The original DomBot project was created by Aaron Oxborrow.</p>`;',
      ),
    ).toHaveLength(1);
  });

  it('preserves protocol ids, old backup formats, URLs and code comments', () => {
    expect(
      legacyCopy(
        'src/shared/example.ts',
        '// DomBot upstream comment\nconst format = "dombot-data"; const header = "X-DomBot-Engine"; const url = "https://github.com/aoxborrow/dombot";',
      ),
    ).toEqual([]);
  });

  it('keeps service-facing source free of legacy product copy', () => {
    const found = sourceFiles('src').flatMap((file) =>
      legacyCopy(file, fs.readFileSync(file, 'utf8')),
    );
    expect(found).toEqual([]);
  });
});
