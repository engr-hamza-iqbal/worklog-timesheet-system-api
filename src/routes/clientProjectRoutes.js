import express from 'express';
import {
  handleGetClients,
  handleCreateClient,
  handleUpdateClient,
  handleGetProjects,
  handleCreateProject,
  handleUpdateProjectStatus,
  handleAddProjectRate,
} from '../controllers/clientProjectController.js';
import { authenticate } from '../middleware/auth.js';
import { requireCapability } from '../middleware/permission.js';

const router = express.Router();

router.use(authenticate);

// Clients
router.get('/clients', handleGetClients);
router.post('/clients', requireCapability('MANAGE_CLIENTS_PROJECTS'), handleCreateClient);
router.put('/clients/:id', requireCapability('MANAGE_CLIENTS_PROJECTS'), handleUpdateClient);

// Projects
router.get('/projects', handleGetProjects);
router.post('/projects', requireCapability('MANAGE_CLIENTS_PROJECTS'), handleCreateProject);
router.patch('/projects/:id/status', requireCapability('MANAGE_CLIENTS_PROJECTS'), handleUpdateProjectStatus);
router.post('/projects/:id/rates', requireCapability('MANAGE_CLIENTS_PROJECTS'), handleAddProjectRate);

export default router;
