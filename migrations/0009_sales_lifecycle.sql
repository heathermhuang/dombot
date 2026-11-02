-- Private approved source bindings travel neither through public projections nor restores.
CREATE TABLE sale_public_sources (
 listing_id TEXT PRIMARY KEY REFERENCES sale_drafts(id) ON DELETE CASCADE,
 revision TEXT NOT NULL,
 sealed TEXT NOT NULL
);
-- Request/event counts, not unique people or attributed completed sales.
CREATE TABLE sales_journey_daily (
 day TEXT NOT NULL,
 listing_id TEXT NOT NULL,
 event TEXT NOT NULL CHECK(event IN ('page-rendered','provider-opened','inquiry-verified','sale-evidence-linked')),
 count INTEGER NOT NULL CHECK(count>=0),
 PRIMARY KEY(day,listing_id,event)
);
CREATE TABLE sales_journey_receipts (
 event TEXT NOT NULL,
 receipt TEXT NOT NULL,
 PRIMARY KEY(event,receipt)
);
