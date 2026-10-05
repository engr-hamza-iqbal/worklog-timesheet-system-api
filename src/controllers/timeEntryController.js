import {
  createTimeEntry,
  updateTimeEntry,
  deleteTimeEntry,
  getTimeEntriesForPeriod,
  getTimeEntryHistory,
  submitEntries,
} from '../services/timeEntryService.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { assertHistoryQuery, assertTimeEntryPayload, isIsoDate, validationError } from '../utils/validation.js';

// ─── GET /api/timesheets?userId=&startDate=&endDate= ──────────────────────────
export async function handleGetTimeEntries(req, res) {
  try {
    const actorUser  = req.user;
    const targetUserId = req.query.userId || actorUser.id;
    const { startDate, endDate } = req.query;

    if (!isIsoDate(startDate) || !isIsoDate(endDate)) throw validationError('startDate and endDate must use YYYY-MM-DD format.');
    if (endDate < startDate) throw validationError('endDate cannot be earlier than startDate.');

    const data = await getTimeEntriesForPeriod(actorUser, targetUserId, startDate, endDate);
    return sendSuccess(res, data, 'Time entries retrieved.');
  } catch (err) {
    return sendError(res, err.message, err.status || 500, err.code || 'BAD_REQUEST');
  }
}

export async function handleGetTimeEntryHistory(req, res) {
  try {
    assertHistoryQuery(req.query);
    const data = await getTimeEntryHistory(req.user, req.query);
    return sendSuccess(res, data, 'Time-entry history retrieved.');
  } catch (err) {
    return sendError(res, err.message, err.status || 500, err.code || 'BAD_REQUEST');
  }
}

// ─── POST /api/timesheets ─────────────────────────────────────────────────────
export async function handleCreateTimeEntry(req, res) {
  try {
    assertTimeEntryPayload(req.body || {});
    const { projectId, workDate, durationMinutes, description } = req.body || {};
    const entry = await createTimeEntry(req.user, { projectId, workDate, durationMinutes, description });
    return sendSuccess(res, entry, 'Time entry created.', 201);
  } catch (err) {
    return sendError(res, err.message, err.status || 500);
  }
}

// ─── PUT /api/timesheets/:id ──────────────────────────────────────────────────
export async function handleUpdateTimeEntry(req, res) {
  try {
    assertTimeEntryPayload(req.body || {}, { partial: true });
    const { projectId, workDate, durationMinutes, description } = req.body || {};
    const entry = await updateTimeEntry(req.user, req.params.id, { projectId, workDate, durationMinutes, description });
    return sendSuccess(res, entry, 'Time entry updated.');
  } catch (err) {
    return sendError(res, err.message, err.status || 500);
  }
}

// ─── DELETE /api/timesheets/:id ───────────────────────────────────────────────
export async function handleDeleteTimeEntry(req, res) {
  try {
    await deleteTimeEntry(req.user, req.params.id);
    return sendSuccess(res, null, 'Time entry deleted.');
  } catch (err) {
    return sendError(res, err.message, err.status || 500);
  }
}

// ─── POST /api/timesheets/submit ──────────────────────────────────────────────
export async function handleSubmitEntries(req, res) {
  try {
    const { entryIds } = req.body || {};
    if (!Array.isArray(entryIds) || entryIds.length === 0 || entryIds.some((id) => typeof id !== 'string' || !id.trim())) {
      throw validationError('entryIds must be a non-empty array of strings.');
    }
    if (new Set(entryIds).size !== entryIds.length) throw validationError('entryIds must not contain duplicates.');
    const result = await submitEntries(req.user, entryIds);
    return sendSuccess(res, result, `${result.submittedCount} entr${result.submittedCount === 1 ? 'y' : 'ies'} submitted for review.`);
  } catch (err) {
    return sendError(res, err.message, err.status || 500);
  }
}
