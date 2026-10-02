/**
 * Server-Sent Events (SSE) Manager for real-time permission and capability updates.
 * Allows pushing instant signals to connected browser clients when capabilities
 * are granted, edited, or revoked, enabling seamless UI re-renders without page reloads.
 */

// userId -> Set of express response objects
const clients = new Map();

/**
 * Register a client's SSE response stream
 */
export function registerClient(userId, res) {
  if (!clients.has(userId)) {
    clients.set(userId, new Set());
  }
  clients.get(userId).add(res);

  res.on('close', () => {
    const userClients = clients.get(userId);
    if (userClients) {
      userClients.delete(res);
      if (userClients.size === 0) {
        clients.delete(userId);
      }
    }
  });
}

/**
 * Notify a specific user that their access permissions or capabilities have changed
 */
export function notifyUserAccessChanged(userId, eventData = {}) {
  const userClients = clients.get(userId);
  if (!userClients || userClients.size === 0) return;

  const payload = `data: ${JSON.stringify({
    type: 'CAPABILITIES_CHANGED',
    userId,
    timestamp: Date.now(),
    ...eventData,
  })}\n\n`;

  for (const clientRes of userClients) {
    try {
      clientRes.write(payload);
    } catch {
      // Ignore write errors on disconnected streams
    }
  }
}

/**
 * Notify all connected clients that access changes occurred (e.g. system-wide capability change)
 */
export function notifyAllAccessChanged(eventData = {}) {
  const payload = `data: ${JSON.stringify({
    type: 'CAPABILITIES_CHANGED',
    timestamp: Date.now(),
    ...eventData,
  })}\n\n`;

  for (const [_, userClients] of clients) {
    for (const clientRes of userClients) {
      try {
        clientRes.write(payload);
      } catch {
        // Ignore write errors
      }
    }
  }
}

export default {
  registerClient,
  notifyUserAccessChanged,
  notifyAllAccessChanged,
};
