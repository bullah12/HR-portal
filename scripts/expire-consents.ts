/**
 * Scheduled consent-expiry job (docs/PLAN.md §7 Phase 6): flags candidates
 * whose every active ConsentRecord is past expiresAt and audits the
 * transition. Run it daily, e.g.:
 *   npm run consents:expire                       # locally / cron
 *   fly machine run . --schedule daily -- npm run consents:expire   # Fly
 */

import { prisma } from '../lib/prisma';
import { expireOverdueConsents } from '../lib/consent';

expireOverdueConsents()
  .then((result) => {
    console.log(
      `Consent expiry sweep: checked ${result.checkedCandidates} candidate(s), ` +
        `expired ${result.expiredCandidates} candidate(s) / ${result.expiredRecords} record(s).`,
    );
  })
  .catch((error) => {
    console.error('Consent expiry sweep failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
