export function isIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validationError(message) {
  return Object.assign(new Error(message), { status: 400, code: 'VALIDATION_ERROR' });
}

export function assertTimeEntryPayload(payload, { partial = false } = {}) {
  const required = ['projectId', 'workDate', 'durationMinutes', 'description'];
  for (const field of required) {
    if (!partial && payload[field] === undefined) throw validationError(`${field} is required.`);
  }
  if (payload.projectId !== undefined && (typeof payload.projectId !== 'string' || !payload.projectId.trim())) {
    throw validationError('projectId must be a non-empty string.');
  }
  if (payload.workDate !== undefined && !isIsoDate(payload.workDate)) {
    throw validationError('workDate must use YYYY-MM-DD format.');
  }
  if (payload.durationMinutes !== undefined && (!Number.isInteger(payload.durationMinutes) || payload.durationMinutes <= 0)) {
    throw validationError('durationMinutes must be a positive integer.');
  }
  if (payload.description !== undefined && typeof payload.description !== 'string') {
    throw validationError('description must be a string.');
  }
}

export function assertHistoryQuery(query) {
  const page = query.page === undefined ? 1 : Number(query.page);
  const pageSize = query.pageSize === undefined ? 10 : Number(query.pageSize);
  if (!Number.isInteger(page) || page < 1) throw validationError('page must be a positive integer.');
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw validationError('pageSize must be an integer between 1 and 100.');
  }
  if (query.status && !['DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED'].includes(query.status)) {
    throw validationError('status is invalid.');
  }
  if (query.sortBy && !['workDate', 'project', 'durationMinutes', 'description', 'status'].includes(query.sortBy)) {
    throw validationError('sortBy is invalid.');
  }
  if (query.sortOrder && !['asc', 'desc'].includes(query.sortOrder)) {
    throw validationError('sortOrder must be asc or desc.');
  }
}
