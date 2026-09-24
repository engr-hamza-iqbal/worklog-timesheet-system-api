import prisma from '../config/db.js';
import { checkUserCapability, getUserActiveCapabilities } from './accessService.js';
import {
  buildTimeOffDecidedEmail,
  buildTimeOffReviewRequiredEmail,
  queueEmail,
} from './emailService.js';

function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}

function dateOnly(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) fail('Date must be valid.');
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

function daysBetween(start, end) {
  const days = [];
  for (let date = new Date(start); date <= end; date.setUTCDate(date.getUTCDate() + 1)) {
    days.push(new Date(date));
  }
  return days;
}

function formatRequest(request) {
  return {
    id: request.id,
    userId: request.userId,
    user: request.user ? { id: request.user.id, name: request.user.name, email: request.user.email } : undefined,
    timeOffTypeId: request.timeOffTypeId,
    timeOffType: request.timeOffType,
    startDate: dateKey(request.startDate),
    endDate: dateKey(request.endDate),
    reason: request.reason,
    status: request.status,
    decisionComment: request.decisionComment,
    decidedAt: request.decidedAt,
    decidedBy: request.decidedBy ? { id: request.decidedBy.id, name: request.decidedBy.name } : undefined,
    createdAt: request.createdAt,
    days: request.days?.map((day) => ({ date: dateKey(day.date), status: day.status })) || [],
  };
}

const requestInclude = {
  user: { select: { id: true, name: true, email: true } },
  timeOffType: { select: { id: true, name: true, description: true } },
  decidedBy: { select: { id: true, name: true } },
  days: { orderBy: { date: 'asc' } },
};

export async function getTimeOffTypes(includeInactive = false) {
  return prisma.timeOffType.findMany({
    where: includeInactive ? {} : { isActive: true },
    orderBy: { name: 'asc' },
  });
}

export async function createTimeOffType({ name, description }) {
  if (!name?.trim()) fail('Time-off type name is required.');
  try {
    return await prisma.timeOffType.create({ data: { name: name.trim(), description: description?.trim() || null } });
  } catch (error) {
    if (error.code === 'P2002') fail('A time-off type with this name already exists.', 409);
    throw error;
  }
}

export async function updateTimeOffType(id, { name, description, isActive }) {
  const existing = await prisma.timeOffType.findUnique({ where: { id } });
  if (!existing) fail('Time-off type not found.', 404);
  return prisma.timeOffType.update({
    where: { id },
    data: {
      ...(name?.trim() ? { name: name.trim() } : {}),
      ...(description !== undefined ? { description: description?.trim() || null } : {}),
      ...(typeof isActive === 'boolean' ? { isActive } : {}),
    },
  });
}

export async function getTimeOffRequests(actorUser, { userId, status, startDate, endDate } = {}) {
  let targetUserId = userId || (actorUser.accountType === 'ADMIN' ? null : actorUser.id);
  let allowedUserIds = null;
  if (!userId && actorUser.accountType !== 'ADMIN') {
    const capabilities = await getUserActiveCapabilities(actorUser);
    const decideGrant = capabilities.DECIDE_TIME_OFF;
    if (decideGrant?.isGlobal) {
      targetUserId = null;
    } else {
      const allowed = new Set(decideGrant?.allowedUserIds || []);
      if (decideGrant?.allowedProjectIds?.length) {
        const assignments = await prisma.projectAssignment.findMany({
          where: {
            projectId: { in: decideGrant.allowedProjectIds },
            removedAt: null,
          },
          select: { userId: true },
        });
        for (const a of assignments) {
          allowed.add(a.userId);
        }
      }
      if (allowed.size > 0) {
        targetUserId = null;
        allowedUserIds = Array.from(allowed);
      }
    }
  }
  if (targetUserId && targetUserId !== actorUser.id && actorUser.accountType !== 'ADMIN') {
    const canView = await checkUserCapability(actorUser, 'VIEW_OTHER_RECORDS', { targetUserId });
    if (!canView) fail('You can only view your own time-off requests.', 403);
  }

  const where = {
    ...(targetUserId ? { userId: targetUserId } : {}),
    ...(allowedUserIds ? { userId: { in: allowedUserIds } } : {}),
    ...(status ? { status } : {}),
  };
  if (startDate || endDate) {
    where.days = { some: {
      ...(startDate ? { date: { gte: dateOnly(startDate) } } : {}),
      ...(endDate ? { date: { lte: dateOnly(endDate) } } : {}),
    } };
  }

  const requests = await prisma.timeOffRequest.findMany({ where, include: requestInclude, orderBy: { startDate: 'desc' } });
  return requests.map(formatRequest);
}

export async function createTimeOffRequest(actorUser, { timeOffTypeId, startDate, endDate, reason }) {
  if (!timeOffTypeId) fail('Time-off type is required.');
  if (!reason?.trim() || reason.trim().length < 5) fail('Reason must be at least 5 characters.');
  const start = dateOnly(startDate);
  const end = dateOnly(endDate);
  if (end < start) fail('End date cannot be earlier than start date.');

  const type = await prisma.timeOffType.findFirst({ where: { id: timeOffTypeId, isActive: true } });
  if (!type) fail('Active time-off type not found.', 404);

  const overlap = await prisma.timeOffRequest.findFirst({
    where: {
      userId: actorUser.id,
      status: { in: ['PENDING', 'APPROVED'] },
      startDate: { lte: end },
      endDate: { gte: start },
    },
  });
  if (overlap) fail('This request overlaps an existing pending or approved request.', 409);

  const request = await prisma.$transaction(async (tx) => {
    const created = await tx.timeOffRequest.create({
      data: {
        userId: actorUser.id,
        timeOffTypeId,
        startDate: start,
        endDate: end,
        reason: reason.trim(),
        days: { create: daysBetween(start, end).map((date) => ({ userId: actorUser.id, date, status: 'PENDING' })) },
      },
      include: requestInclude,
    });
    return created;
  });

  void notifyReviewersOfNewTimeOffRequest(actorUser, request);

  return formatRequest(request);
}

async function notifyReviewersOfNewTimeOffRequest(actorUser, request) {
  try {
    const admins = await prisma.user.findMany({
      where: { accountType: 'ADMIN', isActive: true, id: { not: actorUser.id } },
      select: { id: true, name: true, email: true },
    });

    const potentialReviewers = await prisma.user.findMany({
      where: { accountType: 'EMPLOYEE', isActive: true, id: { not: actorUser.id } },
      select: { id: true, name: true, email: true },
    });

    const reviewersToNotify = [...admins];
    for (const employee of potentialReviewers) {
      const canDecide = await checkUserCapability(employee, 'DECIDE_TIME_OFF', { targetUserId: actorUser.id });
      if (canDecide) {
        reviewersToNotify.push(employee);
      }
    }

    const emailContent = buildTimeOffReviewRequiredEmail({
      employeeName: actorUser.name,
      timeOffTypeName: request.timeOffType.name,
      startDate: dateKey(request.startDate),
      endDate: dateKey(request.endDate),
      reason: request.reason,
    });

    for (const reviewer of reviewersToNotify) {
      queueEmail({
        recipientUserId: reviewer.id,
        recipientEmail: reviewer.email,
        emailType: 'TIME_OFF_REVIEW_REQUIRED',
        subject: emailContent.subject,
        relatedEntityType: 'TimeOffRequest',
        relatedEntityId: request.id,
        html: emailContent.html,
      });
    }
  } catch (err) {
    console.error('Failed to notify reviewers of time-off request:', err.message);
  }
}

export async function cancelTimeOffRequest(actorUser, requestId) {
  const request = await prisma.timeOffRequest.findUnique({
    where: { id: requestId },
    include: { user: { select: { id: true, name: true, email: true } }, timeOffType: { select: { name: true } } },
  });
  if (!request) fail('Time-off request not found.', 404);
  if (request.userId !== actorUser.id) fail('You can only cancel your own request.', 403);
  if (request.status !== 'PENDING') fail('Only pending requests can be cancelled.');

  await prisma.$transaction([
    prisma.timeOffRequest.update({ where: { id: requestId }, data: { status: 'CANCELLED' } }),
    prisma.timeOffDay.updateMany({ where: { timeOffRequestId: requestId }, data: { status: 'CANCELLED' } }),
  ]);
  return { id: requestId, status: 'CANCELLED' };
}

async function assertCanDecide(actorUser, request) {
  if (request.userId === actorUser.id) fail('You cannot decide your own time-off request.', 403);
  if (actorUser.accountType !== 'ADMIN') {
    const allowed = await checkUserCapability(actorUser, 'DECIDE_TIME_OFF', { targetUserId: request.userId });
    if (!allowed) fail('You are outside the scope of this time-off request.', 403);
  }
}

export async function decideTimeOffRequest(actorUser, requestId, decision, comment) {
  if (!['APPROVED', 'DECLINED'].includes(decision)) fail('Decision must be APPROVED or DECLINED.');
  if (decision === 'DECLINED' && (!comment?.trim() || comment.trim().length < 5)) fail('A decline comment of at least 5 characters is required.');
  const request = await prisma.timeOffRequest.findUnique({
    where: { id: requestId },
    include: {
      user: { select: { id: true, name: true, email: true } },
      timeOffType: { select: { name: true } },
    },
  });
  if (!request) fail('Time-off request not found.', 404);
  if (request.status !== 'PENDING') fail('Only pending requests can be decided.');
  await assertCanDecide(actorUser, request);

  await prisma.$transaction([
    prisma.timeOffRequest.update({ where: { id: requestId }, data: { status: decision, decisionComment: comment?.trim() || null, decidedById: actorUser.id, decidedAt: new Date() } }),
    prisma.timeOffDay.updateMany({ where: { timeOffRequestId: requestId }, data: { status: decision } }),
  ]);

  const emailContent = buildTimeOffDecidedEmail({
    recipientName: request.user.name,
    timeOffTypeName: request.timeOffType.name,
    startDate: dateKey(request.startDate),
    endDate: dateKey(request.endDate),
    decision,
    comment: comment?.trim() || null,
  });

  queueEmail({
    recipientUserId: request.user.id,
    recipientEmail: request.user.email,
    emailType: 'TIME_OFF_DECIDED',
    subject: emailContent.subject,
    relatedEntityType: 'TimeOffRequest',
    relatedEntityId: request.id,
    html: emailContent.html,
  });
  return { id: requestId, status: decision };
}
