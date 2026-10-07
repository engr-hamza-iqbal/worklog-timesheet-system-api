import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const INVITATIONS_FILE = path.join(DATA_DIR, 'invitations.json');

// In-memory array of invitation records
let invitations = [];

function loadInvitations() {
  try {
    if (fs.existsSync(INVITATIONS_FILE)) {
      const data = JSON.parse(fs.readFileSync(INVITATIONS_FILE, 'utf8'));
      if (Array.isArray(data)) {
        invitations = data;
      }
    }
  } catch {
    invitations = [];
  }
}
loadInvitations();

function saveInvitations() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(INVITATIONS_FILE, JSON.stringify(invitations, null, 2), 'utf8');
  } catch {
    // fallback to memory
  }
}

function computeStatus(invitation, consumedTokensSet) {
  if (invitation.status === 'REVOKED') return 'REVOKED';
  if (invitation.status === 'ACCEPTED') return 'ACCEPTED';
  if (invitation.tokenHash && consumedTokensSet?.has(invitation.tokenHash)) return 'ACCEPTED';
  if (invitation.jti && consumedTokensSet?.has(invitation.jti)) return 'ACCEPTED';
  if (new Date() > new Date(invitation.expiresAt)) return 'EXPIRED';
  return 'PENDING';
}

export function addInvitation({ id, email, token, jti, invitedBy, expiresInHours, expiresAt, createdAt }) {
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const record = {
    id,
    email: email.toLowerCase().trim(),
    token,
    tokenHash,
    jti,
    invitedBy: invitedBy ? { id: invitedBy.id, name: invitedBy.name, email: invitedBy.email } : null,
    expiresInHours,
    expiresAt,
    createdAt: createdAt || new Date().toISOString(),
    status: 'PENDING',
    revokedAt: null,
    revokedBy: null,
  };
  invitations.unshift(record);
  saveInvitations();
  return record;
}

export function getAllInvitations(consumedTokensSet) {
  return invitations.map((inv) => ({
    id: inv.id,
    email: inv.email,
    token: inv.token,
    jti: inv.jti,
    invitedBy: inv.invitedBy,
    expiresInHours: inv.expiresInHours,
    expiresAt: inv.expiresAt,
    createdAt: inv.createdAt,
    status: computeStatus(inv, consumedTokensSet),
    revokedAt: inv.revokedAt,
    revokedBy: inv.revokedBy,
  }));
}

export function findInvitationById(id) {
  return invitations.find((inv) => inv.id === id);
}

export function findInvitationByToken(rawToken) {
  if (!rawToken) return null;
  const hash = crypto.createHash('sha256').update(rawToken).digest('hex');
  return invitations.find((inv) => inv.token === rawToken || inv.tokenHash === hash || inv.jti === rawToken);
}

export function isRevoked(rawTokenOrJti) {
  if (!rawTokenOrJti) return false;
  const hash = crypto.createHash('sha256').update(rawTokenOrJti).digest('hex');
  const found = invitations.find(
    (inv) => inv.token === rawTokenOrJti || inv.tokenHash === hash || inv.jti === rawTokenOrJti
  );
  return found?.status === 'REVOKED';
}

export function revokeInvitation(id, revokingUser) {
  const inv = invitations.find((item) => item.id === id || item.token === id || item.jti === id);
  if (!inv) {
    const error = new Error('Invitation record not found.');
    error.statusCode = 404;
    error.code = 'INVITATION_NOT_FOUND';
    throw error;
  }
  inv.status = 'REVOKED';
  inv.revokedAt = new Date().toISOString();
  inv.revokedBy = revokingUser ? { id: revokingUser.id, name: revokingUser.name } : null;
  saveInvitations();
  return inv;
}

export function revokeByEmail(email, revokingUser) {
  const normalized = email.toLowerCase().trim();
  let count = 0;
  invitations.forEach((inv) => {
    if (inv.email === normalized && inv.status === 'PENDING') {
      inv.status = 'REVOKED';
      inv.revokedAt = new Date().toISOString();
      inv.revokedBy = revokingUser ? { id: revokingUser.id, name: revokingUser.name } : null;
      count++;
    }
  });
  if (count > 0) {
    saveInvitations();
  }
  return count;
}

export function markAccepted(rawToken) {
  const inv = findInvitationByToken(rawToken);
  if (inv) {
    inv.status = 'ACCEPTED';
    saveInvitations();
  }
}

export function clearInvitations() {
  invitations = [];
  try {
    if (fs.existsSync(INVITATIONS_FILE)) {
      fs.unlinkSync(INVITATIONS_FILE);
    }
  } catch {
    // ignore
  }
}

export default {
  addInvitation,
  getAllInvitations,
  findInvitationById,
  findInvitationByToken,
  isRevoked,
  revokeInvitation,
  revokeByEmail,
  markAccepted,
  clearInvitations,
};
