import { publishedSaleSchema } from './sales';
/** Minimal public commercial projection shared by live and private preview readers. */
export const publicSalesLinkTermsSchema = publishedSaleSchema.pick({
  version: true,
  id: true,
  domain: true,
  revision: true,
  mode: true,
  publicPrice: true,
  publicMinimumOffer: true,
});
export const publicSalesLinkTermsQuery = `SELECT json_object(
 'version',json_extract(p.payload,'$.version'),
 'id',json_extract(p.payload,'$.id'),
 'domain',json_extract(p.payload,'$.domain'),
 'revision',json_extract(p.payload,'$.revision'),
 'mode',json_extract(p.payload,'$.mode'),
 'publicPrice',json_extract(p.payload,'$.publicPrice'),
 'publicMinimumOffer',json_extract(p.payload,'$.publicMinimumOffer')
 ) AS payload,d.availability,d.control_expires_at
 FROM published_sales p JOIN sale_drafts d ON d.id=p.id
 WHERE p.id IN (SELECT value FROM json_each(?))
 AND p.id=json_extract(p.payload,'$.id')
 AND p.domain=json_extract(p.payload,'$.domain')
 AND p.revision=json_extract(p.payload,'$.revision')`;
