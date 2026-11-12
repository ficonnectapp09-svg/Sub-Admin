// Centralized fetch wrapper with Bearer token injection, resilient startup retry,
// client-side in-memory caching (SWR), request deduplication, and controlled error handling.

// Detect if running inside Electron desktop runtime (file:// protocol or preload flag)
export const isElectron =
  (typeof window !== 'undefined' && window.electronAPI?.isElectron === true) ||
  (typeof navigator !== 'undefined' && (navigator.userAgent || '').toLowerCase().includes('electron')) ||
  (typeof window !== 'undefined' && window.location?.protocol === 'file:');

// Detect if running in a standard web browser served over HTTP/HTTPS
export const isWebBrowser =
  typeof window !== 'undefined' &&
  window.location &&
  (window.location.protocol === 'http:' || window.location.protocol === 'https:') &&
  !isElectron;

// Backend URL configured via environment or Render deployment
export const BACKEND_DIRECT_URL = (
  import.meta.env.VITE_API_BASE_URL ||
  import.meta.env.VITE_API_BASE ||
  import.meta.env.VITE_API_URL ||
  'https://sub-admin-4pkg.onrender.com'
).trim().replace(/\/+$/, '');

export const API_BASE_URL = BACKEND_DIRECT_URL;

// Sanitizes raw server/proxy/network error messages to keep UI clean and secure
export function sanitizeErrorMessage(message, status) {
  if (!message || typeof message !== 'string') {
    return 'Unable to connect to the server. Please try again.';
  }

  const lower = message.toLowerCase();

  // If role authorization denial, cross-app role rejection, or credential mismatch -> generic "Invalid credentials"
  if (
    lower.includes('not authorized') ||
    lower.includes('accounts with role') ||
    lower.includes('unauthorized_application_role') ||
    lower.includes('state_manager') ||
    lower.includes('division_manager') ||
    lower.includes('pincode_manager') ||
    lower.includes('district_manager') ||
    lower.includes('access denied: accounts')
  ) {
    return 'Invalid credentials';
  }

  // If Vercel router error, gateway error, or connection error
  if (
    lower.includes('router_external_target_connection_error') ||
    lower.includes('an error occurred with this application') ||
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('econnrefused') ||
    lower.includes('etimedout') ||
    lower.includes('502 bad gateway') ||
    lower.includes('504 gateway timeout') ||
    lower.includes('<!doctype') ||
    lower.includes('<html')
  ) {
    return 'Unable to connect to the server. Please try again.';
  }

  return message;
}

// Client-side cache and deduplication structures
const apiCache = new Map();
const inFlightRequests = new Map();

// Helper to determine cache TTL based on endpoint characteristics
function getEndpointTTL(endpoint) {
  const ep = endpoint.toLowerCase();
  // Auth profile & registration status -> strictly 0 ms (never cache, always revalidate from DB)
  if (ep.includes('/auth/me') || ep.includes('/auth/registration-status') || ep.includes('/auth/status')) {
    return 0;
  }
  // Geography and hierarchy entities change very rarely -> 10 minutes
  if (ep.includes('/admin/districts') || ep.includes('/admin/divisions') || ep.includes('/admin/pincodes') || ep.includes('/admin/states') || ep.includes('/territory')) {
    return 10 * 60 * 1000;
  }
  // Categories -> 5 minutes
  if (ep.includes('/categories')) {
    return 5 * 60 * 1000;
  }
  // Dynamic business data (orders, bookings, jobs, vendors, customers, reports) -> 45 seconds
  return 45 * 1000;
}

// Invalidate cache keys matching prefix or all
export function clearApiCache(prefix = '') {
  if (!prefix) {
    apiCache.clear();
    return;
  }
  const target = prefix.toLowerCase();
  for (const key of apiCache.keys()) {
    if (key.toLowerCase().includes(target)) {
      apiCache.delete(key);
    }
  }
}

// Invalidate relevant cache namespaces when a mutating request occurs
function invalidateRelatedCaches(endpoint) {
  const ep = endpoint.toLowerCase();
  if (ep.includes('/ticket')) {
    clearApiCache('/tickets');
  } else if (ep.includes('/order')) {
    clearApiCache('/orders');
    clearApiCache('/reports');
  } else if (ep.includes('/booking')) {
    clearApiCache('/bookings');
    clearApiCache('/reports');
  } else if (ep.includes('/job')) {
    clearApiCache('/jobs');
    clearApiCache('/reports');
  } else if (ep.includes('/vendor')) {
    clearApiCache('/vendors');
    clearApiCache('/reports');
  } else if (ep.includes('/customer')) {
    clearApiCache('/customers');
    clearApiCache('/reports');
  } else if (ep.includes('/manager')) {
    clearApiCache('/managers');
    clearApiCache('/reports');
  } else if (ep.includes('/agent')) {
    clearApiCache('/agents');
    clearApiCache('/operations/agents');
    clearApiCache('/reports');
  } else if (ep.includes('/admin') || ep.includes('/territory')) {
    clearApiCache('/admin');
    clearApiCache('/territory');
    clearApiCache('/reports');
  } else {
    clearApiCache('/reports');
  }
}

// Internal core HTTP fetch execution
async function executeFetch(endpoint, options, headers) {
  let candidateUrls = [];

  if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) {
    candidateUrls = [endpoint];
  } else {
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const directUrl = `${BACKEND_DIRECT_URL}${cleanEndpoint.startsWith('/api') ? '' : '/api'}${cleanEndpoint}`;
    candidateUrls = [directUrl];
  }

  const isGet = !options.method || options.method.toUpperCase() === 'GET';
  const maxRetries = options.retries ?? (isGet ? 2 : 0);

  const noAutoLogoutEndpoints = ['/auth/login', '/auth/me', '/auth/register'];
  const isNoAutoLogout = noAutoLogoutEndpoints.some((e) => endpoint.includes(e));

  let lastError = null;

  for (const currentUrl of candidateUrls) {
    // If we have an alternative candidate URL, retry network errors at most once on the primary URL before trying fallback
    const retriesForThisUrl = (candidateUrls.length > 1 && currentUrl === candidateUrls[0] && !isElectron)
      ? Math.min(maxRetries, 1)
      : maxRetries;

    for (let attempt = 0; attempt <= retriesForThisUrl; attempt++) {
      try {
        const response = await fetch(currentUrl, { ...options, headers });

        let data;
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          try {
            data = await response.json();
          } catch (jsonErr) {
            // Attempt client-side decompression recovery if the proxy sent gzip bytes without content-encoding header
            let recovered = false;
            if (typeof DecompressionStream !== 'undefined' && response.clone) {
              try {
                const clone = response.clone();
                const buf = await clone.arrayBuffer();
                const u8 = new Uint8Array(buf);
                if (u8.length >= 2 && u8[0] === 0x1f && u8[1] === 0x8b) {
                  const ds = new DecompressionStream('gzip');
                  const decompressedStream = new Response(buf).body.pipeThrough(ds);
                  const text = await new Response(decompressedStream).text();
                  data = JSON.parse(text);
                  recovered = true;
                }
              } catch (recErr) {}
            }
            if (!recovered) {
              const text = await response.text().catch(() => '');
              if (!response.ok) {
                data = { message: sanitizeErrorMessage(text, response.status) || `Request failed with status ${response.status}` };
              } else {
                // If 200 OK returned non-parseable JSON, treat as corrupted response to trigger candidate URL fallback
                throw new Error(`Corrupted JSON response from endpoint (${jsonErr.message})`);
              }
            }
          }
        } else {
          const text = await response.text();
          data = { message: sanitizeErrorMessage(text, response.status) };
        }

        // For auth login, a valid 200 OK response MUST contain user and token
        if (response.ok && endpoint.includes('/auth/login') && (!data || (!data.token && !data.user))) {
          throw new Error('Malformed login response: token or user profile missing from proxy');
        }

        if (!response.ok) {
          if ((response.status === 503 || response.status === 504) && attempt < retriesForThisUrl) {
            await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
            continue;
          }

          if (response.status === 401 && !isNoAutoLogout) {
            localStorage.removeItem('ams_token');
            localStorage.removeItem('ams_user');
            const loginPath = isElectron ? '/#/login' : '/login';
            if (window.location.pathname !== '/login' && window.location.hash !== '#/login') {
              window.location.href = loginPath;
            }
          }

          const rawMessage = data?.message || data?.msg || `Request failed with status ${response.status}`;
          const error = new Error(sanitizeErrorMessage(rawMessage, response.status));
          error.status = response.status;
          throw error;
        }

        return data;
      } catch (error) {
        lastError = error;
        if (attempt < retriesForThisUrl && (!error.status || error.status === 503 || error.status === 504)) {
          await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
          continue;
        }
        break;
      }
    }

    // Stop trying candidate fallback URLs if we got an authoritative client HTTP response (4xx except 408)
    if (lastError?.status && lastError.status >= 400 && lastError.status < 500 && lastError.status !== 408) {
      break;
    }
  }

  const cleanMsg = sanitizeErrorMessage(lastError?.message || '', lastError?.status);
  const cleanError = new Error(cleanMsg);
  cleanError.status = lastError?.status;
  if (cleanMsg !== 'Invalid credentials') {
    console.error(`API Error [${endpoint}]:`, cleanMsg);
  }
  throw cleanError;
}

export async function apiRequest(endpoint, options = {}) {
  const token = localStorage.getItem('ams_token') || 'anon';
  const method = (options.method || 'GET').toUpperCase();
  const isGet = method === 'GET';

  // Invalidate relevant cache namespaces on state mutations
  if (!isGet) {
    invalidateRelatedCaches(endpoint);
  }

  const headers = {
    ...(token && token !== 'anon' ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const cacheKey = `${token}:${method}:${cleanEndpoint}`;

  // Serve from client-side SWR cache if valid GET with positive TTL
  const ttl = getEndpointTTL(cleanEndpoint);
  if (isGet && !options.skipCache && !options.fresh && ttl > 0) {
    const cached = apiCache.get(cacheKey);
    const now = Date.now();

    if (cached && (now - cached.timestamp < ttl)) {
      // Background revalidation if older than 20 seconds
      if (now - cached.timestamp > 20000 && !inFlightRequests.has(cacheKey)) {
        const bgPromise = executeFetch(cleanEndpoint, options, headers)
          .then((freshData) => {
            apiCache.set(cacheKey, { data: freshData, timestamp: Date.now() });
            return freshData;
          })
          .catch(() => {})
          .finally(() => inFlightRequests.delete(cacheKey));
        inFlightRequests.set(cacheKey, bgPromise);
      }
      return cached.data;
    }

    // Deduplicate in-flight requests
    if (inFlightRequests.has(cacheKey)) {
      return inFlightRequests.get(cacheKey);
    }
  }

  const fetchPromise = executeFetch(cleanEndpoint, options, headers)
    .then((data) => {
      if (isGet && ttl > 0) {
        apiCache.set(cacheKey, { data, timestamp: Date.now() });
      }
      return data;
    })
    .finally(() => {
      if (isGet) {
        inFlightRequests.delete(cacheKey);
      }
    });

  if (isGet && !options.skipCache) {
    inFlightRequests.set(cacheKey, fetchPromise);
  }

  return fetchPromise;
}
