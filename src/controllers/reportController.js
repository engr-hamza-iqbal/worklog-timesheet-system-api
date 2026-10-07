import {
  getReports,
  getMissingTimesheets,
  chaseMissingTimesheets,
  getWhoIsAway,
  getReviewQueueByReviewer,
  getEmployeeTimeTrend,
  getEmployeeProjectBreakdown,
} from '../services/reportService.js';
import { sendSuccess, sendError } from '../utils/response.js';

export async function handleGetReports(req, res) {
  try {
    return sendSuccess(res, await getReports(req.query, req.user), 'Reports retrieved.');
  } catch (error) {
    return sendError(res, error.message, error.status || 500);
  }
}

export async function handleGetMissingTimesheets(req, res) {
  try {
    const data = await getMissingTimesheets(req.query.date, req.user);
    return sendSuccess(res, data, 'Missing timesheets retrieved.');
  } catch (error) {
    return sendError(res, error.message, error.status || 500);
  }
}

export async function handleChaseMissingTimesheets(req, res) {
  try {
    const data = await chaseMissingTimesheets({
      date: req.body.date,
      userIds: req.body.userIds,
      actorUser: req.user,
    });
    return sendSuccess(res, data, 'Missing timesheet chase reminders dispatched.');
  } catch (error) {
    return sendError(res, error.message, error.status || 500);
  }
}

export async function handleGetWhoIsAway(req, res) {
  try {
    const data = await getWhoIsAway(req.query.date, req.user);
    return sendSuccess(res, data, 'Who is away report retrieved.');
  } catch (error) {
    return sendError(res, error.message, error.status || 500);
  }
}

export async function handleGetReviewQueueByReviewer(req, res) {
  try {
    const data = await getReviewQueueByReviewer(req.user);
    return sendSuccess(res, data, 'Review queue grouped by reviewer retrieved.');
  } catch (error) {
    return sendError(res, error.message, error.status || 500);
  }
}

export async function handleGetEmployeeTimeTrend(req, res) {
  try {
    const data = await getEmployeeTimeTrend(req.query, req.user);
    return sendSuccess(res, data, 'Employee time trend report retrieved.');
  } catch (error) {
    return sendError(res, error.message, error.status || 500);
  }
}

export async function handleGetEmployeeProjectBreakdown(req, res) {
  try {
    const data = await getEmployeeProjectBreakdown(req.query, req.user);
    return sendSuccess(res, data, 'Employee project breakdown report retrieved.');
  } catch (error) {
    return sendError(res, error.message, error.status || 500);
  }
}

