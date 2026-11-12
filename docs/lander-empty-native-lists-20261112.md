# Empty native DNS lists during cutover

The live qualification stopped after removing the original root ANAME, while
both certificates were ready and the eight validation records remained. The
reader required both native record arrays. The upstream Dynadot client models
those arrays as optional and reads omitted arrays as empty. A replay with an
omitted empty root list reproduces the stop at the same removal/readback step.

Accept omitted record lists while retaining their original absence in the
provider settings snapshot. Present malformed lists, DNS mode, nameservers,
credential identity, provider-wide TTL, complete record preservation and
uncertain-write protections keep their existing checks. No DNS write operation,
authentication or qualification rule changes.

The regression follows the full twelve-change plan with two ACME values per
host, checks the empty-root intermediate state, then reverses all twelve
changes and verifies the original native objects. Separate cases cover either
omitted empty list and reject present null, object or string lists.

Raw internal inspection was unavailable. The live provider outcome and recovery
remain separate release checks; fixture success does not establish them.
