import express from 'express';
import {
  handleGetClients,
  handleCreateClient,
  handleUpdateClient,
  handleGetProjects,
  handleCreateProject,
  handleUpdateProject,
  handleUpdateProjectStatus,
  handleAddProjectRate,
} from '../controllers/clientProjectController.js';
import { authenticate } from '../middleware/auth.js';
import { requireCapability } from '../middleware/permission.js';

const router = express.Router();

router.use(['/clients', '/projects'], authenticate);

// Clients
router.get('/clients', handleGetClients);
router.post('/clients', requireCapability('MANAGE_CLIENTS_PROJECTS'), handleCreateClient);
router.put('/clients/:id', requireCapability('MANAGE_CLIENTS_PROJECTS', (req) => ({ targetClientId: req.params.id })), handleUpdateClient);

// Projects
router.get('/projects', handleGetProjects);
router.post('/projects', requireCapability('MANAGE_CLIENTS_PROJECTS', (req) => ({ targetClientId: req.body?.clientId })), handleCreateProject);
router.put('/projects/:id', requireCapability('MANAGE_CLIENTS_PROJECTS', (req) => ({ targetProjectId: req.params.id })), handleUpdateProject);
router.patch('/projects/:id/status', requireCapability('MANAGE_CLIENTS_PROJECTS', (req) => ({ targetProjectId: req.params.id })), handleUpdateProjectStatus);
router.post('/projects/:id/rates', requireCapability('MANAGE_CLIENTS_PROJECTS', (req) => ({ targetProjectId: req.params.id })), handleAddProjectRate);

export default router;
