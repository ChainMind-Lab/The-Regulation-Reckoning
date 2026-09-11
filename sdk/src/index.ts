/**
 * `@regulation-reckoning/sdk` — the public TypeScript client for the
 * Regulation Reckoning regulatory-research and bounty API.
 *
 * ```ts
 * import { RegulationReckoningClient } from '@regulation-reckoning/sdk';
 *
 * const rr = new RegulationReckoningClient({ baseUrl: 'http://localhost:3001' });
 * console.log(await rr.compareJurisdictions(['EU', 'US']));
 * ```
 */

export { RegulationReckoningClient, RegulationReckoningError } from './client';
export type { ClientOptions, FetchLike } from './client';
export type * from './types';
