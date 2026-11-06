export interface ParkioMobileConnection {
  viewerUrl: string;
  socketUrl: string;
}

/** These are short-lived owner capabilities, never general URLs or API tokens. */
export function parkioMobileConnection(view: {
  devtoolsFrontendUrl: string;
  webSocketDebuggerUrl: string;
}): ParkioMobileConnection {
  const viewer = new URL(view.devtoolsFrontendUrl);
  const socket = new URL(view.webSocketDebuggerUrl);
  if (
    viewer.origin !== 'https://live.browser.run' ||
    !/^\/ui\/(?:view|inspector)$/.test(viewer.pathname) ||
    socket.protocol !== 'wss:' ||
    socket.hostname !== 'live.browser.run' ||
    socket.port ||
    !socket.pathname.startsWith('/api/devtools/browser/') ||
    viewer.username ||
    viewer.password ||
    viewer.hash ||
    socket.username ||
    socket.password ||
    socket.hash
  )
    throw new Error('Invalid browser connection');
  return { viewerUrl: viewer.href, socketUrl: socket.href };
}

export const parkioFocusExpression = `(() => {const e=document.activeElement;return {origin:location.origin,editable:!!e&&(e.tagName==='INPUT'||e.tagName==='TEXTAREA'||e.isContentEditable)}})()`;

export function mayTypeIntoParkio(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const field = value as { origin?: unknown; editable?: unknown };
  return (
    (field.origin === 'https://park.io' ||
      field.origin === 'https://www.park.io') &&
    field.editable === true
  );
}
