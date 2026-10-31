-- Operational state is tenant-local, encrypted and deliberately non-portable.
CREATE TABLE publication_change_sets (
  id TEXT PRIMARY KEY, request_key TEXT NOT NULL UNIQUE, sealed TEXT NOT NULL,
  expires_at INTEGER NOT NULL, consumed_at INTEGER, receipt TEXT
);
CREATE TABLE publication_dependencies (id TEXT PRIMARY KEY CHECK(id='main'), generation INTEGER NOT NULL);
INSERT INTO publication_dependencies VALUES('main',0);
CREATE TABLE publication_authority (id TEXT PRIMARY KEY CHECK(id='main'), fingerprint TEXT NOT NULL);
CREATE TRIGGER publication_fence_portfolio_drafts_insert AFTER INSERT ON portfolio_drafts BEGIN UPDATE publication_dependencies SET generation=generation+1 WHERE id='main'; END;
CREATE TRIGGER publication_fence_portfolio_drafts_update AFTER UPDATE ON portfolio_drafts BEGIN UPDATE publication_dependencies SET generation=generation+1 WHERE id='main'; END;
CREATE TRIGGER publication_fence_portfolio_drafts_delete AFTER DELETE ON portfolio_drafts BEGIN UPDATE publication_dependencies SET generation=generation+1 WHERE id='main'; END;
CREATE TRIGGER publication_fence_published_portfolios_insert AFTER INSERT ON published_portfolios BEGIN UPDATE publication_dependencies SET generation=generation+1 WHERE id='main'; END;
CREATE TRIGGER publication_fence_published_portfolios_update AFTER UPDATE ON published_portfolios BEGIN UPDATE publication_dependencies SET generation=generation+1 WHERE id='main'; END;
CREATE TRIGGER publication_fence_published_portfolios_delete AFTER DELETE ON published_portfolios BEGIN UPDATE publication_dependencies SET generation=generation+1 WHERE id='main'; END;
CREATE TRIGGER publication_fence_sale_drafts_insert AFTER INSERT ON sale_drafts BEGIN UPDATE publication_dependencies SET generation=generation+1 WHERE id='main'; END;
CREATE TRIGGER publication_fence_sale_drafts_update AFTER UPDATE ON sale_drafts BEGIN UPDATE publication_dependencies SET generation=generation+1 WHERE id='main'; END;
CREATE TRIGGER publication_fence_sale_drafts_delete AFTER DELETE ON sale_drafts BEGIN UPDATE publication_dependencies SET generation=generation+1 WHERE id='main'; END;
CREATE TRIGGER publication_fence_published_sales_insert AFTER INSERT ON published_sales BEGIN UPDATE publication_dependencies SET generation=generation+1 WHERE id='main'; END;
CREATE TRIGGER publication_fence_published_sales_update AFTER UPDATE ON published_sales BEGIN UPDATE publication_dependencies SET generation=generation+1 WHERE id='main'; END;
CREATE TRIGGER publication_fence_published_sales_delete AFTER DELETE ON published_sales BEGIN UPDATE publication_dependencies SET generation=generation+1 WHERE id='main'; END;
CREATE TRIGGER publication_fence_sale_destinations_insert AFTER INSERT ON sale_destinations BEGIN UPDATE publication_dependencies SET generation=generation+1 WHERE id='main'; END;
CREATE TRIGGER publication_fence_sale_destinations_update AFTER UPDATE ON sale_destinations BEGIN UPDATE publication_dependencies SET generation=generation+1 WHERE id='main'; END;
CREATE TRIGGER publication_fence_sale_destinations_delete AFTER DELETE ON sale_destinations BEGIN UPDATE publication_dependencies SET generation=generation+1 WHERE id='main'; END;
CREATE TRIGGER publication_fence_sales_shop_insert AFTER INSERT ON sales_shop BEGIN UPDATE publication_dependencies SET generation=generation+1 WHERE id='main'; END;
CREATE TRIGGER publication_fence_sales_shop_update AFTER UPDATE ON sales_shop BEGIN UPDATE publication_dependencies SET generation=generation+1 WHERE id='main'; END;
CREATE TRIGGER publication_fence_sales_shop_delete AFTER DELETE ON sales_shop BEGIN UPDATE publication_dependencies SET generation=generation+1 WHERE id='main'; END;
CREATE TRIGGER publication_fence_sales_control_leases_insert AFTER INSERT ON sales_control_leases BEGIN UPDATE publication_dependencies SET generation=generation+1 WHERE id='main'; END;
CREATE TRIGGER publication_fence_sales_control_leases_update AFTER UPDATE ON sales_control_leases BEGIN UPDATE publication_dependencies SET generation=generation+1 WHERE id='main'; END;
CREATE TRIGGER publication_fence_sales_control_leases_delete AFTER DELETE ON sales_control_leases BEGIN UPDATE publication_dependencies SET generation=generation+1 WHERE id='main'; END;
CREATE TRIGGER publication_fence_docs_insert AFTER INSERT ON docs WHEN NEW.ns IN ('domain-list-prices','registrar-domains','registrars','registrar-accounts','registrar-credentials','domain-events','imported-domains') BEGIN UPDATE publication_dependencies SET generation=generation+1 WHERE id='main'; END;
CREATE TRIGGER publication_fence_docs_update AFTER UPDATE ON docs WHEN NEW.ns IN ('domain-list-prices','registrar-domains','registrars','registrar-accounts','registrar-credentials','domain-events','imported-domains') BEGIN UPDATE publication_dependencies SET generation=generation+1 WHERE id='main'; END;
CREATE TRIGGER publication_fence_docs_delete AFTER DELETE ON docs WHEN OLD.ns IN ('domain-list-prices','registrar-domains','registrars','registrar-accounts','registrar-credentials','domain-events','imported-domains') BEGIN UPDATE publication_dependencies SET generation=generation+1 WHERE id='main'; END;
CREATE TRIGGER publication_fence_publication_authority_insert AFTER INSERT ON publication_authority BEGIN UPDATE publication_dependencies SET generation=generation+1 WHERE id='main'; END;
CREATE TRIGGER publication_fence_publication_authority_update AFTER UPDATE ON publication_authority BEGIN UPDATE publication_dependencies SET generation=generation+1 WHERE id='main'; END;
CREATE TRIGGER publication_fence_publication_authority_delete AFTER DELETE ON publication_authority BEGIN UPDATE publication_dependencies SET generation=generation+1 WHERE id='main'; END;
