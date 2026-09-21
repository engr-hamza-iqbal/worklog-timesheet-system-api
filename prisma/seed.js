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
