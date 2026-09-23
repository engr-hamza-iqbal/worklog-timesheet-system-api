import {
  getTimeOffTypes,
  createTimeOffType,
  updateTimeOffType,
  getTimeOffRequests,
  createTimeOffRequest,
  cancelTimeOffRequest,
  decideTimeOffRequest,
} from '../services/timeOffService.js';
import { sendSuccess, sendError } from '../utils/response.js';

function handleError(res, error) {
  return sendError(res, error.message, error.status || 500);
}

export async function handleGetTypes(req, res) {
  try { return sendSuccess(res, await getTimeOffTypes(req.user.accountType === 'ADMIN')); } catch (error) { return handleError(res, error); }
}

export async function handleCreateType(req, res) {
  try { return sendSuccess(res, await createTimeOffType(req.body), 'Time-off type created.', 201); } catch (error) { return handleError(res, error); }
}

export async function handleUpdateType(req, res) {
  try { return sendSuccess(res, await updateTimeOffType(req.params.id, req.body), 'Time-off type updated.'); } catch (error) { return handleError(res, error); }
}

export async function handleGetRequests(req, res) {
  try {
    const { userId, status, startDate, endDate } = req.query;
    return sendSuccess(res, await getTimeOffRequests(req.user, { userId, status, startDate, endDate }));
  } catch (error) { return handleError(res, error); }
}

export async function handleCreateRequest(req, res) {
  try { return sendSuccess(res, await createTimeOffRequest(req.user, req.body), 'Time-off request submitted.', 201); } catch (error) { return handleError(res, error); }
}

export async function handleCancelRequest(req, res) {
  try { return sendSuccess(res, await cancelTimeOffRequest(req.user, req.params.id), 'Time-off request cancelled.'); } catch (error) { return handleError(res, error); }
}

export async function handleDecideRequest(req, res) {
  try {
    const { decision, comment } = req.body;
    return sendSuccess(res, await decideTimeOffRequest(req.user, req.params.id, decision, comment), 'Time-off request decided.');
  } catch (error) { return handleError(res, error); }
}
