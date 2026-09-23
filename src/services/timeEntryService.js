import prisma from '../config/db.js';
import { checkUserCapability } from './accessService.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const MIN_INCREMENT_MINUTES = 15;   // 0.25 h
const MAX_DAILY_MINUTES     = 1440; // 24 h
const MAX_ENTRY_MINUTES     = 960;  // 16 h per single entry
const MAX_PAST_DAYS         = 60;   // cannot log older than this
const MIN_DESC_LENGTH       = 5;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Parse an ISO date string or Date into a UTC midnight Date with no time component.
 * Supabase stores @db.Date columns as "YYYY-MM-DD 00:00:00+00" — comparing by
 * converting both sides to the same format keeps everything consistent.
 */
function toDateOnly(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
}

/** Returns ISO date string "YYYY-MM-DD" from any date-like value. */
function toIsoDate(d) {
  return toDateOnly(d).toISOString().split('T')[0];
}

// ─── Validation helpers ───────────────────────────────────────────────────────

function validateDuration(minutes) {
  if (!Number.isInteger(minutes) || minutes <= 0) {
    throw Object.assign(new Error('Duration must be a positive integer (minutes).'), { status: 400 });
  }
  if (minutes % MIN_INCREMENT_MINUTES !== 0) {
    throw Object.assign(
      new Error(`Duration must be a multiple of ${MIN_INCREMENT_MINUTES} minutes (0.25 h increments).`),
      { status: 400 }
    );
  }
  if (minutes > MAX_ENTRY_MINUTES) {
    throw Object.assign(
      new Error(`A single entry cannot exceed ${MAX_ENTRY_MINUTES} minutes (${MAX_ENTRY_MINUTES / 60} h).`),
      { status: 400 }
    );
  }
}

function validateDate(workDate) {
  if (!workDate || Number.isNaN(new Date(workDate).getTime())) {
    throw Object.assign(new Error('Work date must be a valid date.'), { status: 400 });
  }
  const today = toDateOnly(new Date());
  const entry = toDateOnly(workDate);

  if (entry > today) {
    throw Object.assign(new Error('Cannot log time for a future date.'), { status: 400 });
  }

  const diffDays = (today - entry) / (1000 * 60 * 60 * 24);
  if (diffDays > MAX_PAST_DAYS) {
    throw Object.assign(
      new Error(`Cannot log time older than ${MAX_PAST_DAYS} days (closed accounting period).`),
      { status: 400 }
    );
  }
}

function validateDescription(description) {
  if (!description || description.trim().length < MIN_DESC_LENGTH) {
    throw Object.assign(
      new Error(`Description must be at least ${MIN_DESC_LENGTH} characters.`),
      { status: 400 }
    );
  }
}

// ─── Business-rule checks ─────────────────────────────────────────────────────

async function checkProjectAccessible(userId, projectId, isAdmin) {
  // Fetch project (and check it's ACTIVE)
  const [project, assignment] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, status: true },
    }),
    isAdmin ? Promise.resolve(null) : prisma.projectAssignment.findFirst({
      where: { userId, projectId, removedAt: null },
      select: { id: true },
    }),
  ]);

  if (!project) {
    throw Object.assign(new Error('Project not found.'), { status: 404 });
  }
  if (project.status !== 'ACTIVE') {
    throw Object.assign(new Error('Cannot log time against a closed project.'), { status: 400 });
  }

  // Admins bypass assignment requirement
  if (isAdmin) return;

  if (!assignment) {
    throw Object.assign(
      new Error('You are not assigned to this project.'),
      { status: 403 }
    );
  }
}

async function checkDailyCap(userId, workDate, additionalMinutes, excludeEntryId = null) {
  const dateStr = toIsoDate(workDate);
  const startOfDay = new Date(`${dateStr}T00:00:00.000Z`);
  const endOfDay   = new Date(`${dateStr}T23:59:59.999Z`);

  const entries = await prisma.timeEntry.findMany({
    where: {
      userId,
      deletedAt: null,
      workDate: { gte: startOfDay, lte: endOfDay },
      status: { not: 'RETURNED' }, // RETURNED entries don't count toward daily total until re-submitted
      ...(excludeEntryId ? { NOT: { id: excludeEntryId } } : {}),
    },
    select: { durationMinutes: true },
  });

  const currentTotal = entries.reduce((sum, e) => sum + e.durationMinutes, 0);
  if (currentTotal + additionalMinutes > MAX_DAILY_MINUTES) {
    throw Object.assign(
      new Error(
        `This entry would exceed the daily maximum of ${MAX_DAILY_MINUTES / 60} hours. ` +
        `You have ${(MAX_DAILY_MINUTES - currentTotal) / 60} h remaining for this day.`
      ),
      { status: 400 }
    );
  }
}

async function checkNoApprovedTimeOff(userId, workDate) {
  const dateStr = toIsoDate(workDate);
  const date = new Date(`${dateStr}T00:00:00.000Z`);

  const timeOffDay = await prisma.timeOffDay.findFirst({
    where: { userId, date, status: 'APPROVED' },
  });
  if (timeOffDay) {
    throw Object.assign(
      new Error('Cannot log time on a day covered by approved time off.'),
      { status: 400 }
    );
  }
}

// ─── History logging ──────────────────────────────────────────────────────────

async function logHistory(tx, { timeEntryId, action, previousStatus, newStatus, performedById, comment }) {
  await tx.timeEntryHistory.create({
    data: { timeEntryId, action, previousStatus, newStatus, performedById, comment },
  });
}

// ─── Service functions ────────────────────────────────────────────────────────

/**
 * Create a new DRAFT time entry.
 *
 * @param {object} actorUser  req.user (id, accountType)
 * @param {object} data       { projectId, workDate, durationMinutes, description }
 */
export async function createTimeEntry(actorUser, data) {
  const { projectId, workDate, durationMinutes, description } = data;
  const isAdmin = actorUser.accountType === 'ADMIN';

  // ── Validation ────────────────────────────────────────────────────────────
  validateDuration(durationMinutes);
  validateDate(workDate);
  validateDescription(description);
  await checkProjectAccessible(actorUser.id, projectId, isAdmin);
  await Promise.all([
    checkNoApprovedTimeOff(actorUser.id, workDate),
    checkDailyCap(actorUser.id, workDate, durationMinutes),
  ]);

  // ── Create entry + history in a transaction ───────────────────────────────
  const entry = await prisma.$transaction(async (tx) => {
    const created = await tx.timeEntry.create({
      data: {
        userId: actorUser.id,
        projectId,
        workDate: new Date(`${toIsoDate(workDate)}T00:00:00.000Z`),
        durationMinutes,
        description: description.trim(),
        status: 'DRAFT',
        currentRevisionNumber: 1,
      },
      include: {
        project: { select: { id: true, name: true, status: true, client: { select: { id: true, name: true } } } },
      },
    });

    await logHistory(tx, {
      timeEntryId: created.id,
      action: 'CREATE',
      previousStatus: null,
      newStatus: 'DRAFT',
      performedById: actorUser.id,
    });

    return created;
  });

  return formatEntry(entry);
}

/**
 * Update a DRAFT or RETURNED time entry. Creates a revision snapshot before applying changes.
 *
 * @param {object} actorUser  req.user
 * @param {string} entryId
 * @param {object} data       { projectId?, workDate?, durationMinutes?, description? }
 */
export async function updateTimeEntry(actorUser, entryId, data) {
  const isAdmin = actorUser.accountType === 'ADMIN';

  const existing = await prisma.timeEntry.findUnique({ where: { id: entryId } });
  if (!existing) {
    throw Object.assign(new Error('Time entry not found.'), { status: 404 });
  }

  // Ownership: employees can only edit their own
  if (!isAdmin && existing.userId !== actorUser.id) {
    throw Object.assign(new Error('You can only edit your own time entries.'), { status: 403 });
  }

  if (existing.status !== 'DRAFT' && existing.status !== 'RETURNED') {
    throw Object.assign(
      new Error(`Cannot edit a time entry with status '${existing.status}'. Only DRAFT or RETURNED entries can be modified.`),
      { status: 400 }
    );
  }

  // Resolve final values (merge with existing)
  const newProjectId       = data.projectId       ?? existing.projectId;
  const newWorkDate        = data.workDate        ?? existing.workDate;
  const newDurationMinutes = data.durationMinutes ?? existing.durationMinutes;
  const newDescription     = data.description     ?? existing.description;

  // ── Validation ────────────────────────────────────────────────────────────
  validateDuration(newDurationMinutes);
  validateDate(newWorkDate);
  validateDescription(newDescription);

  if (newProjectId !== existing.projectId) {
    await checkProjectAccessible(existing.userId, newProjectId, isAdmin);
  } else if (existing.status === 'DRAFT') {
    // Still validate project is still ACTIVE even if unchanged
    const project = await prisma.project.findUnique({ where: { id: newProjectId }, select: { status: true } });
    if (project?.status !== 'ACTIVE') {
      throw Object.assign(new Error('Cannot log time against a closed project.'), { status: 400 });
    }
  }

  await Promise.all([
    checkNoApprovedTimeOff(existing.userId, newWorkDate),
    checkDailyCap(existing.userId, newWorkDate, newDurationMinutes, entryId),
  ]);

  const updated = await prisma.$transaction(async (tx) => {
    const prevStatus = existing.status;
    const nextRevision = existing.currentRevisionNumber + 1;

    // Save immutable revision snapshot of CURRENT state before overwriting
    await tx.timeEntryRevision.create({
      data: {
        timeEntryId:     existing.id,
        revisionNumber:  existing.currentRevisionNumber,
        projectId:       existing.projectId,
        workDate:        existing.workDate,
        durationMinutes: existing.durationMinutes,
        description:     existing.description,
        createdById:     actorUser.id,
      },
    });

    // RETURNED → DRAFT on edit (user is addressing the return feedback)
    const newStatus = prevStatus === 'RETURNED' ? 'DRAFT' : prevStatus;

    const result = await tx.timeEntry.update({
      where: { id: entryId },
      data: {
        projectId:            newProjectId,
        workDate:             new Date(`${toIsoDate(newWorkDate)}T00:00:00.000Z`),
        durationMinutes:      newDurationMinutes,
        description:          newDescription.trim(),
        status:               newStatus,
        currentRevisionNumber: nextRevision,
      },
      include: {
        project: { select: { id: true, name: true, status: true, client: { select: { id: true, name: true } } } },
      },
    });

    await logHistory(tx, {
      timeEntryId: entryId,
      action: prevStatus === 'RETURNED' ? 'RESUBMIT' : 'UPDATE',
      previousStatus: prevStatus,
      newStatus,
      performedById: actorUser.id,
    });

    return result;
  });

  return formatEntry(updated);
}

/**
 * Delete a DRAFT or RETURNED time entry.
 *
 * @param {object} actorUser  req.user
 * @param {string} entryId
 */
export async function deleteTimeEntry(actorUser, entryId) {
  const isAdmin = actorUser.accountType === 'ADMIN';

  const existing = await prisma.timeEntry.findUnique({ where: { id: entryId } });
  if (!existing) {
    throw Object.assign(new Error('Time entry not found.'), { status: 404 });
  }

  if (!isAdmin && existing.userId !== actorUser.id) {
    throw Object.assign(new Error('You can only delete your own time entries.'), { status: 403 });
  }

  if (existing.status !== 'DRAFT' && existing.status !== 'RETURNED') {
    throw Object.assign(
      new Error(`Cannot delete a time entry with status '${existing.status}'.`),
      { status: 400 }
    );
  }

  // Log deletion history before hard-delete
  // We keep the history in the DB but the entry itself is removed.
  await prisma.$transaction(async (tx) => {
    await logHistory(tx, {
      timeEntryId: entryId,
      action: 'DELETE',
      previousStatus: existing.status,
      newStatus: existing.status,
      performedById: actorUser.id,
    });

    await tx.timeEntry.update({ where: { id: entryId }, data: { deletedAt: new Date() } });
  });
}

/**
 * Fetch all time entries for a given user within a date range, grouped by day.
 *
 * @param {object} actorUser  req.user
 * @param {string} targetUserId  — actorUser.id unless viewing another's records
 * @param {string} startDate  "YYYY-MM-DD"
 * @param {string} endDate    "YYYY-MM-DD"
 */
export async function getTimeEntriesForPeriod(actorUser, targetUserId, startDate, endDate) {
  const isAdmin = actorUser.accountType === 'ADMIN';

  // Employees can only view their own entries (VIEW_OTHER_RECORDS is checked at controller level)
  if (!isAdmin && targetUserId !== actorUser.id) {
    const canView = await checkUserCapability(actorUser, 'VIEW_OTHER_RECORDS', { targetUserId });
    if (!canView) throw Object.assign(new Error('Access denied.'), { status: 403 });
  }

  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end   = new Date(`${endDate}T23:59:59.999Z`);

  const entries = await prisma.timeEntry.findMany({
    where: { userId: targetUserId, deletedAt: null, workDate: { gte: start, lte: end } },
    include: {
      project: { select: { id: true, name: true, status: true, client: { select: { id: true, name: true } } } },
      histories: {
        orderBy: { createdAt: 'desc' },
        take: 1, // most recent history event (e.g. return comment)
        include: { performedBy: { select: { id: true, name: true } } },
      },
    },
    orderBy: [{ workDate: 'asc' }, { createdAt: 'asc' }],
  });

  const approvedTimeOff = await prisma.timeOffDay.findMany({
    where: {
      userId: targetUserId,
      status: 'APPROVED',
      date: { gte: start, lte: end },
    },
    include: {
      timeOffRequest: { include: { timeOffType: { select: { id: true, name: true } } } },
    },
    orderBy: { date: 'asc' },
  });

  // Group by date string "YYYY-MM-DD"
  const byDay = {};
  for (const e of entries) {
    const key = toIsoDate(e.workDate);
    if (!byDay[key]) byDay[key] = { date: key, totalMinutes: 0, entries: [] };
    byDay[key].entries.push(formatEntry(e));
    byDay[key].totalMinutes += e.durationMinutes;
  }

  for (const timeOffDay of approvedTimeOff) {
    const key = toIsoDate(timeOffDay.date);
    if (!byDay[key]) byDay[key] = { date: key, totalMinutes: 0, entries: [] };
    byDay[key].timeOff = {
      status: 'APPROVED',
      type: timeOffDay.timeOffRequest.timeOffType,
    };
  }

  const days = Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date));
  const totalMinutes = days.reduce((s, d) => s + d.totalMinutes, 0);

  return { days, totalMinutes, startDate, endDate };
}

/**
 * Batch submit entries from DRAFT or RETURNED → SUBMITTED.
 *
 * @param {object} actorUser   req.user
 * @param {string[]} entryIds
 */
export async function submitEntries(actorUser, entryIds) {
  if (!Array.isArray(entryIds) || entryIds.length === 0) {
    throw Object.assign(new Error('No entry IDs provided.'), { status: 400 });
  }

  const isAdmin = actorUser.accountType === 'ADMIN';

  const entries = await prisma.timeEntry.findMany({
    where: { id: { in: entryIds }, deletedAt: null },
  });

  if (entries.length !== entryIds.length) {
    throw Object.assign(new Error('One or more time entries not found.'), { status: 404 });
  }

  const invalid = entries.filter((e) => e.status !== 'DRAFT' && e.status !== 'RETURNED');
  if (invalid.length > 0) {
    throw Object.assign(
      new Error(`Cannot submit entries with status other than DRAFT or RETURNED. Invalid IDs: ${invalid.map((e) => e.id).join(', ')}`),
      { status: 400 }
    );
  }

  const unauthorized = entries.filter((e) => !isAdmin && e.userId !== actorUser.id);
  if (unauthorized.length > 0) {
    throw Object.assign(new Error('You can only submit your own time entries.'), { status: 403 });
  }

  await prisma.$transaction(async (tx) => {
    for (const e of entries) {
      await tx.timeEntry.update({ where: { id: e.id }, data: { status: 'SUBMITTED' } });
      await logHistory(tx, {
        timeEntryId: e.id,
        action: e.status === 'RETURNED' ? 'RESUBMIT' : 'SUBMIT',
        previousStatus: e.status,
        newStatus: 'SUBMITTED',
        performedById: actorUser.id,
      });
    }
  });

  return { submittedCount: entries.length };
}

// ─── Format helper ────────────────────────────────────────────────────────────

function formatEntry(e) {
  const lastHistory = e.histories?.[0] ?? null;
  return {
    id:              e.id,
    userId:          e.userId,
    projectId:       e.projectId,
    project:         e.project ? {
      id:         e.project.id,
      name:       e.project.name,
      status:     e.project.status,
      clientId:   e.project.client?.id,
      clientName: e.project.client?.name,
    } : undefined,
    workDate:        toIsoDate(e.workDate),
    durationMinutes: e.durationMinutes,
    durationHours:   e.durationMinutes / 60,
    description:     e.description,
    status:          e.status,
    revisionNumber:  e.currentRevisionNumber,
    returnComment:   (e.status === 'RETURNED' && lastHistory?.comment) ? lastHistory.comment : null,
    returnedBy:      (e.status === 'RETURNED' && lastHistory?.performedBy) ? lastHistory.performedBy : null,
    createdAt:       e.createdAt,
    updatedAt:       e.updatedAt,
  };
}
