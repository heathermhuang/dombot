import { describe, expect, it } from 'vitest';
import { importPublication } from './publication-import';
import { privateListing } from './publication';

describe('private import preview', () => {
  it('recognizes CSV fields and previews duplicates without changing existing edits', () => {
    const existing = [
      {
        ...privateListing('studio.example'),
        description: 'Keep my edit',
        visibility: 'inquiry' as const,
      },
    ];
    const before = structuredClone(existing);
    const preview = importPublication(
      'Domain Name,Collection,Description,Asking Price,Currency,Unsupported\nstudio.example,New,Overwrite,500,USD,ignored\ngarden.example,Spring,Garden,100,USD,ignored\nGARDEN.EXAMPLE,Other,Duplicate,200,USD,ignored',
      existing,
    );
    expect(preview.fields).toEqual([
      'domain',
      'collection',
      'description',
      'askingprice',
      'currency',
    ]);
    expect(preview.added).toBe(1);
    expect(preview.duplicates).toBe(2);
    expect(existing).toEqual(before);
    expect(preview.listings[0]).toEqual(before[0]);
    expect(preview.listings[1]).toMatchObject({
      domain: 'garden.example',
      collection: 'Spring',
      visibility: 'private',
      askingPrice: 100,
    });
  });
  it('previews all 50 plain names and keeps them private without registrar evidence', () => {
    const result = importPublication(
      Array.from({ length: 50 }, (_, i) => `sample-${i}.example`).join('\n'),
      [],
    );
    expect(result.added).toBe(50);
    expect(result.fields).toEqual(['domain']);
    expect(result.listings.every((item) => item.visibility === 'private')).toBe(
      true,
    );
  });
  it('rejects a later invalid row atomically and preserves existing edits', () => {
    const existing = [privateListing('saved.example')];
    expect(() =>
      importPublication(
        'domain,currency\nvalid.example,USD\nbad.example,INVALID',
        existing,
      ),
    ).toThrow('Import row 2 is invalid');
    expect(existing).toEqual([privateListing('saved.example')]);
  });
  it('reports recognized JSON fields without trusting publication or ownership fields', () => {
    const result = importPublication(
      JSON.stringify([
        {
          domain: 'sample.example',
          visibility: 'inquiry',
          ownership: 'owned',
          description: 'Sample',
        },
      ]),
      [],
    );
    expect(result.fields).toEqual(['domain', 'description']);
    expect(result.listings[0].visibility).toBe('private');
  });
});
