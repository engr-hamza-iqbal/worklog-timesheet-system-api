import clientProjectService from '../services/clientProjectService.js';
import { sendSuccess } from '../utils/response.js';

export async function handleGetClients(req, res, next) {
  try {
    const activeOnly = req.query.activeOnly === 'true';
    const clients = await clientProjectService.getClients(activeOnly);
    return sendSuccess(res, clients, 'Clients retrieved successfully.');
  } catch (err) {
    next(err);
  }
}

export async function handleCreateClient(req, res, next) {
  try {
    const { name } = req.body;
    const client = await clientProjectService.createClient({ name });
    return sendSuccess(res, client, 'Client created successfully.', 201);
  } catch (err) {
    next(err);
  }
}

export async function handleUpdateClient(req, res, next) {
  try {
    const { id } = req.params;
    const { name, isActive } = req.body;
    const client = await clientProjectService.updateClient(id, { name, isActive });
    return sendSuccess(res, client, 'Client updated successfully.');
  } catch (err) {
    next(err);
  }
}

export async function handleGetProjects(req, res, next) {
  try {
    const { clientId, activeOnly } = req.query;
    const projects = await clientProjectService.getProjects({
      clientId,
      activeOnly: activeOnly === 'true',
    });
    return sendSuccess(res, projects, 'Projects retrieved successfully.');
  } catch (err) {
    next(err);
  }
}

export async function handleCreateProject(req, res, next) {
  try {
    const { clientId, name, initialRatePerHour } = req.body;
    const project = await clientProjectService.createProject({
      clientId,
      name,
      initialRatePerHour,
    });
    return sendSuccess(res, project, 'Project created successfully.', 201);
  } catch (err) {
    next(err);
  }
}

export async function handleUpdateProjectStatus(req, res, next) {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const project = await clientProjectService.updateProjectStatus(id, { status });
    return sendSuccess(res, project, `Project status updated to ${status}.`);
  } catch (err) {
    next(err);
  }
}

export async function handleAddProjectRate(req, res, next) {
  try {
    const { id } = req.params;
    const { ratePerHour, effectiveFrom } = req.body;
    const rate = await clientProjectService.addProjectRate(id, { ratePerHour, effectiveFrom });
    return sendSuccess(res, rate, 'Project billing rate added successfully.', 201);
  } catch (err) {
    next(err);
  }
}

export default {
  handleGetClients,
  handleCreateClient,
  handleUpdateClient,
  handleGetProjects,
  handleCreateProject,
  handleUpdateProjectStatus,
  handleAddProjectRate,
};
