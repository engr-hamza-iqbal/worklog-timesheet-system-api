import accessService from '../services/accessService.js';
import { sendSuccess } from '../utils/response.js';

export async function handleGetCapabilities(req, res, next) {
  try {
    const capabilities = await accessService.getSystemCapabilities();
    return sendSuccess(res, capabilities, 'Capabilities retrieved successfully.');
  } catch (err) {
    next(err);
  }
}

export async function handleGetUserGrants(req, res, next) {
  try {
    const { userId } = req.params;
    const grants = await accessService.getUserGrants(userId);
    return sendSuccess(res, grants, 'User capability grants retrieved.');
  } catch (err) {
    next(err);
  }
}

export async function handleGrantCapability(req, res, next) {
  try {
    const {
      userId,
      userIds,
      capabilityCode,
      capabilityCodes,
      expiresAt,
      scopeType,
      targetUserIds,
      targetProjectIds,
    } = req.body;

    // Case 1: Grant 1 capability to multiple target users
    if (Array.isArray(userIds) && userIds.length > 0) {
      const grants = await accessService.grantCapabilityToUsers({
        actorId: req.user.id,
        targetUserIds: userIds,
        capabilityCode,
        expiresAt,
        scopeType,
        targetScopeUserIds: targetUserIds,
        targetProjectIds,
      });
      return sendSuccess(res, grants, 'Capability granted to selected users successfully.', 201);
    }

    // Case 2: Grant multiple capabilities to 1 user
    if (Array.isArray(capabilityCodes) && capabilityCodes.length > 0) {
      const grants = await accessService.grantCapabilitiesToUser({
        actorId: req.user.id,
        targetUserId: userId,
        capabilityCodes,
        expiresAt,
        scopeType,
        targetUserIds,
        targetProjectIds,
      });
      return sendSuccess(res, grants, 'Capabilities granted to user successfully.', 201);
    }

    // Case 3: Grant 1 capability to 1 user (original single grant)
    const grant = await accessService.grantCapability({
      actorId: req.user.id,
      targetUserId: userId,
      capabilityCode,
      expiresAt,
      scopeType,
      targetUserIds,
      targetProjectIds,
    });

    return sendSuccess(res, grant, 'Capability granted successfully.', 201);
  } catch (err) {
    next(err);
  }
}

export async function handleRevokeCapability(req, res, next) {
  try {
    const { grantId } = req.params;
    const revoked = await accessService.revokeCapability({
      actorId: req.user.id,
      grantId,
    });
    return sendSuccess(res, revoked, 'Capability revoked immediately.');
  } catch (err) {
    next(err);
  }
}

export async function handleRevokeCapabilities(req, res, next) {
  try {
    const { grantIds, capabilityCode, userIds } = req.body;

    // Case 1: Revoke a capability from multiple users
    if (capabilityCode && Array.isArray(userIds) && userIds.length > 0) {
      const results = await accessService.revokeCapabilityFromUsers({
        actorId: req.user.id,
        capabilityCode,
        userIds,
      });
      return sendSuccess(res, results, 'Capability revoked from selected users.');
    }

    // Case 2: Revoke multiple grants by grantIds
    if (Array.isArray(grantIds) && grantIds.length > 0) {
      const results = await accessService.revokeCapabilities({
        actorId: req.user.id,
        grantIds,
      });
      return sendSuccess(res, results, 'Capabilities revoked successfully.');
    }

    const error = new Error('Please provide grantIds or capabilityCode and userIds.');
    error.statusCode = 400;
    error.code = 'INVALID_ARGUMENTS';
    throw error;
  } catch (err) {
    next(err);
  }
}

export async function handleGetAuditLogs(req, res, next) {
  try {
    const { limit, offset } = req.query;
    const result = await accessService.getAccessAuditLogs({ limit, offset });
    return sendSuccess(res, result, 'Access audit logs retrieved.');
  } catch (err) {
    next(err);
  }
}

export async function handleUpdateCapabilityGrant(req, res, next) {
  try {
    const { grantId } = req.params;
    const { expiresAt, scopeType, targetProjectIds, targetUserIds } = req.body;

    const updated = await accessService.updateCapabilityGrant({
      actorId: req.user.id,
      grantId,
      expiresAt,
      scopeType,
      targetProjectIds,
      targetUserIds,
    });

    return sendSuccess(res, updated, 'Capability grant updated successfully.');
  } catch (err) {
    next(err);
  }
}

export async function handleUpdateCapabilityGrants(req, res, next) {
  try {
    const { grantIds, expiresAt, grantUpdates, scopeType, targetProjectIds, targetUserIds } = req.body;

    if (!Array.isArray(grantIds) || grantIds.length === 0) {
      const error = new Error('Please provide grantIds array.');
      error.statusCode = 400;
      error.code = 'INVALID_ARGUMENTS';
      throw error;
    }

    const results = await accessService.updateCapabilityGrants({
      actorId: req.user.id,
      grantIds,
      expiresAt,
      grantUpdates,
      scopeType,
      targetProjectIds,
      targetUserIds,
    });

    return sendSuccess(res, results, 'Capability grants updated successfully.');
  } catch (err) {
    next(err);
  }
}

export default {
  handleGetCapabilities,
  handleGetUserGrants,
  handleGrantCapability,
  handleRevokeCapability,
  handleRevokeCapabilities,
  handleUpdateCapabilityGrant,
  handleUpdateCapabilityGrants,
  handleGetAuditLogs,
};
