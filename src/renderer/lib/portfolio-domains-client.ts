import { hostPath } from './platform';
import type { PortfolioDomainsState } from '../../shared/portfolio-domains';
export class PortfolioDomainRequestError extends Error {
  constructor(
    message: string,
    readonly reauth = false,
  ) {
    super(message);
  }
}
export async function portfolioDomainsRequest(
  path = '',
  body?: unknown,
): Promise<PortfolioDomainsState> {
  let response: Response;
  try {
    response = await fetch(hostPath('/site-domains' + path), {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(45000),
    });
  } catch {
    throw new PortfolioDomainRequestError(
      'The connection check did not finish. Reload domain information before trying again.',
    );
  }
  const value = await response.json().catch(() => {
    throw new PortfolioDomainRequestError(
      'Domain information could not be loaded. Please try again.',
    );
  });
  if (!response.ok)
    throw new PortfolioDomainRequestError(
      value.error || 'The domain request could not be completed.',
      response.status === 428 && value.reauth === '/account/reauth',
    );
  return value as PortfolioDomainsState;
}
