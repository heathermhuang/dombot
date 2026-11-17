import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { emptyOwnerSite } from '../../shared/owner-site';
import { ProfileEditor } from '../components/owner-site/ProfileEditor';
import { SectionsEditor } from '../components/owner-site/SectionsEditor';
import { describe, expect, it, vi } from 'vitest';
import {
  issueFocusTarget,
  focusIssueField,
} from './owner-site-validation-focus';

describe('owner-site validation recovery', () => {
  it('renders the exact targets used by collection, project and domain errors', () => {
    const draft = emptyOwnerSite();
    draft.profile.links = [{ label: 'Link', url: 'http://invalid.test' }];
    draft.collections = [
      {
        id: 'one',
        title: 'One',
        slug: 'Invalid slug',
        intro: '',
        domainIds: [],
      },
    ];
    draft.projects = [
      {
        id: 'project',
        title: 'Project',
        url: 'http://invalid.test',
        description: '',
        domainIds: [],
      },
    ];
    draft.domainPresentations = [
      {
        id: 'domain',
        domain: 'example.com',
        ownership: 'current',
        availability: 'inquiries',
        description: '',
        askingPrice: null,
        currency: 'BAD!',
      },
    ];
    const html = renderToStaticMarkup(
      createElement(
        'div',
        null,
        createElement(ProfileEditor, {
          draft,
          lockedHandle: false,
          onChange: () => {},
        }),
        createElement(SectionsEditor, {
          draft,
          review: [],
          onChange: () => {},
        }),
      ),
    );
    for (const path of [
      ['profile', 'links', 0, 'url'],
      ['collections', 0, 'slug'],
      ['projects', 0, 'url'],
      ['domainPresentations', 0, 'currency'],
    ])
      expect(html).toContain(`data-field="${issueFocusTarget(path).field}"`);
  });

  it('routes indexed collection, project, domain, and multiline errors to their editors', () => {
    expect(issueFocusTarget(['collections', 2, 'slug'])).toEqual({
      section: 'collections',
      field: 'collections.2.slug',
    });
    expect(issueFocusTarget(['projects', 1, 'url'])).toEqual({
      section: 'collections',
      field: 'projects.1.url',
    });
    expect(
      issueFocusTarget(['domainPresentations', 34, 'askingPrice']),
    ).toEqual({
      section: 'domains',
      field: 'domainPresentations.34.askingPrice',
    });
    expect(issueFocusTarget(['profile', 'interests', 3])).toEqual({
      section: 'profile',
      field: 'profile.interests',
    });
    expect(issueFocusTarget(['profile', 'links', 2, 'url'])).toEqual({
      section: 'profile',
      field: 'profile.links.2.url',
    });
    expect(issueFocusTarget(['collections', 2, 'domainIds', 4])).toEqual({
      section: 'collections',
      field: 'collections.2.domainIds',
    });
    expect(issueFocusTarget(['homepage', 'projectIds', 0])).toEqual({
      section: 'collections',
      field: 'homepage.projectIds.0',
    });
  });

  it('waits for the exact paginated field, then opens every containing disclosure before focus', () => {
    const root = { querySelectorAll: () => [] } as unknown as HTMLElement;
    expect(focusIssueField(root, 'domainPresentations.34.currency')).toBe(
      false,
    );
    const outer = { tagName: 'DETAILS', open: false, parentElement: root };
    const inner = { tagName: 'DETAILS', open: false, parentElement: outer };
    const focus = vi.fn(() => {
      expect(outer.open).toBe(true);
      expect(inner.open).toBe(true);
    });
    const target = {
      dataset: { field: 'domainPresentations.34.currency' },
      tagName: 'INPUT',
      parentElement: inner,
      matches: () => false,
      focus,
    };
    root.querySelectorAll = (() => [
      target,
    ]) as unknown as typeof root.querySelectorAll;
    expect(focusIssueField(root, 'domainPresentations.34.currency')).toBe(true);
    expect(focus).toHaveBeenCalledOnce();
  });
});
