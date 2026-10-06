import prisma from '../config/db.js';

/**
 * Audits and fixes rate period continuity and overlaps across all projects.
 * 
 * Rules:
 * 1. For any project, rates ordered chronologically by effectiveFrom must form contiguous, non-overlapping intervals.
 * 2. Every historical rate (i < len - 1) must have effectiveTo set to the subsequent rate's effectiveFrom.
 * 3. The current/latest rate (len - 1) must have effectiveTo = null.
 */
export async function auditAndCleanRatePeriods({ dryRun = false } = {}) {
  const projects = await prisma.project.findMany({
    select: { id: true, name: true },
  });

  const report = {
    totalProjects: projects.length,
    projectsWithIssues: 0,
    ratesAdjusted: 0,
    adjustments: [],
  };

  for (const project of projects) {
    const rates = await prisma.projectRate.findMany({
      where: { projectId: project.id },
      orderBy: [{ effectiveFrom: 'asc' }, { createdAt: 'asc' }],
    });

    if (rates.length === 0) continue;

    const projectAdjustments = [];

    if (rates.length === 1) {
      if (rates[0].effectiveTo !== null) {
        projectAdjustments.push({
          rateId: rates[0].id,
          effectiveFrom: rates[0].effectiveFrom,
          oldEffectiveTo: rates[0].effectiveTo,
          newEffectiveTo: null,
          reason: 'Sole project rate must be open-ended (effectiveTo = null)',
        });
      }
    } else {
      for (let i = 0; i < rates.length; i++) {
        const current = rates[i];
        const isLatest = i === rates.length - 1;

        if (isLatest) {
          if (current.effectiveTo !== null) {
            projectAdjustments.push({
              rateId: current.id,
              effectiveFrom: current.effectiveFrom,
              oldEffectiveTo: current.effectiveTo,
              newEffectiveTo: null,
              reason: 'Latest project rate must be open-ended (effectiveTo = null)',
            });
          }
        } else {
          const next = rates[i + 1];
          const expectedToTime = new Date(next.effectiveFrom).getTime();
          const currentToTime = current.effectiveTo ? new Date(current.effectiveTo).getTime() : null;

          if (currentToTime !== expectedToTime) {
            projectAdjustments.push({
              rateId: current.id,
              effectiveFrom: current.effectiveFrom,
              oldEffectiveTo: current.effectiveTo,
              newEffectiveTo: next.effectiveFrom,
              reason: `Rate period must terminate contiguously at subsequent rate effectiveFrom (${next.effectiveFrom.toISOString()})`,
            });
          }
        }
      }
    }

    if (projectAdjustments.length > 0) {
      report.projectsWithIssues += 1;
      report.ratesAdjusted += projectAdjustments.length;
      report.adjustments.push({
        projectId: project.id,
        projectName: project.name,
        changes: projectAdjustments,
      });

      if (!dryRun) {
        await prisma.$transaction(
          projectAdjustments.map((adj) =>
            prisma.projectRate.update({
              where: { id: adj.rateId },
              data: { effectiveTo: adj.newEffectiveTo },
            })
          )
        );
      }
    }
  }

  return report;
}

export default {
  auditAndCleanRatePeriods,
};
