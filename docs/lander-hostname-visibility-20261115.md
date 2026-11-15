# Retained hostname visibility during preparation

A provider can acknowledge a custom hostname before a following read returns the resource. Preparation previously parsed that missing read as a hostname object, so a connection could become held before its DNS review was ready.

Preparation now retains the accepted provider ID and treats a missing read as pending only for an unfinished, recent hostname creation with no recorded route. The visibility allowance is bounded to ten minutes from the claim. Reads do not replay creation or adopt a different resource. When a direct lookup is missing, preparation also reads the filtered hostname listing and accepts only the exact retained ID and hostname, with the existing generation and metadata checks. Older or already prepared resources missing from both reads remain explicit reconciliation holds. Normal hostname/generation/metadata validation is unchanged when the resource appears.

The Worker regressions reproduce both HTTP 404 and a successful envelope with a null result after a valid creation response, including a partially prepared root/www pair and a missing direct lookup after route preparation. Recovery uses the original IDs and creates no additional hostname. Separate tests keep old and already prepared missing resources held. The previous implementation failed the reproduction with the same null-object validation error.

This is a gateway-only preparation correction. It changes no DNS writes, publication, auth freshness, provider entitlement or tenant-engine/UI artifact. Run required CI before activation and verify the normal owner flow against the controlled fixture.

A service-binding-only inspection reports read status and exact-match counts for the finite approved root/www fixture. It accepts no caller-selected paths and exposes no credentials, provider IDs or proof values. It performs no mutations and is disabled outside the qualified fixture window. The configured gateway Worker wrapper retains the operator entrypoint export.
