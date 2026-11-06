# Namefi source qualification — 6 November 2026

The pinned candidate is engine `2.1.0-hosted.2` with registrar client
`1.1.0-hosted.2`. The provider contract comes from Namefi's official public
OpenAPI specification. Credentials and raw live account responses are excluded.

- The built SDK passed live read-only connection, personal inventory, detail,
  nameserver, DNS and annual renewal-price checks. Seven domains were returned;
  no provider setting, DNS, purchase or payment mutation was used for acceptance.
- 168 focused tests pass, including 26 Namefi adapter contract tests. They cover
  malformed/duplicate inventory, missing ownership, annual vs multi-year prices,
  secret-safe errors, redirect refusal, DNS preservation and unknown writes.
- The full local run passed 2,850 tests; its pre-existing 500-workspace platform
  fixture hit the setup deadline during parallel load. Both platform tests passed
  when run alone without code or timeout changes. One unrelated test remains
  intentionally skipped. Exact-head CI remains the required clean full-run gate.
- Root, Worker and hosted typechecks, lint, engine integrity, security regressions,
  relay checks and web/demo/site builds were exercised. Six deployment bundles
  were checked without uploading. Final CI repeats checks against the committed
  package and lockfiles.
- The disposable local Worker fixture showed Namefi in first-registrar onboarding
  and the packaged Settings account selector, with the real help links, key field,
  disabled empty submission and official logo. The fixture serves SVG assets with
  their proper media type. The screenshot contains only synthetic data.

These observations qualify source and a local build. Managed runtime rollout,
production import/cleanup, preservation and owner connection are separate steps.
