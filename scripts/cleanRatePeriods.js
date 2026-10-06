import { auditAndCleanRatePeriods } from '../src/utils/ratePeriodCleanup.js';
import prisma from '../src/config/db.js';

async function run() {
  console.log('--- Starting Rate-Period Cleanup & Migration Audit ---');
  try {
    const isDryRun = process.argv.includes('--dry-run');
    if (isDryRun) {
      console.log('Running in DRY-RUN mode. No database rows will be altered.');
    }
    const report = await auditAndCleanRatePeriods({ dryRun: isDryRun });
    console.log(`Audited ${report.totalProjects} projects.`);
    if (report.projectsWithIssues === 0) {
      console.log('✔ All project rate periods are contiguous, non-overlapping, and valid.');
    } else {
      console.log(`Found issues in ${report.projectsWithIssues} projects.`);
      console.log(`${isDryRun ? 'Would adjust' : 'Successfully adjusted'} ${report.ratesAdjusted} rate records.`);
      for (const adj of report.adjustments) {
        console.log(`  Project: ${adj.projectName} (${adj.projectId})`);
        for (const change of adj.changes) {
          console.log(`    - Rate ${change.rateId}: effectiveTo changed from ${change.oldEffectiveTo?.toISOString?.() ?? change.oldEffectiveTo} to ${change.newEffectiveTo?.toISOString?.() ?? change.newEffectiveTo} (${change.reason})`);
        }
      }
    }
  } catch (err) {
    console.error('Failed to clean rate periods:', err);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

run();
