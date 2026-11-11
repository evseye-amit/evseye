import { createHash } from 'node:crypto';

const content = `Rider Commercial Terms — Pink Rides EV Rental & Spares\n\nThese terms govern vehicle rental, rider responsibilities, payments, safety, loss or damage, and return obligations for riders using Pink Rides vehicles. The rider must follow applicable law, operate the vehicle safely, and pay all agreed rental and related charges. These terms may be updated through a newly published version.`;

export const riderTerms = {
  code: 'PINKRIDES_RIDER_TERMS',
  version: 1,
  title: 'Pink Rides Rider Commercial Terms',
  content,
  contentHash: createHash('sha256').update(content).digest('hex'),
  status: 'DRAFT',
};
