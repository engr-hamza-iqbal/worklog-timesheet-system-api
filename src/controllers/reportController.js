import {
  getReports,
  getMissingTimesheets,
  chaseMissingTimesheets,
} from '../services/reportService.js';
import { sendSuccess, sendError } from '../utils/response.js';

export async function handleGetReports(req, res) {
  try {
    return sendSuccess(res, await getReports(req.query), 'Reports retrieved.');
  } catch (error) {
    return sendError(res, error.message, error.status || 500);
  }
}

export async function handleGetMissingTimesheets(req, res) {
  try {
    const data = await getMissingTimesheets(req.query.date);
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
