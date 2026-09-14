// Runs only in an opaque-origin sandbox. Navigation is rendered by the owner app;
// it cannot submit inquiries, read parent state or navigate the top-level page.
if (window.parent !== window) {
  const send = (query) =>
    parent.postMessage({ type: 'portfolio-preview', query }, '*');
  document.addEventListener('submit', (event) => {
    event.preventDefault();
    send('?' + new URLSearchParams(new FormData(event.target)).toString());
  });
  const search = (form) =>
    send('?' + new URLSearchParams(new FormData(form)).toString());
  document.addEventListener('keydown', (event) => {
    if (
      event.key === 'Enter' &&
      event.target.matches('input') &&
      event.target.form
    ) {
      event.preventDefault();
      search(event.target.form);
    }
  });
  document.addEventListener('click', (event) => {
    const button = event.target.closest('button[type="button"]');
    if (button?.form) {
      event.preventDefault();
      search(button.form);
      return;
    }
    const link = event.target.closest('a');
    if (!link) return;
    const href = link.getAttribute('href');
    if (href.startsWith('#')) return;
    event.preventDefault();
    if (href.startsWith('?')) send(href);
  });
}
