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
      capabilityCode,
      expiresAt,
      scopeType,
      targetUserIds,
      targetProjectIds,
    } = req.body;

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

export async function handleGetAuditLogs(req, res, next) {
  try {
    const { limit, offset } = req.query;
    const result = await accessService.getAccessAuditLogs({ limit, offset });
    return sendSuccess(res, result, 'Access audit logs retrieved.');
  } catch (err) {
    next(err);
  }
}

export default {
  handleGetCapabilities,
  handleGetUserGrants,
  handleGrantCapability,
  handleRevokeCapability,
  handleGetAuditLogs,
};
