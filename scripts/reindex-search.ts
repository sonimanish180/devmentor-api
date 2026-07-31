/**
 * On-demand rebuild of the search read model (Task 11.3). Run after seeding,
 * or any time catalog content changes out-of-band:
 *
 *   pnpm search:reindex
 */
import { reindexSearch } from '../src/modules/search/reindex';
import { prisma } from '../src/lib/prisma';

reindexSearch()
  .then((count) => {
    console.log(`Reindexed ${count} lesson(s) into SearchIndexEntry.`);
  })
  .catch((err) => {
    console.error('Reindex failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
