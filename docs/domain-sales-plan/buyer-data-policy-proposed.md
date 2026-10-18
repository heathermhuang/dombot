# Buyer data copy for operator review

Proposed; not published. The delivery plan requires operator review before external buyer collection. Keep `SALES_PRIVACY_REVIEWED` off until the final wording is approved and the linked policy is published. Local synthetic qualification is separate.

## Proposed Privacy Policy addition

When you contact a domain seller, we process the name, email address, offer and message you provide to deliver and maintain that conversation. The seller receives your confirmed inquiry and can reply through the service. The seller can also maintain private notes, follow-up dates and seller-entered transaction observations. Email confirmation establishes access to that inquiry; it does not verify identity, funds or a purchase contract.

Inquiry confirmation links expire after 24 hours. Conversation links expire after seven days and are revoked when a fresh link is issued. Anyone with an active conversation link can read that conversation; avoid forwarding it. These links never grant access to the seller's account. Account sign-in and inquiry verification use separate records and purposes.

Pending unverified inquiries are removed by scheduled cleanup after seven days from submission. Verified conversations are removed after 12 months without activity, or when the seller requests deletion. Short-lived keyed abuse fingerprints expire within 24 hours. To enforce a seller's block across retries and support encryption-key rotation, a blocked address is retained as a keyed lookup hash and an encrypted address for up to 90 days; the name and conversation text are not part of that suppression record. Restricted backups may outlive removal from active storage under the existing backup policy. Account closure disables ingress, replies and domain routing immediately; account erasure follows the existing 30-day recovery and manual purge process.

Cloudflare hosts the service, database and transactional email channel. We send minimal reference information and secure links in email, rather than full conversation bodies. Transaction providers receive information you choose to submit on their services and apply their own terms and policies. We do not collect payment-card details or take custody of transaction funds through these sales pages. Use the existing privacy contact to request access, correction or erasure, including inquiry references where available. Do not email passwords, registrar keys or unencrypted backups.

## Proposed concise form notice

We'll email a confirmation link. Confirming lets the seller reply; it does not accept an offer or create a purchase contract. Pending inquiries expire after seven days; inactive verified conversations after 12 months. Read the Privacy Policy before submitting.

## Implementation discovery

The plan proposed a minimal suppression hash. A keyed hash cannot be rebuilt after root-key rotation without the underlying address. The implementation therefore keeps only the normalized address encrypted alongside the hash for the same bounded 90-day suppression period, includes it in the explicitly private backup, and rebuilds the lookup hash under the new root on restore. No buyer name, message or raw address is placed in indexed metadata. This change must be included in the operator's review; it is not a claim of legal clearance.
