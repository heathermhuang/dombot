/** Route a schema error to the control that edits it, including array editors. */
export function issueFocusTarget(path: readonly PropertyKey[]) {
  const [group, index, property] = path;
  if (group === 'profile') {
    const field =
      property === undefined
        ? path.slice(0, 2).join('.')
        : index === 'links'
          ? path.slice(0, 4).join('.')
          : path.slice(0, 2).join('.');
    return { section: 'profile', field };
  }
  if (group === 'collections' || group === 'projects') {
    const editable =
      group === 'collections'
        ? ['title', 'slug', 'intro', 'domainIds']
        : ['title', 'url', 'description', 'domainIds'];
    const length = editable.includes(String(property))
      ? 3
      : typeof index === 'number'
        ? 2
        : 1;
    return { section: 'collections', field: path.slice(0, length).join('.') };
  }
  if (group === 'domainPresentations') {
    const editable = [
      'ownership',
      'availability',
      'description',
      'askingPrice',
      'currency',
    ];
    const length = editable.includes(String(property))
      ? 3
      : typeof index === 'number'
        ? 2
        : 1;
    return { section: 'domains', field: path.slice(0, length).join('.') };
  }
  if (group === 'salesLinks')
    return { section: 'domains', field: 'domainPresentations' };
  if (group === 'homepage')
    return {
      section: 'collections',
      field:
        typeof property === 'number'
          ? path.slice(0, 3).join('.')
          : index === 'projectIds'
            ? 'projects'
            : 'collections',
    };
  if (group === 'catalogue')
    return {
      section: 'collections',
      field: index === 'enabled' ? 'catalogue.enabled' : 'catalogue',
    };
  return { section: 'settings', field: 'settings' };
}

/** Called after React commits the requested section and any domain pagination. */
export function focusIssueField(root: HTMLElement, field: string): boolean {
  const target = [...root.querySelectorAll<HTMLElement>('[data-field]')].find(
    (element) => element.dataset.field === field,
  );
  if (!target) return false;
  let ancestor: HTMLElement | null = target;
  while (ancestor && ancestor !== root) {
    if (ancestor.tagName === 'DETAILS')
      (ancestor as HTMLDetailsElement).open = true;
    ancestor = ancestor.parentElement;
  }
  // Read-only linked terms still identify their containing domain details.
  const focusTarget = target.matches(':disabled')
    ? target.closest<HTMLElement>('details')
    : target;
  if (!focusTarget) return false;
  focusTarget.focus();
  return true;
}
