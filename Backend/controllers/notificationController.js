const { verifyToken } = require('../utils/jwt');
const notificationService = require('../services/notificationService');
const { db } = require('../config/db');

/**
 * Helper to extract user from Authorization header or ?token query param (useful for EventSource SSE)
 */
function extractUserFromRequest(req) {
  let token = null;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1];
  } else if (req.query && req.query.token) {
    token = req.query.token;
  }

  if (!token) return null;

  try {
    const decoded = verifyToken(token);
    // Find active user record
    const allUsers = Array.from(db.users || []);
    const user = allUsers.find(u => (u.id || u._id) === (decoded.id || decoded._id) || u.email === decoded.email);
    return user || decoded;
  } catch (err) {
    return null;
  }
}

/**
 * GET /api/notifications
 */
const getNotifications = async (req, res) => {
  try {
    const user = req.user || extractUserFromRequest(req);
    const options = {
      type: req.query.type,
      unreadOnly: req.query.unreadOnly,
      search: req.query.search,
      page: parseInt(req.query.page, 10) || 1,
      limit: parseInt(req.query.limit, 10) || 50
    };

    const result = notificationService.getNotificationsForUser(user, options);
    return res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('Failed to get notifications:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch notifications', error: error.message });
  }
};

/**
 * GET /api/notifications/unread-count
 */
const getUnreadCount = async (req, res) => {
  try {
    const user = req.user || extractUserFromRequest(req);
    const result = notificationService.getNotificationsForUser(user, { limit: 1 });
    return res.json({
      success: true,
      unreadCount: result.unreadCount
    });
  } catch (error) {
    return res.status(500).json({ success: false, unreadCount: 0, error: error.message });
  }
};

/**
 * GET /api/notifications/stream (SSE Real-time Endpoint)
 */
const streamNotifications = (req, res) => {
  const user = req.user || extractUserFromRequest(req);

  const origin = req.headers.origin || '*';

  // Set SSE HTTP Headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // Disable proxy buffering for Nginx/reverse proxies
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true'
  });

  res.flushHeaders?.();

  const clientId = `client_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  notificationService.registerClient(clientId, res, user);

  // Handle client disconnection
  req.on('close', () => {
    notificationService.unregisterClient(clientId);
  });
};

/**
 * PATCH /api/notifications/:id/read
 */
const markAsRead = async (req, res) => {
  try {
    const user = req.user || extractUserFromRequest(req);
    const userId = user?.id || user?._id;
    const { id } = req.params;

    const notif = await notificationService.markNotificationAsRead(id, userId);
    if (!notif) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }

    return res.json({
      success: true,
      message: 'Notification marked as read',
      data: notif
    });
  } catch (error) {
    console.error('Failed to mark notification read:', error);
    return res.status(500).json({ success: false, message: 'Failed to mark as read', error: error.message });
  }
};

/**
 * POST /api/notifications/mark-all-read
 */
const markAllAsRead = async (req, res) => {
  try {
    const user = req.user || extractUserFromRequest(req);
    const result = await notificationService.markAllNotificationsAsRead(user);

    return res.json({
      success: true,
      message: 'All notifications marked as read',
      updatedCount: result.updatedCount
    });
  } catch (error) {
    console.error('Failed to mark all notifications read:', error);
    return res.status(500).json({ success: false, message: 'Failed to mark all as read', error: error.message });
  }
};

/**
 * DELETE /api/notifications/:id
 */
const deleteNotification = async (req, res) => {
  try {
    const { id } = req.params;
    await notificationService.deleteNotification(id);
    return res.json({ success: true, message: 'Notification deleted successfully' });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to delete notification', error: error.message });
  }
};

module.exports = {
  getNotifications,
  getUnreadCount,
  streamNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification
};
