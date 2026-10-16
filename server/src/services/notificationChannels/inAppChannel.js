'use strict';

async function send(message) {
  const { notificationService } = require('../../api/notifications');
  try {
    const id = await notificationService.createNotification(
      message.userId,
      message.typeName,
      message.subject,
      message.body,
      {
        priority: message.priority || 'high',
        actionUrl: message.actionUrl || null,
        actionText: 'Review',
        data: message.data || null,
      },
    );
    if (!id) return { ok: false, error: 'in_app_not_created' };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err && err.message ? String(err.message).slice(0, 500) : 'in_app_failed' };
  }
}

module.exports = { send };
