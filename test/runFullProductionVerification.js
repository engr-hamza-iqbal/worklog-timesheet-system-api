import prisma from '../src/config/db.js';

async function main() {
  console.log('================================================================');
  console.log('  PRODUCTION VERIFICATION: REAL LARGE DATASET & QUERY PLANS');
  console.log('================================================================\n');

  // Verify dataset scale
  const [users, entries, timeoffs, accessLogs, projects, clients] = await Promise.all([
    prisma.user.count(),
    prisma.timeEntry.count(),
    prisma.timeOffRequest.count(),
    prisma.accessAuditLog.count(),
    prisma.project.count(),
    prisma.client.count(),
  ]);

  console.log(`Current Verified Dataset Scale:`);
  console.log(`- Users: ${users}`);
  console.log(`- TimeEntry rows: ${entries}`);
  console.log(`- TimeOffRequest rows: ${timeoffs}`);
  console.log(`- AccessAuditLog rows: ${accessLogs}`);
  console.log(`- Projects: ${projects}`);
  console.log(`- Clients: ${clients}`);
  console.log(`- Projects + Clients combined: ${projects + clients}\n`);

  // Select sample user and project with real entries
  const activeUser = await prisma.user.findFirst({
    where: { timeEntries: { some: {} } },
    select: { id: true, name: true },
  });
  const sampleUserId = activeUser?.id;
  console.log(`Using sample active user: ${activeUser?.name} (${sampleUserId})\n`);

  const queries = [
    {
      target: 'User list / search',
      name: 'user list/search',
      sql: `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT id, name, email, "accountType", "isActive", "createdAt" FROM "User" WHERE "accountType" != 'ADMIN' ORDER BY name ASC, id ASC LIMIT 50;`,
      textSql: `EXPLAIN (ANALYZE, BUFFERS) SELECT id, name, email, "accountType", "isActive", "createdAt" FROM "User" WHERE "accountType" != 'ADMIN' ORDER BY name ASC, id ASC LIMIT 50;`,
    },
    {
      target: 'TimeEntry history',
      name: 'TimeEntry history',
      sql: `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT * FROM "TimeEntry" WHERE "deletedAt" IS NULL AND "userId" = '${sampleUserId}' ORDER BY "workDate" DESC, "id" ASC LIMIT 50;`,
      textSql: `EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM "TimeEntry" WHERE "deletedAt" IS NULL AND "userId" = '${sampleUserId}' ORDER BY "workDate" DESC, "id" ASC LIMIT 50;`,
    },
    {
      target: 'Review queue',
      name: 'review queue',
      sql: `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT * FROM "TimeEntry" WHERE "status" = 'SUBMITTED' AND "deletedAt" IS NULL ORDER BY "workDate" ASC, "createdAt" ASC LIMIT 50;`,
      textSql: `EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM "TimeEntry" WHERE "status" = 'SUBMITTED' AND "deletedAt" IS NULL ORDER BY "workDate" ASC, "createdAt" ASC LIMIT 50;`,
    },
    {
      target: 'Reporting aggregation',
      name: 'reporting aggregation',
      sql: `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT "projectId", SUM("durationMinutes") as "totalMinutes" FROM "TimeEntry" WHERE "status" = 'APPROVED' AND "deletedAt" IS NULL AND "workDate" >= '2026-01-01' AND "workDate" <= '2026-12-31' GROUP BY "projectId";`,
      textSql: `EXPLAIN (ANALYZE, BUFFERS) SELECT "projectId", SUM("durationMinutes") as "totalMinutes" FROM "TimeEntry" WHERE "status" = 'APPROVED' AND "deletedAt" IS NULL AND "workDate" >= '2026-01-01' AND "workDate" <= '2026-12-31' GROUP BY "projectId";`,
    },
    {
      target: 'Capability lookup',
      name: 'capability lookup',
      sql: `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT * FROM "CapabilityGrant" WHERE "userId" = '${sampleUserId}' AND "revokedAt" IS NULL AND ("expiresAt" IS NULL OR "expiresAt" > NOW());`,
      textSql: `EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM "CapabilityGrant" WHERE "userId" = '${sampleUserId}' AND "revokedAt" IS NULL AND ("expiresAt" IS NULL OR "expiresAt" > NOW());`,
    },
    {
      target: 'Time-off list',
      name: 'time-off list',
      sql: `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT * FROM "TimeOffRequest" WHERE "userId" = '${sampleUserId}' ORDER BY "startDate" DESC, "id" DESC LIMIT 50;`,
      textSql: `EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM "TimeOffRequest" WHERE "userId" = '${sampleUserId}' ORDER BY "startDate" DESC, "id" DESC LIMIT 50;`,
    },
    {
      target: 'Project / client list',
      name: 'project/client list',
      sql: `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT id, name, "clientId", status, "createdAt" FROM "Project" WHERE status = 'ACTIVE' ORDER BY "createdAt" DESC, id DESC LIMIT 50;`,
      textSql: `EXPLAIN (ANALYZE, BUFFERS) SELECT id, name, "clientId", status, "createdAt" FROM "Project" WHERE status = 'ACTIVE' ORDER BY "createdAt" DESC, id DESC LIMIT 50;`,
    },
    {
      target: 'Audit log list',
      name: 'audit log list',
      sql: `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT * FROM "AccessAuditLog" WHERE "targetUserId" = '${sampleUserId}' ORDER BY "createdAt" DESC LIMIT 50;`,
      textSql: `EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM "AccessAuditLog" WHERE "targetUserId" = '${sampleUserId}' ORDER BY "createdAt" DESC LIMIT 50;`,
    },
  ];

  console.log('================================================================');
  console.log('  SECTION 2: EXPLAIN (ANALYZE, BUFFERS) RESULTS');
  console.log('================================================================\n');

  const reportItems = [];

  for (const q of queries) {
    console.log(`----------------------------------------------------------------`);
    console.log(`QUERY: ${q.name}`);
    console.log(`----------------------------------------------------------------`);

    // Run text explain for raw visual plan
    const textRows = await prisma.$queryRawUnsafe(q.textSql);
    const textPlan = textRows.map((r) => r['QUERY PLAN']).join('\n');
    console.log(textPlan);
    console.log('');

    // Run json explain for parsed stats
    const jsonRows = await prisma.$queryRawUnsafe(q.sql);
    const planObj = jsonRows[0]['QUERY PLAN'][0];
    const plan = planObj.Plan;

    // Helper to traverse nodes
    let scanType = 'N/A';
    let indexUsed = 'None';
    let sortType = 'None';
    let rowsScanned = 0;
    let sharedHit = 0;
    let sharedRead = 0;

    function walk(node) {
      if (node['Shared Hit Blocks']) sharedHit += node['Shared Hit Blocks'];
      if (node['Shared Read Blocks']) sharedRead += node['Shared Read Blocks'];
      if (node['Sort Method']) sortType = `${node['Sort Method']} (${node['Sort Space Type'] || 'memory'})`;
      if (node['Node Type'] && node['Node Type'].includes('Scan')) {
        scanType = node['Node Type'];
        if (node['Index Name']) indexUsed = node['Index Name'];
        if (node['Actual Rows'] !== undefined) rowsScanned += (node['Actual Rows'] * (node['Actual Loops'] || 1));
      }
      if (node.Plans) {
        for (const child of node.Plans) walk(child);
      }
    }
    walk(plan);

    const executionTimeMs = planObj['Execution Time'];
    const rowsReturned = plan['Actual Rows'];

    reportItems.push({
      name: q.name,
      rowsScanned: rowsScanned || rowsReturned,
      rowsReturned,
      executionTimeMs,
      scanType,
      sortType,
      indexUsed,
      bufferHitsReads: `Hits: ${sharedHit}, Reads: ${sharedRead}`,
    });
  }

  console.log('\n================================================================');
  console.log('  SUMMARY TABLE: EXPLAIN (ANALYZE, BUFFERS)');
  console.log('================================================================\n');
  console.table(reportItems);

  // -------------------------------------------------------------------------
  // SECTION 3: PAGINATION STRESS TEST (Page 1, 10, 100, 500)
  // -------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log('  SECTION 3: PAGINATION STRESS TEST (DEEP PAGES BENCHMARK)');
  console.log('================================================================\n');

  const pages = [
    { page: 1, offset: 0 },
    { page: 10, offset: 450 },
    { page: 100, offset: 4950 },
    { page: 500, offset: 24950 },
  ];

  const paginationResults = [];

  for (const p of pages) {
    const explainSql = `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT id, "workDate", "durationMinutes", "status" FROM "TimeEntry" WHERE "deletedAt" IS NULL ORDER BY "workDate" DESC, id ASC LIMIT 50 OFFSET ${p.offset};`;
    const jsonRows = await prisma.$queryRawUnsafe(explainSql);
    const planObj = jsonRows[0]['QUERY PLAN'][0];
    const plan = planObj.Plan;

    let sharedHit = 0;
    let sharedRead = 0;
    function walk(node) {
      if (node['Shared Hit Blocks']) sharedHit += node['Shared Hit Blocks'];
      if (node['Shared Read Blocks']) sharedRead += node['Shared Read Blocks'];
      if (node.Plans) {
        for (const child of node.Plans) walk(child);
      }
    }
    walk(plan);

    paginationResults.push({
      page: `Page ${p.page}`,
      offset: p.offset,
      limit: 50,
      executionTimeMs: `${planObj['Execution Time'].toFixed(2)} ms`,
      planningTimeMs: `${planObj['Planning Time'].toFixed(2)} ms`,
      rowsReturned: plan['Actual Rows'],
      bufferHitReads: `Hits: ${sharedHit}, Reads: ${sharedRead}`,
      nodeType: plan['Node Type'],
    });
  }

  console.table(paginationResults);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('Execution failed:', err);
  await prisma.$disconnect();
  process.exit(1);
});
