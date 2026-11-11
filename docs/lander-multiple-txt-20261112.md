# Multiple certificate TXT values

The scoped 015.io qualification stopped before web routing changed when
Cloudflare requested two distinct certificate TXT values at the same owner.
The first value was appended and verified. Reconciliation then treated the
second value as an outside edit because both native records omitted comments.

Only a nonempty matching connection comment establishes tagged-record
ownership. Untagged TXT values may coexist. Exact duplicate matches remain
ambiguous, CNAME/ANAME creation remains exclusive, prior verified changes
remain fenced, and reverse operations still target their exact submitted
records. No DNS retry, authentication or provider-qualification guard changes.

The regression fails on the previous implementation and passes with this
correction. Focused tests also cover native preservation and recovery. Engine
2.2.1-hosted.10 carries the fix; source/CI and a live deployment remain separate
from complete DNS, root/www TLS, public HTTPS and restoration qualification.
