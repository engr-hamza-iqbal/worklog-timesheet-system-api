import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import jwt from 'jsonwebtoken';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../../data');
const INVITATIONS_FILE = path.join(DATA_DIR, 'invitations.json');
const CWD_INVITATIONS_FILE = path.resolve(process.cwd(), 'data/invitations.json');

// In-memory array of invitation records
let invitations = [];

function loadInvitations() {
  try {
    const loadedMap = new Map();

    const loadFromFile = (filePath) => {
      if (fs.existsSync(filePath)) {
        try {
          const raw = fs.readFileSync(filePath, 'utf8');
          const data = JSON.parse(raw);
          if (Array.isArray(data)) {
            data.forEach((item) => {
              if (item?.id) {
                loadedMap.set(item.id, item);
              } else if (item?.token) {
                loadedMap.set(item.token, item);
              }
            });
          }
        } catch {
          // ignore corrupted file
        }
      }
    };

    // Load from primary path
    loadFromFile(INVITATIONS_FILE);
    // If cwd path is different, merge
    if (CWD_INVITATIONS_FILE !== INVITATIONS_FILE) {
      loadFromFile(CWD_INVITATIONS_FILE);
    }

    if (loadedMap.size > 0) {
      invitations = Array.from(loadedMap.values()).sort(
        (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
      );
    }
  } catch {
    // preserve current in-memory
  }
}
loadInvitations();

function saveInvitations() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const serialized = JSON.stringify(invitations, null, 2);
    fs.writeFileSync(INVITATIONS_FILE, serialized, 'utf8');

    // Also mirror to cwd if different
    if (CWD_INVITATIONS_FILE !== INVITATIONS_FILE) {
      try {
        const cwdDir = path.dirname(CWD_INVITATIONS_FILE);
        if (!fs.existsSync(cwdDir)) fs.mkdirSync(cwdDir, { recursive: true });
        fs.writeFileSync(CWD_INVITATIONS_FILE, serialized, 'utf8');
      } catch {
        // ignore
      }
    }
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
  loadInvitations();
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const record = {
    id: id || `inv_${crypto.randomBytes(8).toString('hex')}`,
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
  invitations = [record, ...invitations.filter((i) => i.id !== record.id && i.token !== record.token)];
  saveInvitations();
  return record;
}

export function getAllInvitations(consumedTokensSet) {
  loadInvitations();
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
  loadInvitations();
  return invitations.find((inv) => inv.id === id);
}

export function findInvitationByToken(rawToken) {
  if (!rawToken) return null;
  loadInvitations();
  const clean = rawToken.includes('invite=') ? rawToken.split('invite=')[1].split('&')[0] : rawToken;
  const hash = crypto.createHash('sha256').update(clean).digest('hex');
  return invitations.find(
    (inv) => inv.token === clean || inv.tokenHash === hash || inv.jti === clean
  );
}

export function isRevoked(rawTokenOrJti) {
  if (!rawTokenOrJti) return false;
  loadInvitations();
  const clean = rawTokenOrJti.includes('invite=') ? rawTokenOrJti.split('invite=')[1].split('&')[0] : rawTokenOrJti;
  const hash = crypto.createHash('sha256').update(clean).digest('hex');
  const found = invitations.find(
    (inv) => inv.token === clean || inv.tokenHash === hash || inv.jti === clean
  );
  return found?.status === 'REVOKED';
}

export function revokeInvitation(id, revokingUser) {
  loadInvitations();
  const clean = id.includes('invite=') ? id.split('invite=')[1].split('&')[0] : id;
  const hash = crypto.createHash('sha256').update(clean).digest('hex');

  let inv = invitations.find((item) => item.id === clean || item.token === clean || item.tokenHash === hash || item.jti === clean);

  // If not found in records, but is a valid JWT invitation token, add it on the fly as revoked
  if (!inv) {
    try {
      const decoded = jwt.decode(clean);
      if (decoded && decoded.purpose === 'REGISTRATION_INVITATION' && decoded.email) {
        inv = {
          id: `inv_${crypto.randomBytes(8).toString('hex')}`,
          email: decoded.email.toLowerCase().trim(),
          token: clean,
          tokenHash: hash,
          jti: decoded.jti || null,
          invitedBy: null,
          expiresInHours: 72,
          expiresAt: decoded.exp ? new Date(decoded.exp * 1000).toISOString() : new Date().toISOString(),
          createdAt: decoded.iat ? new Date(decoded.iat * 1000).toISOString() : new Date().toISOString(),
          status: 'REVOKED',
          revokedAt: new Date().toISOString(),
          revokedBy: revokingUser ? { id: revokingUser.id, name: revokingUser.name } : null,
        };
        invitations.unshift(inv);
        saveInvitations();
        return inv;
      }
    } catch {
      // not a JWT
    }
  }

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
  loadInvitations();
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
  loadInvitations();
  const inv = findInvitationByToken(rawToken);
  if (inv) {
    inv.status = 'ACCEPTED';
    saveInvitations();
  }
}

export function clearInvitations() {
  invitations = [];
  try {
    if (fs.existsSync(INVITATIONS_FILE)) fs.unlinkSync(INVITATIONS_FILE);
    if (CWD_INVITATIONS_FILE !== INVITATIONS_FILE && fs.existsSync(CWD_INVITATIONS_FILE)) {
      fs.unlinkSync(CWD_INVITATIONS_FILE);
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
