import {
  getReviewQueue,
  approveEntries,
  returnEntry,
  reopenEntry,
} from '../services/reviewService.js';
import { sendSuccess, sendError } from '../utils/response.js';

// ─── GET /api/reviews ─────────────────────────────────────────────────────────
export async function handleGetReviewQueue(req, res) {
  try {
    const { userId, projectId, userQuery, projectQuery, startDate, endDate } = req.query;
    const data = await getReviewQueue(req.user, { userId, projectId, userQuery, projectQuery, startDate, endDate });
    return sendSuccess(res, data, 'Review queue retrieved.');
  } catch (err) {
    return sendError(res, err.message, err.status || 500);
  }
}

// ─── POST /api/reviews/approve ────────────────────────────────────────────────
export async function handleApproveEntries(req, res) {
  try {
    const { entryIds } = req.body;
    if (!Array.isArray(entryIds) || entryIds.length === 0) {
      return sendError(res, 'entryIds array is required.', 400);
    }
    const result = await approveEntries(req.user, entryIds);
    return sendSuccess(res, result, `${result.approvedCount} entr${result.approvedCount === 1 ? 'y' : 'ies'} approved.`);
  } catch (err) {
    return sendError(res, err.message, err.status || 500);
  }
}

// ─── POST /api/reviews/return ─────────────────────────────────────────────────
export async function handleReturnEntry(req, res) {
  try {
    const { entryId, comment } = req.body;
    if (!entryId) return sendError(res, 'entryId is required.', 400);
    const result = await returnEntry(req.user, entryId, comment);
    return sendSuccess(res, result, 'Entry returned for correction.');
  } catch (err) {
    return sendError(res, err.message, err.status || 500);
  }
}

// ─── POST /api/reviews/reopen ─────────────────────────────────────────────────
export async function handleReopenEntry(req, res) {
  try {
    const { entryId, reason } = req.body;
    if (!entryId) return sendError(res, 'entryId is required.', 400);
    const result = await reopenEntry(req.user, entryId, reason);
    return sendSuccess(res, result, 'Entry reopened for editing.');
  } catch (err) {
    return sendError(res, err.message, err.status || 500);
  }
}
