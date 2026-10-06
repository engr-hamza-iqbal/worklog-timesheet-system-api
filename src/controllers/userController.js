import userService from '../services/userService.js';
import { sendSuccess } from '../utils/response.js';

export async function handleGetUsers(req, res, next) {
  try {
    const users = await userService.getUsers(req.user);
    return sendSuccess(res, users, 'Users retrieved successfully.');
  } catch (err) {
    next(err);
  }
}

export async function handleCreateUser(req, res, next) {
  try {
    const { name, email, password, accountType } = req.body;
    const user = await userService.createUser({ name, email, password, accountType, actorUser: req.user });
    return sendSuccess(res, user, 'User created successfully.', 201);
  } catch (err) {
    next(err);
  }
}

export async function handleUpdateUserStatus(req, res, next) {
  try {
    const { id } = req.params;
    const { isActive } = req.body;
    const user = await userService.updateUserStatus(id, { isActive }, req.user.id);
    return sendSuccess(res, user, `User ${isActive ? 'activated' : 'deactivated'} successfully.`);
  } catch (err) {
    next(err);
  }
}

export async function handleUpdateUser(req, res, next) {
  try {
    const { id } = req.params;
    const { name, email, accountType } = req.body;
    const user = await userService.updateUser(id, { name, email, accountType }, req.user);
    return sendSuccess(res, user, 'User updated successfully.');
  } catch (err) {
    next(err);
  }
}

export async function handleAssignProject(req, res, next) {
  try {
    const { id: projectId } = req.params;
    const { userId, userIds } = req.body;
    if (Array.isArray(userIds) && userIds.length > 0) {
      const assignments = await userService.assignUsersToProject(projectId, userIds, req.user);
      return sendSuccess(res, assignments, 'Employees assigned to project successfully.', 201);
    }
    const assignment = await userService.assignUserToProject(projectId, userId, req.user);
    return sendSuccess(res, assignment, 'Employee assigned to project successfully.', 201);
  } catch (err) {
    next(err);
  }
}

export async function handleAssignProjectsToUser(req, res, next) {
  try {
    const { id: userId } = req.params;
    const { projectId, projectIds } = req.body;
    const pIds = Array.isArray(projectIds) ? projectIds : [projectId];
    const assignments = await userService.assignUserToProjects(userId, pIds, req.user);
    return sendSuccess(res, assignments, 'Projects assigned to employee successfully.', 201);
  } catch (err) {
    next(err);
  }
}

export async function handleRemoveAssignment(req, res, next) {
  try {
    const { id: projectId, userId } = req.params;
    const result = await userService.removeUserFromProject(projectId, userId, req.user);
    return sendSuccess(res, result, 'Employee assignment removed successfully.');
  } catch (err) {
    next(err);
  }
}

export default {
  handleGetUsers,
  handleCreateUser,
  handleUpdateUser,
  handleUpdateUserStatus,
  handleAssignProject,
  handleAssignProjectsToUser,
  handleRemoveAssignment,
};
