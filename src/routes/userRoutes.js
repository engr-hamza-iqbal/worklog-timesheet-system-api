import express from 'express';
import {
  handleGetUsers,
  handleCreateUser,
  handleUpdateUser,
  handleUpdateUserStatus,
  handleAssignProject,
  handleAssignProjectsToUser,
  handleRemoveAssignment,
} from '../controllers/userController.js';
import { authenticate } from '../middleware/auth.js';
import { requireCapability } from '../middleware/permission.js';

const router = express.Router();

router.use(authenticate);

// User Management
router.get('/users', handleGetUsers);
router.post('/users', requireCapability('MANAGE_USERS'), handleCreateUser);
router.put('/users/:id', requireCapability('MANAGE_USERS', (req) => ({ targetUserId: req.params.id })), handleUpdateUser);
router.patch('/users/:id/status', requireCapability('MANAGE_USERS', (req) => ({ targetUserId: req.params.id })), handleUpdateUserStatus);

// Project Assignments
router.post(
  '/projects/:id/assignments',
  requireCapability('ASSIGN_PROJECTS', (req) => ({
    targetProjectId: req.params.id,
    targetUserId: req.body?.userId,
    targetUserIds: req.body?.userIds,
  })),
  handleAssignProject
);
router.post(
  '/users/:id/assignments',
  requireCapability('ASSIGN_PROJECTS', (req) => ({
    targetUserId: req.params.id,
    targetProjectId: req.body?.projectId,
    targetProjectIds: req.body?.projectIds,
  })),
  handleAssignProjectsToUser
);
router.delete(
  '/projects/:id/assignments/:userId',
  requireCapability('ASSIGN_PROJECTS', (req) => ({
    targetProjectId: req.params.id,
    targetUserId: req.params.userId,
  })),
  handleRemoveAssignment
);

export default router;
