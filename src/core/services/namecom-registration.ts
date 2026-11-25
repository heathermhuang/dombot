import {
  createRegistrar,
  NamecomRegistrar,
  type Registrar,
  type RegistrarCredentials,
  type RegistrarName,
  type RegistrarOptions,
} from '@aoxborrow/registrar-client';
import { assertDomainName, toAscii } from '../../shared/domain-name';

/** Name.com's inventory can retain a transferred name. This read confirms
 * whether Name.com still sponsors the exact registration. */
export class NamecomRegistrationCheck extends NamecomRegistrar {
  async isRegisteredAtName(domain: string): Promise<boolean | null> {
    const name = assertDomainName(domain);
    const response = await this.http.request<{
      domainName?: unknown;
      atName?: unknown;
    }>({
      path: '/transfers/eligibility/' + encodeURIComponent(name),
      retries: 0,
      timeout: 5000,
    });
    if (
      typeof response?.domainName !== 'string' ||
      toAscii(response.domainName) !== name ||
      typeof response.atName !== 'boolean'
    )
      return null;
    return response.atName;
  }
}

export function createRegistrationAwareRegistrar(
  name: RegistrarName,
  credentials: RegistrarCredentials,
  options: RegistrarOptions,
): Registrar {
  return name === 'namecom'
    ? new NamecomRegistrationCheck(credentials, options)
    : createRegistrar(name, credentials, options);
}
