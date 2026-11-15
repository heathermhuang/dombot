# Retained hostname visibility during preparation

A provider can acknowledge a custom hostname before a following read returns the resource. Preparation previously parsed that missing read as a hostname object, so a connection could become held before its DNS review was ready.

Preparation now retains the accepted provider ID and treats a missing read as pending only for an unfinished, recent hostname creation with no recorded route. The visibility allowance is bounded to ten minutes from the claim. Reads do not replay creation or adopt a different resource. Older missing resources and already prepared resources remain explicit reconciliation holds. Normal hostname/generation/metadata validation is unchanged when the resource appears.

The Worker regressions reproduce both HTTP 404 and a successful envelope with a null result after a valid creation response, including a partially prepared root/www pair. Recovery uses the original IDs and creates no additional hostname. Separate tests keep old and already prepared missing resources held. The previous implementation failed the reproduction with the same null-object validation error.

This is a gateway-only preparation correction. It changes no DNS writes, publication, auth freshness, provider entitlement or tenant-engine/UI artifact. Run required CI before activation and verify the normal owner flow against the controlled fixture.
