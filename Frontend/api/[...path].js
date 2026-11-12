// Vercel Serverless Function API Proxy for Frontend root deployment
import http from 'http';
import https from 'https';
import { URL } from 'url';
import zlib from 'zlib';

const BACKEND_URL = (
  process.env.BACKEND_API_URL ||
  process.env.VITE_API_BASE_URL ||
  process.env.VITE_API_BASE ||
  'https://sub-admin-4pkg.onrender.com'
).replace(/\/+$/, '');

export default async function handler(req, res) {
  // CORS Headers
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    res.statusCode = 200;
    return res.end();
  }

  try {
    let subPath = '';
    if (req.query && req.query.path) {
      const p = Array.isArray(req.query.path) ? req.query.path.join('/') : req.query.path;
      const queryParams = new URLSearchParams();
      for (const [k, v] of Object.entries(req.query)) {
        if (k !== 'path') {
          if (Array.isArray(v)) {
            v.forEach(val => queryParams.append(k, val));
          } else {
            queryParams.append(k, v);
          }
        }
      }
      const qs = queryParams.toString();
      subPath = `/api/${p}${qs ? `?${qs}` : ''}`;
    } else {
      subPath = req.url || '';
      if (!subPath.startsWith('/api') && !subPath.startsWith('/uploads')) {
        subPath = `/api${subPath.startsWith('/') ? subPath : `/${subPath}`}`;
      }
    }

    const targetUrl = new URL(`${BACKEND_URL}${subPath}`);
    const isHttps = targetUrl.protocol === 'https:';
    const client = isHttps ? https : http;

    const requestHeaders = { ...req.headers };
    delete requestHeaders.host;
    delete requestHeaders.connection;
    requestHeaders['x-forwarded-host'] = req.headers.host;
    requestHeaders['accept-encoding'] = 'identity';

    let bodyBuffer = null;
    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      if (req.body !== undefined && req.body !== null) {
        if (typeof req.body === 'string' || Buffer.isBuffer(req.body)) {
          bodyBuffer = Buffer.from(req.body);
        } else {
          bodyBuffer = Buffer.from(JSON.stringify(req.body));
        }
        requestHeaders['content-length'] = Buffer.byteLength(bodyBuffer);
      } else if (!req.readableEnded && !req.complete) {
        try {
          const chunks = [];
          for await (const chunk of req) {
            chunks.push(chunk);
          }
          if (chunks.length > 0) {
            bodyBuffer = Buffer.concat(chunks);
            requestHeaders['content-length'] = bodyBuffer.length;
          }
        } catch (streamErr) {
          console.warn('Proxy req stream read warning:', streamErr.message);
        }
      }

      if (!bodyBuffer) {
        delete requestHeaders['content-length'];
      }
    }

    const proxyReq = client.request(
      targetUrl,
      {
        method: req.method,
        headers: requestHeaders,
        timeout: 60000
      },
      (proxyRes) => {
        res.statusCode = proxyRes.statusCode || 200;
        for (const [key, val] of Object.entries(proxyRes.headers)) {
          const lKey = key.toLowerCase();
          if (lKey !== 'content-encoding' && lKey !== 'transfer-encoding' && lKey !== 'content-length') {
            try {
              res.setHeader(key, val);
            } catch (e) {}
          }
        }

        const chunks = [];
        proxyRes.on('data', (c) => chunks.push(c));
        proxyRes.on('end', () => {
          let body = Buffer.concat(chunks);
          const encoding = (proxyRes.headers['content-encoding'] || '').toLowerCase();
          let decompressed = false;

          const isGzip = encoding.includes('gzip') || (body.length >= 2 && body[0] === 0x1f && body[1] === 0x8b);
          const isBr = encoding.includes('br');
          const isDeflate = encoding.includes('deflate');

          try {
            if (isGzip) {
              body = zlib.gunzipSync(body);
              decompressed = true;
            } else if (isBr) {
              body = zlib.brotliDecompressSync(body);
              decompressed = true;
            } else if (isDeflate) {
              body = zlib.inflateSync(body);
              decompressed = true;
            }
          } catch (decompErr) {
            console.warn('Decompression warning in proxy:', decompErr.message);
          }

          if (!decompressed && encoding) {
            try {
              res.setHeader('content-encoding', encoding);
            } catch (e) {}
          }

          // If upstream returned 500+ with HTML (e.g. Nginx 502 Bad Gateway during restart), return JSON with CORS
          if (proxyRes.statusCode >= 500) {
            const bodyStr = body.toString('utf8');
            if (bodyStr.includes('<html') || bodyStr.includes('502 Bad Gateway') || (proxyRes.headers['content-type'] || '').includes('text/html')) {
              res.setHeader('Content-Type', 'application/json');
              res.setHeader('Access-Control-Allow-Origin', origin);
              res.setHeader('Access-Control-Allow-Credentials', 'true');
              const jsonBody = Buffer.from(JSON.stringify({
                success: false,
                message: 'Unable to connect to the server. Please try again.'
              }));
              res.setHeader('content-length', Buffer.byteLength(jsonBody));
              return res.end(jsonBody);
            }
          }

          // Always ensure CORS headers are maintained
          res.setHeader('Access-Control-Allow-Origin', origin);
          res.setHeader('Access-Control-Allow-Credentials', 'true');

          if (!res.headersSent) {
            res.setHeader('content-length', Buffer.byteLength(body));
          }
          res.end(body);
        });
      }
    );

    proxyReq.on('timeout', () => {
      proxyReq.destroy();
      if (!res.headersSent) {
        res.statusCode = 504;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          success: false,
          message: 'Unable to connect to the server. Request timed out.'
        }));
      }
    });

    proxyReq.on('error', (err) => {
      console.error('Backend proxy error:', err.message);
      if (!res.headersSent) {
        res.statusCode = 503;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          success: false,
          message: 'Unable to connect to the server. Please try again.'
        }));
      }
    });

    if (bodyBuffer) {
      proxyReq.write(bodyBuffer);
    }
    proxyReq.end();
  } catch (err) {
    console.error('Proxy exception:', err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        success: false,
        message: 'Unable to connect to the server. Please try again.'
      }));
    }
  }
}
