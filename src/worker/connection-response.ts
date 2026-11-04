import type { ConnectRegistrarResult } from '../shared/ipc';
import { CONNECTION_RESULT_CONTRACT } from '../shared/connection-contract';

export function connectionResponse(
  result: ConnectRegistrarResult,
  contract?: string,
): Response {
  const headers = { 'Cache-Control': 'no-store' };
  if (contract === CONNECTION_RESULT_CONTRACT)
    return Response.json({ result }, { headers });
  if (result.success)
    return Response.json({ result: result.account }, { headers });
  // Existing Dynadot clients classify the former thrown 401 Unauthorized text.
  // The HTTP response remains a connection failure, not a session-expiry 401.
  const prefix =
    result.status === 401
      ? '401 Unauthorized: '
      : result.status
        ? `${result.status}: `
        : '';
  return Response.json(
    { error: prefix + result.message },
    { status: 500, headers },
  );
}
