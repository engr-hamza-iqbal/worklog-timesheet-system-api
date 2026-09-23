import prisma from '../config/db.js';

/**
 * List all clients with optional active status filtering
 */
export async function getClients(activeOnly = false) {
  const where = activeOnly ? { isActive: true } : {};
  return prisma.client.findMany({
    where,
    include: {
      _count: {
        select: { projects: true },
      },
    },
    orderBy: { name: 'asc' },
  });
}

/**
 * Create a new client
 */
export async function createClient({ name }) {
  if (!name || !name.trim()) {
    const error = new Error('Client name is required.');
    error.statusCode = 400;
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  const existing = await prisma.client.findUnique({
    where: { name: name.trim() },
  });

  if (existing) {
    const error = new Error(`A client named "${name.trim()}" already exists.`);
    error.statusCode = 409;
    error.code = 'CLIENT_ALREADY_EXISTS';
    throw error;
  }

  return prisma.client.create({
    data: {
      name: name.trim(),
      isActive: true,
    },
  });
}

/**
 * Update an existing client (name, isActive)
 */
export async function updateClient(id, { name, isActive }) {
  const client = await prisma.client.findUnique({ where: { id } });
  if (!client) {
    const error = new Error('Client not found.');
    error.statusCode = 404;
    error.code = 'NOT_FOUND';
    throw error;
  }

  const data = {};
  if (name && name.trim()) {
    data.name = name.trim();
  }
  if (typeof isActive === 'boolean') {
    data.isActive = isActive;
  }

  return prisma.client.update({
    where: { id },
    data,
  });
}

/**
 * List projects, optionally filtered by clientId or activeOnly
 */
export async function getProjects({ clientId, activeOnly = false, assignedUserId } = {}) {
  const where = {};
  if (clientId) where.clientId = clientId;
  if (activeOnly) {
    where.status = 'ACTIVE';
    where.client = { isActive: true };
  }
  if (assignedUserId) {
    where.assignments = { some: { userId: assignedUserId, removedAt: null } };
  }

  const projects = await prisma.project.findMany(assignedUserId ? {
    where,
    select: {
      id: true,
      name: true,
      clientId: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      client: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
  } : {
    where,
    include: {
      client: {
        select: { id: true, name: true, isActive: true },
      },
      rates: {
        orderBy: { effectiveFrom: 'desc' },
        take: 1,
      },
      assignments: {
        where: { removedAt: null },
        include: {
          user: {
            select: { id: true, name: true, email: true },
          },
        },
      },
      _count: {
        select: { timeEntries: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return projects.map((p) => ({
    id: p.id,
    name: p.name,
    clientId: p.clientId,
    clientName: p.client.name,
    status: p.status,
    currentRate: p.rates?.[0] ? Number(p.rates[0].ratePerHour) : null,
    assignedEmployees: p.assignments?.map((a) => a.user) || [],
    totalTimeEntries: p._count?.timeEntries || 0,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  }));
}

/**
 * Create a new project under a client with optional initial billing rate
 */
export async function createProject({ clientId, name, initialRatePerHour }) {
  if (!clientId || !name || !name.trim()) {
    const error = new Error('Both Client and Project name are required.');
    error.statusCode = 400;
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) {
    const error = new Error('Client not found.');
    error.statusCode = 404;
    error.code = 'CLIENT_NOT_FOUND';
    throw error;
  }

  const existing = await prisma.project.findUnique({
    where: {
      clientId_name: {
        clientId,
        name: name.trim(),
      },
    },
  });

  if (existing) {
    const error = new Error(`Project "${name.trim()}" already exists for this client.`);
    error.statusCode = 409;
    error.code = 'PROJECT_ALREADY_EXISTS';
    throw error;
  }

  return prisma.$transaction(async (tx) => {
    const project = await tx.project.create({
      data: {
        clientId,
        name: name.trim(),
        status: 'ACTIVE',
      },
    });

    if (initialRatePerHour !== undefined && initialRatePerHour !== null && initialRatePerHour !== '') {
      const rateNum = Number(initialRatePerHour);
      if (isNaN(rateNum) || rateNum < 0) {
        const error = new Error('Billing rate must be a positive number.');
        error.statusCode = 400;
        error.code = 'VALIDATION_ERROR';
        throw error;
      }

      await tx.projectRate.create({
        data: {
          projectId: project.id,
          ratePerHour: rateNum,
          effectiveFrom: new Date(),
        },
      });
    }

    return project;
  });
}

/**
 * Update project details (e.g. rename)
 */
export async function updateProject(id, { name }) {
  const project = await prisma.project.findUnique({ where: { id } });
  if (!project) {
    const error = new Error('Project not found.');
    error.statusCode = 404;
    error.code = 'PROJECT_NOT_FOUND';
    throw error;
  }

  const data = {};
  if (name && name.trim()) {
    const trimmed = name.trim();
    if (trimmed !== project.name) {
      const existing = await prisma.project.findUnique({
        where: {
          clientId_name: {
            clientId: project.clientId,
            name: trimmed,
          },
        },
      });
      if (existing) {
        const error = new Error(`Project "${trimmed}" already exists for this client.`);
        error.statusCode = 409;
        error.code = 'PROJECT_ALREADY_EXISTS';
        throw error;
      }
      data.name = trimmed;
    }
  }

  return prisma.project.update({
    where: { id },
    data,
  });
}

/**
 * Toggle or update project status (ACTIVE or CLOSED)
 */
export async function updateProjectStatus(id, { status }) {
  if (!['ACTIVE', 'CLOSED'].includes(status)) {
    const error = new Error('Status must be either ACTIVE or CLOSED.');
    error.statusCode = 400;
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  const project = await prisma.project.findUnique({ where: { id } });
  if (!project) {
    const error = new Error('Project not found.');
    error.statusCode = 404;
    error.code = 'PROJECT_NOT_FOUND';
    throw error;
  }

  return prisma.project.update({
    where: { id },
    data: { status },
  });
}

/**
 * Add a new billing rate to a project, updating previous rate's effectiveTo date
 */
export async function addProjectRate(projectId, { ratePerHour, effectiveFrom }) {
  const rateNum = Number(ratePerHour);
  if (isNaN(rateNum) || rateNum <= 0) {
    const error = new Error('Rate per hour must be a positive number.');
    error.statusCode = 400;
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    const error = new Error('Project not found.');
    error.statusCode = 404;
    error.code = 'PROJECT_NOT_FOUND';
    throw error;
  }

  if (project.status === 'CLOSED') {
    const error = new Error('Cannot add a billing rate to a closed project.');
    error.statusCode = 400;
    error.code = 'PROJECT_CLOSED';
    throw error;
  }

  const effectiveDate = effectiveFrom ? new Date(effectiveFrom) : new Date();

  return prisma.$transaction(async (tx) => {
    // Close the previous active rate if exists
    await tx.projectRate.updateMany({
      where: {
        projectId,
        effectiveTo: null,
      },
      data: {
        effectiveTo: effectiveDate,
      },
    });

    // Create the new rate record
    return tx.projectRate.create({
      data: {
        projectId,
        ratePerHour: rateNum,
        effectiveFrom: effectiveDate,
      },
    });
  });
}

export default {
  getClients,
  createClient,
  updateClient,
  getProjects,
  createProject,
  updateProject,
  updateProjectStatus,
  addProjectRate,
};
