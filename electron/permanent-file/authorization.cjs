'use strict';

function canAccessPermanentFile(db, context, clientId) {
  if (!context || typeof context.userId !== 'string' || !context.userId
    || typeof context.isAdmin !== 'boolean') {
    throw new TypeError('An authenticated authorization context is required.');
  }
  if (typeof clientId !== 'string' || !clientId.trim()) {
    throw new TypeError('A client ID is required.');
  }

  if (context.isAdmin) {
    return Boolean(db.prepare('SELECT 1 FROM clients WHERE id = ?').get(clientId));
  }
  return Boolean(db.prepare(`
    SELECT 1
    FROM engagements e
    JOIN engagement_assignments a ON a.engagement_id = e.id
    WHERE e.client_id = ? AND a.user_id = ?
    LIMIT 1
  `).get(clientId, context.userId));
}

module.exports = { canAccessPermanentFile };
