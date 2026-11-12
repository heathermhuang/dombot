# Certificate validation recheck

The 015.io qualification exposed a delay after the reviewed TXT records had been written: the app polled certificate status but never requested a validation recheck after the records became public. Authoritative Dynadot DNS and both Cloudflare and Google recursive DNS returned every reviewed value while certificate validation was still pending. This establishes record visibility, not a guarantee of certificate issuance.

Cloudflare documents a configuration-neutral custom-hostname PATCH using the current SSL method, type and settings to request immediate validation after TXT placement: https://developers.cloudflare.com/ssl/edge-certificates/changing-dcv-method/validation-backoff-schedule/

The normal hostname controller now makes at most one such request per claim epoch. It requires an active provider hostname, pending TXT/DV validation, current provider validation records belonging to that exact hostname, and public readback of every value. It preserves SSL settings and never changes DNS. An atomic marker is stored before the request; concurrent callers, restarts and ambiguous responses cannot replay it. Later status polling still requires active TLS and exact public revision verification before marking the hostname active.

Regression fixtures first failed for the missing PATCH. They now cover partial visibility, all-value visibility, concurrent calls and a response lost after provider acceptance. Existing activation, redirect and detach regressions remain unchanged. No credentials are exported, no application approval rules change, and a refresh request is never treated as proof of readiness.

## Pre-cutover integration correction

The first release applied the recheck to hostname activation, which the automatic lander reaches only after certificate and routing checks. The automatic lander's pre-cutover verification now calls the same guarded recheck directly, with the existing generation fence before both the atomic claim and provider request. It retains current SSL metadata when parsing provider responses.

A regression exercises the real `LanderHosting.verify` path while the DNS still points to a parking destination. It proves partial/new validation requirements produce counts without a PATCH, cancellation prevents the request, all values permit one recheck, and concurrent or later verifications do not replay it. The test fails against the earlier verification path. The normal connection receipt exposes only required/visible counts and an attempted-recheck label; it never exposes validation values or treats an attempted request as provider acceptance.
