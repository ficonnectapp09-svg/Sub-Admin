require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');

const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');
const customerRoutes = require('./routes/customerRoutes');
const vendorRoutes = require('./routes/vendorRoutes');
const orderRoutes = require('./routes/orderRoutes');
const bookingRoutes = require('./routes/bookingRoutes');
const jobRoutes = require('./routes/jobRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const reportRoutes = require('./routes/reportRoutes');
const kycRoutes = require('./routes/kycRoutes');
const qualityRoutes = require('./routes/qualityRoutes');
const pincodeRoutes = require('./routes/pincodeRoutes');
const executiveRoutes = require('./routes/executiveRoutes');

// Newly integrated Manager Portal routes (Option A Revenue Divisions)
const locationRoutes = require('./routes/locationRoutes');
const managerDirectoryRoutes = require('./routes/managerDirectoryRoutes');
const auditRoutes = require('./routes/auditRoutes');
const uploadRoutes = require('./routes/uploadRoutes');
const shopVisitRoutes = require('./routes/shopVisitRoutes');
const qcTaskRoutes = require('./routes/qcTaskRoutes'); // QC & Task Routes
const notificationRoutes = require('./routes/notificationRoutes'); // Real-time Notifications
const ticketRoutes = require('./routes/ticketRoutes'); // Agent Support Tickets / Queries

// Real-Time Event, Redis & WebSocket Architecture
const { initRedis } = require('./redis/redisClient');
const { initEventSubscriber } = require('./events/eventSubscriber');
const { initWebSocketServer } = require('./websocket/websocketServer');
const { getSystemRealtimeTelemetry } = require('./realtime/realtimeMetrics');
const eventPublisher = require('./events/eventPublisher');
const { initDatabase } = require('./config/db');

const app = express();
const PORT = process.env.PORT || 8006;

// Middleware

// 2. Comprehensive CORS configuration
const corsOptions = {
  origin: (origin, callback) => {
    // Allow any origin (including Vercel, localhost, Electron, mobile)
    callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'Accept',
    'Origin',
    'Cache-Control',
    'Pragma',
    'Expires',
    'x-auth-token'
  ],
  exposedHeaders: ['Content-Range', 'X-Content-Range']
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// 3. Fallback explicit preflight and CORS header guarantee on every response
app.use((req, res, next) => {
  const origin = req.headers.origin || '*';
  res.header('Access-Control-Allow-Origin', origin);
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin, Cache-Control, Pragma, Expires, x-auth-token');
  res.header('Access-Control-Expose-Headers', 'Content-Range, X-Content-Range');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Serve static uploads with browser caching (7 days) and ETag validation
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
  maxAge: '7d',
  etag: true,
  lastModified: true
}));

// Core Sub-Admin Routes
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/vendors', vendorRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/kyc', kycRoutes);
app.use('/api/quality', qualityRoutes);
app.use('/api/pincodes', pincodeRoutes);
app.use('/api/operations', executiveRoutes);

// Dedicated Territory-Scoped Vendor Subscription Routes
const vendorSubscriptionController = require('./controllers/vendorSubscriptionController');
const authMiddleware = require('./middleware/authMiddleware');
app.get('/api/subscriptions', authMiddleware, vendorSubscriptionController.getVendorSubscriptions);
app.post('/api/subscriptions/:id/record-payment', authMiddleware, vendorSubscriptionController.recordSubscriptionPayment);

// Unified Health Check (Public)
app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    timestamp: new Date().toISOString(),
    service: 'Unified Hierarchical Sub-Admin & Field Manager Backend API',
    realtime: {
      engine: 'Redis Pub/Sub + WebSocket',
      targetLatency: '< 500ms'
    },
    portals: [
      { name: 'Hierarchical Admin Management Portal', defaultClient: 'http://localhost:3000' },
      { name: 'Agent & Field Manager Portal', defaultClient: 'http://localhost:5173' }
    ]
  });
});

// Integrated Field Manager Routes
app.use('/api/managers', managerDirectoryRoutes);
app.use('/api/audit-logs', auditRoutes);
// S3 Media Viewing Endpoint with HTTP 304 Caching & Range Support
app.get(['/api/media/s3/:key(*)', '/api/uploads/s3/:key(*)'], async (req, res) => {
  try {
    const rawKey = req.params.key || req.params[0] || '';
    const cleanKey = decodeURIComponent(rawKey).replace(/^\/+/, '');

    if (!cleanKey || cleanKey.includes('..') || !/^[a-zA-Z0-9_\-\/.]+\.(jpg|jpeg|png|webp|gif|avif|svg|pdf|doc|docx|xls|xlsx|csv|txt|webm|mp3|wav|m4a|ogg|aac)$/i.test(cleanKey)) {
      return res.status(400).json({ error: 'Invalid or disallowed media key.' });
    }

    const { getObjectStream } = require('./config/s3');
    const streamRes = await getObjectStream(cleanKey);
    if (!streamRes.success || !streamRes.body) {
      return res.status(404).json({ error: streamRes.error || 'Media object not found.' });
    }

    if (streamRes.etag) {
      res.setHeader('ETag', streamRes.etag);
      if (req.headers['if-none-match'] === streamRes.etag) {
        return res.status(304).end();
      }
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', streamRes.contentType || 'application/octet-stream');
    if (streamRes.contentLength) {
      res.setHeader('Content-Length', streamRes.contentLength.toString());
    }
    res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');

    streamRes.body.pipe(res);
  } catch (err) {
    console.error('[Subadmin Media Stream Error]:', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to retrieve media.' });
  }
});

app.use('/api/uploads', uploadRoutes);
app.use('/api/shop-visits', shopVisitRoutes);
app.use('/api/qc-tasks', qcTaskRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/territory', locationRoutes);
app.use('/api/tickets', ticketRoutes); // Agent support tickets / Admin Queries
app.use('/api', locationRoutes); // /api/states, /api/districts, /api/divisions, /api/pincodes, /api/hierarchy

// Real-Time System Telemetry & Reconnection Sync
app.get('/api/realtime/metrics', (req, res) => {
  res.json(getSystemRealtimeTelemetry());
});

app.get('/api/realtime/sync', (req, res) => {
  const { since } = req.query;
  const events = eventPublisher.getEventsSince(since);
  res.json({
    success: true,
    count: events.length,
    serverTimestamp: new Date().toISOString(),
    events
  });
});

// WebSocket Information & Probe Endpoint
app.get(['/ws', '/api/ws', '/api/realtime/info'], (req, res) => {
  res.json({
    success: true,
    websocket: true,
    message: 'Unified Real-Time WebSocket endpoint is active. Upgrade connection using Connection: Upgrade, Upgrade: websocket.',
    path: '/ws',
    serverTime: new Date().toISOString()
  });
});

// Global 404
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Endpoint ${req.originalUrl} not found.` });
});

// Global Error Handler with guaranteed CORS headers
app.use((err, req, res, next) => {
  console.error('Unhandled Error:', err.stack || err.message);
  const origin = req.headers.origin || '*';
  res.header('Access-Control-Allow-Origin', origin);
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin, Cache-Control, Pragma, Expires, x-auth-token');
  res.status(err.status || 500).json({ success: false, message: err.message || 'Internal Server Error' });
});

process.on('uncaughtException', (err) => {
  console.error('CRITICAL UNCAUGHT EXCEPTION:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('UNHANDLED PROMISE REJECTION:', reason);
});

// HTTP + WebSocket Server Creation
const server = http.createServer(app);

// Attach WebSocket Server
initWebSocketServer(server);

// Initialize Redis Pub/Sub & Local Bus Subscriber
initRedis().then(() => {
  initEventSubscriber();
}).catch(err => {
  console.warn('[RealTime] Event system initialization notice:', err.message);
});

if (require.main === module) {
  async function startServer() {
    try {
      console.log('[Sub Admin Backend] Connecting to MongoDB Atlas single source of truth...');
      await initDatabase();
      console.log('✅ MongoDB Atlas connected and all collections ready.');

      server.listen(PORT, '0.0.0.0', () => {
        console.log('================================================================');
        console.log('🚀 Unified Sub-Admin & Field Manager Backend is running!');
        console.log('📡 Local URL:   http://localhost:' + PORT);
        console.log('⚡ WebSocket:   ws://localhost:' + PORT + '/ws');
        console.log('🩺 Health Check: http://localhost:' + PORT + '/api/health');
        console.log('📊 Telemetry:   http://localhost:' + PORT + '/api/realtime/metrics');
        console.log('================================================================');
      });
    } catch (err) {
      console.error('FATAL: Sub Admin database initialization failed:', err.message);
      process.exit(1);
    }
  }

  startServer();
}

// Unified API Server - Clean Production Ready Data Store
module.exports = app;
module.exports.server = server;
