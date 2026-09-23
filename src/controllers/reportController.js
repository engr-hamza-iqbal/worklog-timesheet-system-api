import { getReports } from '../services/reportService.js';
import { sendSuccess, sendError } from '../utils/response.js';

export async function handleGetReports(req, res) {
  try {
    return sendSuccess(res, await getReports(req.query), 'Reports retrieved.');
  } catch (error) {
    return sendError(res, error.message, error.status || 500);
  }
}
