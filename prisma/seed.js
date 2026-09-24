import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('--- Starting Seed Script (Node.js/JavaScript ESM) ---');

  // 1. Clean existing records in reverse dependency order for idempotency
  await prisma.emailLog.deleteMany();
  await prisma.accessAuditLog.deleteMany();
  await prisma.capabilityGrantScope.deleteMany();
  await prisma.capabilityGrant.deleteMany();
  await prisma.capability.deleteMany();
  await prisma.timeOffDay.deleteMany();
  await prisma.timeOffRequest.deleteMany();
  await prisma.timeOffType.deleteMany();
  await prisma.timeEntryHistory.deleteMany();
  await prisma.timeEntryRevision.deleteMany();
  await prisma.timeEntry.deleteMany();
  await prisma.projectRate.deleteMany();
  await prisma.projectAssignment.deleteMany();
  await prisma.project.deleteMany();
  await prisma.client.deleteMany();
  await prisma.user.deleteMany();

  console.log('Cleared existing data.');

  // 2. Hash standard test password
  const passwordHash = await bcrypt.hash('Password123!', 10);

  // 3. Seed Users (1 Admin, 4 Employees)
  const adminAlice = await prisma.user.create({
    data: {
      name: 'Alice Administrator',
      email: 'admin@worklog.local',
      passwordHash,
      accountType: 'ADMIN',
      isActive: true,
    },
  });

  const employeeBob = await prisma.user.create({
    data: {
      name: 'Bob Builder',
      email: 'bob@worklog.local',
      passwordHash,
      accountType: 'EMPLOYEE',
      isActive: true,
    },
  });

  const employeeCarol = await prisma.user.create({
    data: {
      name: 'Carol Consultant',
      email: 'carol@worklog.local',
      passwordHash,
      accountType: 'EMPLOYEE',
      isActive: true,
    },
  });

  const employeeDan = await prisma.user.create({
    data: {
      name: 'Dan Developer',
      email: 'dan@worklog.local',
      passwordHash,
      accountType: 'EMPLOYEE',
      isActive: true,
    },
  });

  const employeeEva = await prisma.user.create({
    data: {
      name: 'Eva Engineer',
      email: 'eva@worklog.local',
      passwordHash,
      accountType: 'EMPLOYEE',
      isActive: true,
    },
  });

  console.log('Seeded users: 1 Admin, 4 Employees.');

  // 4. Seed Capabilities (all 9 stable codes)
  const capabilitiesData = [
    {
      code: 'VIEW_OTHER_RECORDS',
      description: "Read-only access to view other people's work entries and time off.",
    },
    {
      code: 'REVIEW_TIME',
      description: 'Approve or return submitted work entries within granted scope.',
    },
    {
      code: 'DECIDE_TIME_OFF',
      description: 'Approve or decline time off requests within granted scope.',
    },
    {
      code: 'MANAGE_CLIENTS_PROJECTS',
      description: 'Create, update, archive clients and open/close projects.',
    },
    {
      code: 'ASSIGN_PROJECTS',
      description: 'Assign or unassign employees to and from projects.',
    },
    {
      code: 'MANAGE_USERS',
      description: 'Create user accounts and edit employee details.',
    },
    {
      code: 'VIEW_REPORTS',
      description: 'Access system reports including hours, missing timesheets, and leave.',
    },
    {
      code: 'VIEW_ANALYTICS',
      description: 'View aggregate dashboard charts and employee trend analytics.',
    },
    {
      code: 'VIEW_BILLING',
      description: 'View billing rates, calculated monetary values, and revenue metrics.',
    },
  ];

  const capabilityMap = {};
  for (const cap of capabilitiesData) {
    const created = await prisma.capability.create({ data: cap });
    capabilityMap[created.code] = created.id;
  }
  console.log('Seeded all 9 Capabilities.');

  // 5. Seed Clients (2 active, 1 archived)
  const clientAcme = await prisma.client.create({
    data: { name: 'Acme Corporation', isActive: true },
  });

  const clientTechNova = await prisma.client.create({
    data: { name: 'TechNova Solutions', isActive: true },
  });

  const clientStarlight = await prisma.client.create({
    data: { name: 'Starlight Media', isActive: false },
  });

  console.log('Seeded 3 Clients.');

  // 6. Seed Projects
  const projectAcmeCore = await prisma.project.create({
    data: {
      clientId: clientAcme.id,
      name: 'Acme Core Platform',
      status: 'ACTIVE',
    },
  });

  const projectAcmeMobile = await prisma.project.create({
    data: {
      clientId: clientAcme.id,
      name: 'Acme Mobile App',
      status: 'ACTIVE',
    },
  });

  const projectTechNovaCloud = await prisma.project.create({
    data: {
      clientId: clientTechNova.id,
      name: 'TechNova Cloud Migration',
      status: 'ACTIVE',
    },
  });

  const projectTechNovaLegacy = await prisma.project.create({
    data: {
      clientId: clientTechNova.id,
      name: 'TechNova Legacy ERP',
      status: 'CLOSED',
    },
  });

  const projectStarlightCampaign = await prisma.project.create({
    data: {
      clientId: clientStarlight.id,
      name: 'Starlight Campaign Portal',
      status: 'CLOSED',
    },
  });

  console.log('Seeded 5 Projects across active and closed states.');

  // 7. Seed Project Rates (Demonstrating rate history and effective dates)
  await prisma.projectRate.create({
    data: {
      projectId: projectAcmeCore.id,
      ratePerHour: 50.0,
      effectiveFrom: new Date('2026-01-01T00:00:00Z'),
      effectiveTo: new Date('2026-06-30T23:59:59Z'),
    },
  });

  await prisma.projectRate.create({
    data: {
      projectId: projectAcmeCore.id,
      ratePerHour: 70.0,
      effectiveFrom: new Date('2026-07-01T00:00:00Z'),
      effectiveTo: null,
    },
  });

  await prisma.projectRate.create({
    data: {
      projectId: projectTechNovaCloud.id,
      ratePerHour: 85.0,
      effectiveFrom: new Date('2026-01-01T00:00:00Z'),
      effectiveTo: null,
    },
  });

  await prisma.projectRate.create({
    data: {
      projectId: projectTechNovaLegacy.id,
      ratePerHour: 60.0,
      effectiveFrom: new Date('2025-01-01T00:00:00Z'),
      effectiveTo: new Date('2025-12-31T23:59:59Z'),
    },
  });

  console.log('Seeded Project Billing Rate histories.');

  // 8. Seed Project Assignments (active & historical)
  await prisma.projectAssignment.create({
    data: {
      userId: employeeBob.id,
      projectId: projectAcmeCore.id,
      assignedAt: new Date('2026-01-01'),
    },
  });

  await prisma.projectAssignment.create({
    data: {
      userId: employeeBob.id,
      projectId: projectTechNovaCloud.id,
      assignedAt: new Date('2026-02-01'),
    },
  });

  await prisma.projectAssignment.create({
    data: {
      userId: employeeCarol.id,
      projectId: projectAcmeCore.id,
      assignedAt: new Date('2026-01-15'),
    },
  });

  await prisma.projectAssignment.create({
    data: {
      userId: employeeDan.id,
      projectId: projectTechNovaCloud.id,
      assignedAt: new Date('2026-03-01'),
    },
  });

  await prisma.projectAssignment.create({
    data: {
      userId: employeeDan.id,
      projectId: projectTechNovaLegacy.id,
      assignedAt: new Date('2025-01-01'),
      removedAt: new Date('2025-12-31'),
    },
  });

  await prisma.projectAssignment.create({
    data: {
      userId: employeeEva.id,
      projectId: projectAcmeMobile.id,
      assignedAt: new Date('2026-01-01'),
    },
  });

  console.log('Seeded Project Assignments.');

  // 9. Seed Time Off Types
  const timeOffTypes = [
    { name: 'Annual Leave', description: 'Standard paid annual leave' },
    { name: 'Sick Leave', description: 'Paid or unpaid medical leave' },
    { name: 'Unpaid Leave', description: 'Approved unpaid absence' },
  ];

  for (const tot of timeOffTypes) {
    await prisma.timeOffType.create({ data: tot });
  }
  console.log('Seeded Time Off Types.');

  // 10. Seed Capability Grants & Scopes
  // Bob: Global VIEW_REPORTS
  const bobReportsGrant = await prisma.capabilityGrant.create({
    data: {
      userId: employeeBob.id,
      capabilityId: capabilityMap['VIEW_REPORTS'],
      grantedById: adminAlice.id,
    },
  });

  await prisma.accessAuditLog.create({
    data: {
      action: 'GRANT',
      actorId: adminAlice.id,
      targetUserId: employeeBob.id,
      capabilityCode: 'VIEW_REPORTS',
      grantId: bobReportsGrant.id,
      details: { scope: 'GLOBAL' },
    },
  });

  // Bob: REVIEW_TIME scoped strictly to Acme Core Platform
  const bobReviewGrant = await prisma.capabilityGrant.create({
    data: {
      userId: employeeBob.id,
      capabilityId: capabilityMap['REVIEW_TIME'],
      grantedById: adminAlice.id,
    },
  });

  await prisma.capabilityGrantScope.create({
    data: {
      grantId: bobReviewGrant.id,
      scopeType: 'PROJECT',
      targetProjectId: projectAcmeCore.id,
    },
  });

  await prisma.accessAuditLog.create({
    data: {
      action: 'GRANT',
      actorId: adminAlice.id,
      targetUserId: employeeBob.id,
      capabilityCode: 'REVIEW_TIME',
      grantId: bobReviewGrant.id,
      details: { scope: 'PROJECT', projectId: projectAcmeCore.id },
    },
  });

  // Carol: VIEW_OTHER_RECORDS scoped to Dan
  const carolViewDanGrant = await prisma.capabilityGrant.create({
    data: {
      userId: employeeCarol.id,
      capabilityId: capabilityMap['VIEW_OTHER_RECORDS'],
      grantedById: adminAlice.id,
    },
  });

  await prisma.capabilityGrantScope.create({
    data: {
      grantId: carolViewDanGrant.id,
      scopeType: 'USER',
      targetUserId: employeeDan.id,
    },
  });

  // Carol: DECIDE_TIME_OFF temporary
  await prisma.capabilityGrant.create({
    data: {
      userId: employeeCarol.id,
      capabilityId: capabilityMap['DECIDE_TIME_OFF'],
      grantedById: adminAlice.id,
      expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    },
  });

  // Dan: VIEW_BILLING revoked
  const danRevokedGrant = await prisma.capabilityGrant.create({
    data: {
      userId: employeeDan.id,
      capabilityId: capabilityMap['VIEW_BILLING'],
      grantedById: adminAlice.id,
      revokedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
      revokedById: adminAlice.id,
    },
  });

  await prisma.accessAuditLog.create({
    data: {
      action: 'REVOKE',
      actorId: adminAlice.id,
      targetUserId: employeeDan.id,
      capabilityCode: 'VIEW_BILLING',
      grantId: danRevokedGrant.id,
      details: { reason: 'Access rotation' },
    },
  });

  console.log('Seeded Capability Grants, Scopes, and Access Audit Logs.');

  // 11. Seed Sample Time Entries across employees and projects
  // Dates across September 2026
  const sampleEntries = [
    // Bob on Acme Core Platform (APPROVED)
    {
      user: employeeBob,
      project: projectAcmeCore,
      workDate: new Date('2026-09-15T00:00:00Z'),
      durationMinutes: 480, // 8h
      description: 'Architected and built authentication and authorization middleware.',
      status: 'APPROVED',
      rate: 70.0,
    },
    {
      user: employeeBob,
      project: projectAcmeCore,
      workDate: new Date('2026-09-16T00:00:00Z'),
      durationMinutes: 360, // 6h
      description: 'Implemented capability grant verification and scoping logic.',
      status: 'APPROVED',
      rate: 70.0,
    },
    {
      user: employeeBob,
      project: projectTechNovaCloud,
      workDate: new Date('2026-09-17T00:00:00Z'),
      durationMinutes: 420, // 7h
      description: 'Provisioned cloud resources and PostgreSQL database cluster.',
      status: 'APPROVED',
      rate: 85.0,
    },
    {
      user: employeeBob,
      project: projectTechNovaCloud,
      workDate: new Date('2026-09-18T00:00:00Z'),
      durationMinutes: 300, // 5h
      description: 'Tested connection poolers and latency benchmarks.',
      status: 'SUBMITTED',
      rate: null,
    },
    // Carol on Acme Core Platform (APPROVED & RETURNED)
    {
      user: employeeCarol,
      project: projectAcmeCore,
      workDate: new Date('2026-09-15T00:00:00Z'),
      durationMinutes: 450, // 7.5h
      description: 'Designed relational database models, constraints, and audit logs.',
      status: 'APPROVED',
      rate: 70.0,
    },
    {
      user: employeeCarol,
      project: projectAcmeCore,
      workDate: new Date('2026-09-16T00:00:00Z'),
      durationMinutes: 480, // 8h
      description: 'Implemented financial reporting queries and SQL aggregations.',
      status: 'APPROVED',
      rate: 70.0,
    },
    {
      user: employeeCarol,
      project: projectAcmeCore,
      workDate: new Date('2026-09-17T00:00:00Z'),
      durationMinutes: 240, // 4h
      description: 'Wrote unit tests for rate snapshot calculations.',
      status: 'RETURNED',
      rate: null,
    },
    // Dan on TechNova Cloud (APPROVED)
    {
      user: employeeDan,
      project: projectTechNovaCloud,
      workDate: new Date('2026-09-15T00:00:00Z'),
      durationMinutes: 480, // 8h
      description: 'Implemented Docker container build scripts and CI/CD pipelines.',
      status: 'APPROVED',
      rate: 85.0,
    },
    {
      user: employeeDan,
      project: projectTechNovaCloud,
      workDate: new Date('2026-09-16T00:00:00Z'),
      durationMinutes: 360, // 6h
      description: 'Configured SSL certificates and reverse proxy routing.',
      status: 'APPROVED',
      rate: 85.0,
    },
    // Eva on Acme Mobile App (APPROVED & SUBMITTED)
    {
      user: employeeEva,
      project: projectAcmeMobile,
      workDate: new Date('2026-09-15T00:00:00Z'),
      durationMinutes: 420, // 7h
      description: 'Built mobile responsive timesheet entry grid with keyboard navigation.',
      status: 'APPROVED',
      rate: 70.0,
    },
    {
      user: employeeEva,
      project: projectAcmeMobile,
      workDate: new Date('2026-09-16T00:00:00Z'),
      durationMinutes: 480, // 8h
      description: 'Integrated review queue approval flow and multi-entry selection.',
      status: 'APPROVED',
      rate: 70.0,
    },
    {
      user: employeeEva,
      project: projectAcmeMobile,
      workDate: new Date('2026-09-17T00:00:00Z'),
      durationMinutes: 300, // 5h
      description: 'Refined date pickers, filter resets, and error handling.',
      status: 'SUBMITTED',
      rate: null,
    },
  ];

  for (const item of sampleEntries) {
    const entry = await prisma.timeEntry.create({
      data: {
        userId: item.user.id,
        projectId: item.project.id,
        workDate: item.workDate,
        durationMinutes: item.durationMinutes,
        description: item.description,
        status: item.status,
        approvedRateSnapshot: item.rate,
        currentRevisionNumber: 1,
      },
    });

    await prisma.timeEntryRevision.create({
      data: {
        timeEntryId: entry.id,
        revisionNumber: 1,
        projectId: item.project.id,
        workDate: item.workDate,
        durationMinutes: item.durationMinutes,
        description: item.description,
        billingRateSnapshot: item.rate,
        createdById: item.user.id,
      },
    });

    await prisma.timeEntryHistory.create({
      data: {
        timeEntryId: entry.id,
        action: item.status === 'APPROVED' ? 'APPROVE' : item.status === 'RETURNED' ? 'RETURN' : item.status === 'SUBMITTED' ? 'SUBMIT' : 'CREATE',
        previousStatus: item.status === 'APPROVED' ? 'SUBMITTED' : item.status === 'RETURNED' ? 'SUBMITTED' : null,
        newStatus: item.status,
        performedById: item.status === 'APPROVED' ? adminAlice.id : item.user.id,
        comment: item.status === 'RETURNED' ? 'Please elaborate on the description of work done.' : null,
      },
    });
  }
  console.log('Seeded 12 sample Time Entries across projects and statuses.');

  // 12. Seed an approved Time Off request for Dan on 2026-09-18
  const annualLeaveType = await prisma.timeOffType.findFirst({ where: { name: 'Annual Leave' } });
  if (annualLeaveType) {
    const leaveDate = new Date('2026-09-18T00:00:00Z');
    const danLeave = await prisma.timeOffRequest.create({
      data: {
        userId: employeeDan.id,
        timeOffTypeId: annualLeaveType.id,
        startDate: leaveDate,
        endDate: leaveDate,
        reason: 'Scheduled personal annual leave day.',
        status: 'APPROVED',
        decidedById: adminAlice.id,
        decidedAt: new Date('2026-09-10T00:00:00Z'),
        days: {
          create: [{
            userId: employeeDan.id,
            date: leaveDate,
            status: 'APPROVED',
          }],
        },
      },
    });
    console.log('Seeded approved Time Off Request for Dan (demonstrating missing timesheet exclusion).');
  }

  console.log('--- Seed Completed Successfully (Node.js/JavaScript ESM) ---');
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
