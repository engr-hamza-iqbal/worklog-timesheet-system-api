import express from 'express';
import {
  handleGetUsers,
  handleCreateUser,
  handleUpdateUser,
  handleUpdateUserStatus,
  handleAssignProject,
  handleRemoveAssignment,
} from '../controllers/userController.js';
import { authenticate } from '../middleware/auth.js';
import { requireCapability } from '../middleware/permission.js';

const router = express.Router();

router.use(authenticate);

// User Management
router.get('/users', handleGetUsers);
router.post('/users', requireCapability('MANAGE_USERS'), handleCreateUser);
router.put('/users/:id', requireCapability('MANAGE_USERS'), handleUpdateUser);
router.patch('/users/:id/status', requireCapability('MANAGE_USERS'), handleUpdateUserStatus);

// Project Assignments
router.post('/projects/:id/assignments', requireCapability('ASSIGN_PROJECTS'), handleAssignProject);
router.delete('/projects/:id/assignments/:userId', requireCapability('ASSIGN_PROJECTS'), handleRemoveAssignment);

export default router;
