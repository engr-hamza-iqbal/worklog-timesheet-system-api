import express from 'express';
import { authenticate } from '../middleware/auth.js';
import {
  handleGetTimeEntries,
  handleCreateTimeEntry,
  handleUpdateTimeEntry,
  handleDeleteTimeEntry,
  handleSubmitEntries,
} from '../controllers/timeEntryController.js';

const router = express.Router();

// All timesheet routes require authentication
router.use(authenticate);

// GET  /api/timesheets?startDate=&endDate=&userId=  — view entries for a period
router.get('/',        handleGetTimeEntries);

// POST /api/timesheets                              — create a new DRAFT entry
router.post('/',       handleCreateTimeEntry);

// PUT  /api/timesheets/:id                          — edit a DRAFT or RETURNED entry
router.put('/:id',    handleUpdateTimeEntry);

// DELETE /api/timesheets/:id                        — delete a DRAFT or RETURNED entry
router.delete('/:id', handleDeleteTimeEntry);

// POST /api/timesheets/submit                       — batch submit DRAFT/RETURNED → SUBMITTED
// NOTE: must be registered BEFORE /:id to avoid "submit" being treated as an ID param
router.post('/submit', handleSubmitEntries);

export default router;
