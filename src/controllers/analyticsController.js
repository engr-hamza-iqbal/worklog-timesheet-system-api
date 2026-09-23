import { getAnalytics } from '../services/analyticsService.js';
import { sendSuccess, sendError } from '../utils/response.js';

export async function handleGetAnalytics(req, res) {
  try { return sendSuccess(res, await getAnalytics(req.query), 'Analytics retrieved.'); }
  catch (error) { return sendError(res, error.message, error.status || 500); }
}
