/** The frame runs no scripts. Its owner handles browsing through this narrow DOM bridge. */
export function bindPortfolioPreview(
  document: Document,
  navigate: (query: string) => void,
) {
  const search = (form: HTMLFormElement) => {
    const params = new URLSearchParams();
    new FormData(form).forEach((value, key) => {
      if (typeof value === 'string') params.set(key, value);
    });
    navigate('?' + params.toString());
  };
  document.addEventListener('submit', (event) => {
    event.preventDefault();
  });
  document.addEventListener('keydown', (event) => {
    const target = event.target as HTMLInputElement;
    if (event.key === 'Enter' && target.tagName === 'INPUT' && target.form) {
      event.preventDefault();
      search(target.form);
    }
  });
  document.addEventListener('click', (event) => {
    const target = event.target as Element;
    const button = target.closest<HTMLButtonElement>('button[type="button"]');
    if (button?.form) {
      event.preventDefault();
      search(button.form);
      return;
    }
    const link = target.closest<HTMLAnchorElement>('a');
    if (!link) return;
    const href = link.getAttribute('href') ?? '';
    event.preventDefault();
    if (href.startsWith('#')) {
      document.getElementById(href.slice(1))?.scrollIntoView();
      return;
    }
    if (href.startsWith('?')) navigate(href.slice(0, 2000));
  });
}
