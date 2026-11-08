const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = __dirname;
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 8001);
const REGIONS = {
  us: 'https://openapi.tuyaus.com',
  eu: 'https://openapi.tuyaeu.com',
  cn: 'https://openapi.tuyacn.com',
  in: 'https://openapi.tuyain.com',
  sg: 'https://openapi-sg.iotbing.com'
};
const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8'
};

loadEnvFile();

function loadEnvFile() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || Object.hasOwn(process.env, match[1])) continue;
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

function config() {
  const region = (process.env.TUYA_REGION || '').toLowerCase();
  return {
    accessId: process.env.TUYA_ACCESS_ID,
    accessSecret: process.env.TUYA_ACCESS_SECRET,
    deviceId: process.env.TUYA_DEVICE_ID,
    endpoint: REGIONS[region],
    switchCode: process.env.TUYA_SWITCH_DP || 'switch'
  };
}

function isConfigured() {
  const settings = config();
  return Boolean(settings.accessId && settings.accessSecret && settings.deviceId && settings.endpoint);
}

function sendJson(res, status, value) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  res.end(JSON.stringify(value));
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function signRequest(method, requestPath, body, accessToken = '') {
  const settings = config();
  const timestamp = Date.now().toString();
  const nonce = crypto.randomUUID().replaceAll('-', '');
  const bodyText = body ? JSON.stringify(body) : '';
  const stringToSign = `${method}\n${sha256(bodyText)}\n\n${requestPath}`;
  const sign = crypto.createHmac('sha256', settings.accessSecret)
    .update(`${settings.accessId}${accessToken}${timestamp}${nonce}${stringToSign}`)
    .digest('hex')
    .toUpperCase();
  return {
    client_id: settings.accessId,
    t: timestamp,
    nonce,
    sign_method: 'HMAC-SHA256',
    sign
  };
}

let tokenCache = null;
let deviceOnlineCache = null;

async function tuyaRequest(method, requestPath, body, accessToken = '') {
  const settings = config();
  const headers = signRequest(method, requestPath, body, accessToken);
  if (accessToken) headers.access_token = accessToken;
  if (body) headers['content-type'] = 'application/json';
  const response = await fetch(`${settings.endpoint}${requestPath}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000)
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.success) {
    const error = new Error(result?.msg || `Tuya API merespons HTTP ${response.status}`);
    error.status = response.status;
    error.code = result?.code;
    throw error;
  }
  return result.result;
}

async function getAccessToken() {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60000) return tokenCache.value;
  const result = await tuyaRequest('GET', '/v1.0/token?grant_type=1');
  if (!result?.access_token) throw new Error('Tuya tidak mengembalikan access token.');
  tokenCache = {
    value: result.access_token,
    expiresAt: Date.now() + Number(result.expire_time || 3600) * 1000
  };
  return tokenCache.value;
}

async function authenticatedRequest(method, requestPath, body) {
  const token = await getAccessToken();
  try {
    return await tuyaRequest(method, requestPath, body, token);
  } catch (error) {
    if (error.status !== 401 && error.code !== 1004) throw error;
    tokenCache = null;
    return tuyaRequest(method, requestPath, body, await getAccessToken());
  }
}

function metricValue(status, codeName, factorName) {
  const code = process.env[codeName];
  if (!code) return null;
  const point = status.find(item => item.code === code);
  if (!point || !Number.isFinite(Number(point.value))) return null;
  const factor = Number(process.env[factorName] || 1);
  return Number.isFinite(factor) ? Number(point.value) * factor : null;
}

async function getDeviceOnline(deviceId) {
  if (deviceOnlineCache?.deviceId === deviceId && deviceOnlineCache.expiresAt > Date.now()) {
    return { online: deviceOnlineCache.online, error: deviceOnlineCache.error };
  }
  const errors = [];
  for (const requestPath of [
    `/v1.0/iot-02/devices/${encodeURIComponent(deviceId)}`,
    `/v1.0/devices/${encodeURIComponent(deviceId)}`
  ]) {
    try {
      const details = await authenticatedRequest('GET', requestPath);
      if (typeof details?.online === 'boolean') {
        deviceOnlineCache = { deviceId, online: details.online, error: null, expiresAt: Date.now() + 30000 };
        return { online: details.online, error: null };
      }
      errors.push('Properti online tidak tersedia pada detail perangkat Tuya.');
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  const message = errors.join('; ');
  console.warn('Status online perangkat tidak dapat diverifikasi dari Tuya.', message);
  deviceOnlineCache = { deviceId, online: null, error: message, expiresAt: Date.now() + 30000 };
  return { online: null, error: message };
}

function parseSwitch(value) {
  if (value === true || value === 1 || value === 'true' || value === 'on') return true;
  if (value === false || value === 0 || value === 'false' || value === 'off') return false;
  return null;
}

async function getDeviceStatus() {
  const settings = config();
  const result = await authenticatedRequest(
    'GET',
    `/v1.0/iot-03/devices/${encodeURIComponent(settings.deviceId)}/status`
  );
  if (!Array.isArray(result)) throw new Error('Format status perangkat dari Tuya tidak dikenali.');
  const switchPoint = result.find(item => item.code === settings.switchCode);
  if (!switchPoint) throw new Error(`Data point sakelar "${settings.switchCode}" tidak ditemukan. Periksa TUYA_SWITCH_DP.`);
  const { online: deviceOnline, error: deviceOnlineError } = await getDeviceOnline(settings.deviceId);
  return {
    breakerOn: parseSwitch(switchPoint.value),
    deviceOnline,
    deviceOnlineError,
    availableDpCodes: result.map(item => item.code).filter(code => typeof code === 'string'),
    values: {
      voltage: metricValue(result, 'TUYA_VOLTAGE_DP', 'TUYA_VOLTAGE_FACTOR'),
      current: metricValue(result, 'TUYA_CURRENT_DP', 'TUYA_CURRENT_FACTOR'),
      power: metricValue(result, 'TUYA_POWER_DP', 'TUYA_POWER_FACTOR'),
      energy: metricValue(result, 'TUYA_ENERGY_DP', 'TUYA_ENERGY_FACTOR'),
      temperature: metricValue(result, 'TUYA_TEMPERATURE_DP', 'TUYA_TEMPERATURE_FACTOR')
    }
  };
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 2048) reject(new Error('Request terlalu besar.'));
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error('JSON request tidak valid.'));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    sendJson(res, 400, { error: 'Path tidak valid.' });
    return;
  }
  const relativePath = (decodedPath === '/' ? 'index.html' : decodedPath.replace(/^\/+/, ''));
  const filePath = path.resolve(ROOT, relativePath);
  const fromRoot = path.relative(ROOT, filePath);
  const allowed = fromRoot && !fromRoot.startsWith('..') &&
    (['index.html', 'styles.css', 'app.js', 'manifest.webmanifest', 'sw.js', 'supabase-config.js', 'supabase-client.js'].includes(fromRoot) || fromRoot.startsWith(`assets${path.sep}`));
  if (!allowed) {
    sendJson(res, 404, { error: 'Tidak ditemukan.' });
    return;
  }
  fs.readFile(filePath, (error, contents) => {
    if (error) {
      sendJson(res, 404, { error: 'Tidak ditemukan.' });
      return;
    }
    res.writeHead(200, {
      'content-type': MIME_TYPES[path.extname(filePath)] || 'application/octet-stream',
      'cache-control': filePath.endsWith('sw.js') ? 'no-cache' : 'no-store',
      'x-content-type-options': 'nosniff'
    });
    res.end(req.method === 'HEAD' ? undefined : contents);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'GET' && url.pathname === '/api/health') {
      sendJson(res, 200, { ok: true });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/config') {
      sendJson(res, 200, { configured: isConfigured() });
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      if (!isConfigured()) {
        sendJson(res, 503, { error: 'Konfigurasi Tuya belum lengkap. Isi file .env.' });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/status') {
        sendJson(res, 200, await getDeviceStatus());
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/switch') {
        const origin = req.headers.origin;
        if (origin && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}`) {
          sendJson(res, 403, { error: 'Origin tidak diizinkan.' });
          return;
        }
        const body = await readJsonBody(req);
        if (typeof body.on !== 'boolean') {
          sendJson(res, 400, { error: 'Field "on" harus bernilai boolean.' });
          return;
        }
        const settings = config();
        const result = await authenticatedRequest(
          'POST',
          `/v1.0/iot-03/devices/${encodeURIComponent(settings.deviceId)}/commands`,
          { commands: [{ code: settings.switchCode, value: body.on }] }
        );
        sendJson(res, 200, { ok: true, requestedOn: body.on, result });
        return;
      }
      sendJson(res, 404, { error: 'Endpoint API tidak ditemukan.' });
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { error: 'Method tidak diizinkan.' });
      return;
    }
    serveStatic(req, res, url.pathname);
  } catch (error) {
    const causeCode = error.cause?.code;
    if (error.message === 'fetch failed' && causeCode) {
      sendJson(res, 502, { error: `Koneksi ke Tuya gagal (${causeCode}).` });
      return;
    }
    sendJson(res, 502, { error: error.message || 'Permintaan Tuya gagal.' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`VoltGuard berjalan di http://localhost:${PORT}`);
  if (!isConfigured()) console.log('Mode demo: isi konfigurasi Tuya di .env untuk mengaktifkan koneksi.');
});
