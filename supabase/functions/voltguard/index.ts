import { createClient } from 'npm:@supabase/supabase-js@2';

const encoder = new TextEncoder();
const regions: Record<string, string> = {
  us: 'https://openapi.tuyaus.com',
  eu: 'https://openapi.tuyaeu.com',
  cn: 'https://openapi.tuyacn.com',
  in: 'https://openapi.tuyain.com',
  sg: 'https://openapi-sg.iotbing.com'
};

let tokenCache: { value: string; expiresAt: number } | null = null;
let deviceOnlineCache: { deviceId: string; online: boolean | null; error: string | null; expiresAt: number } | null = null;

function env(name: string): string {
  return Deno.env.get(name)?.trim() ?? '';
}

function allowedOrigins(): string[] {
  return env('APP_ORIGINS').split(',').map(origin => origin.trim()).filter(Boolean);
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info, x-supabase-api-version',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-max-age': '86400',
    'vary': 'Origin'
  };
}

function jsonResponse(origin: string, status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { ...corsHeaders(origin), 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

function bytesToHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256(value: string): Promise<string> {
  return bytesToHex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

async function signRequest(method: string, requestPath: string, body: unknown, accessToken = '') {
  const timestamp = Date.now().toString();
  const nonce = crypto.randomUUID().replaceAll('-', '');
  const bodyText = body ? JSON.stringify(body) : '';
  const stringToSign = `${method}\n${await sha256(bodyText)}\n\n${requestPath}`;
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(env('TUYA_ACCESS_SECRET')),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(`${env('TUYA_ACCESS_ID')}${accessToken}${timestamp}${nonce}${stringToSign}`)
  );
  return {
    client_id: env('TUYA_ACCESS_ID'),
    t: timestamp,
    nonce,
    sign_method: 'HMAC-SHA256',
    sign: bytesToHex(signature).toUpperCase()
  };
}

async function tuyaRequest(method: string, requestPath: string, body?: unknown, accessToken = '') {
  const region = env('TUYA_REGION').toLowerCase();
  const endpoint = regions[region];
  if (!endpoint) throw new Error('Region Tuya tidak valid.');
  const headers: Record<string, string> = await signRequest(method, requestPath, body, accessToken);
  if (accessToken) headers.access_token = accessToken;
  if (body) headers['content-type'] = 'application/json';
  const response = await fetch(`${endpoint}${requestPath}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000)
  });
  let result: any;
  try {
    result = await response.json();
  } catch {
    throw new Error(`Respons Tuya tidak valid (HTTP ${response.status}).`);
  }
  if (!response.ok || !result?.success) {
    const error = new Error(result?.msg || `Tuya API merespons HTTP ${response.status}.`);
    Object.assign(error, { status: response.status, code: result?.code });
    throw error;
  }
  return result.result;
}

async function getAccessToken(): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60000) return tokenCache.value;
  const result = await tuyaRequest('GET', '/v1.0/token?grant_type=1');
  if (!result?.access_token) throw new Error('Tuya tidak mengembalikan access token.');
  tokenCache = {
    value: result.access_token,
    expiresAt: Date.now() + Number(result.expire_time || 3600) * 1000
  };
  return tokenCache.value;
}

async function authenticatedTuyaRequest(method: string, requestPath: string, body?: unknown) {
  const token = await getAccessToken();
  try {
    return await tuyaRequest(method, requestPath, body, token);
  } catch (error) {
    const failure = error as Error & { status?: number; code?: number };
    if (failure.status !== 401 && failure.code !== 1004) throw error;
    tokenCache = null;
    return tuyaRequest(method, requestPath, body, await getAccessToken());
  }
}

function metricValue(status: Array<{ code: string; value: unknown }>, codeName: string, factorName: string) {
  const code = env(codeName);
  if (!code) return null;
  const point = status.find(item => item.code === code);
  if (!point || !Number.isFinite(Number(point.value))) return null;
  const factor = Number(env(factorName) || 1);
  return Number.isFinite(factor) ? Number(point.value) * factor : null;
}

async function getDeviceOnline(deviceId: string): Promise<{ online: boolean | null; error: string | null }> {
  if (deviceOnlineCache?.deviceId === deviceId && deviceOnlineCache.expiresAt > Date.now()) {
    return { online: deviceOnlineCache.online, error: deviceOnlineCache.error };
  }
  const errors: string[] = [];
  for (const requestPath of [
    `/v1.0/iot-02/devices/${encodeURIComponent(deviceId)}`,
    `/v1.0/devices/${encodeURIComponent(deviceId)}`
  ]) {
    try {
      const details = await authenticatedTuyaRequest('GET', requestPath);
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

async function getDeviceStatus() {
  const deviceId = env('TUYA_DEVICE_ID');
  if (!deviceId) throw new Error('Device ID Tuya belum dikonfigurasi.');
  const result = await authenticatedTuyaRequest(
    'GET',
    `/v1.0/iot-03/devices/${encodeURIComponent(deviceId)}/status`
  );
  if (!Array.isArray(result)) throw new Error('Format status perangkat Tuya tidak dikenali.');
  const switchPoint = result.find((item: { code?: string }) => item.code === (env('TUYA_SWITCH_DP') || 'switch'));
  if (!switchPoint) throw new Error('DP sakelar tidak ditemukan. Periksa TUYA_SWITCH_DP.');
  const { online: deviceOnline, error: deviceOnlineError } = await getDeviceOnline(deviceId);
  const breakerOn = switchPoint.value === true || switchPoint.value === 1 ||
    switchPoint.value === 'true' || switchPoint.value === 'on'
    ? true
    : switchPoint.value === false || switchPoint.value === 0 ||
      switchPoint.value === 'false' || switchPoint.value === 'off'
      ? false
      : null;
  return {
    breakerOn,
    deviceOnline,
    deviceOnlineError,
    availableDpCodes: result.map((item: { code?: unknown }) => item.code).filter((code: unknown): code is string => typeof code === 'string'),
    values: {
      voltage: metricValue(result, 'TUYA_VOLTAGE_DP', 'TUYA_VOLTAGE_FACTOR'),
      current: metricValue(result, 'TUYA_CURRENT_DP', 'TUYA_CURRENT_FACTOR'),
      power: metricValue(result, 'TUYA_POWER_DP', 'TUYA_POWER_FACTOR'),
      energy: metricValue(result, 'TUYA_ENERGY_DP', 'TUYA_ENERGY_FACTOR'),
      temperature: metricValue(result, 'TUYA_TEMPERATURE_DP', 'TUYA_TEMPERATURE_FACTOR')
    }
  };
}

async function handleRequest(req: Request): Promise<Response> {
  const origin = req.headers.get('origin') ?? '';
  const origins = allowedOrigins();
  if (!origin || !origins.includes(origin)) {
    return new Response('Origin tidak diizinkan.', { status: 403 });
  }
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) });
  if (req.method !== 'POST') return jsonResponse(origin, 405, { error: 'Method tidak diizinkan.' });

  try {
    const body = await req.json();
    if (body?.action === 'status') return jsonResponse(origin, 200, await getDeviceStatus());
    if (body?.action !== 'switch') return jsonResponse(origin, 400, { error: 'Aksi tidak dikenali.' });
    if (typeof body.on !== 'boolean') return jsonResponse(origin, 400, { error: 'Nilai sakelar tidak valid.' });

    const supabaseUrl = env('SUPABASE_URL');
    const supabaseAnonKey = env('SUPABASE_ANON_KEY');
    const allowedUserId = env('ALLOWED_USER_ID');
    if (!supabaseUrl || !supabaseAnonKey || !allowedUserId) {
      return jsonResponse(origin, 503, { error: 'Autentikasi backend belum dikonfigurasi.' });
    }

    const authorization = req.headers.get('authorization') ?? '';
    const accessToken = authorization.replace(/^Bearer\s+/i, '');
    if (!accessToken) return jsonResponse(origin, 401, { error: 'Login diperlukan untuk mengontrol perangkat.' });
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data: { user }, error: authError } = await supabase.auth.getUser(accessToken);
    if (authError || !user || user.id !== allowedUserId) {
      return jsonResponse(origin, 403, { error: 'Akun ini tidak diizinkan mengontrol perangkat.' });
    }

    const deviceId = env('TUYA_DEVICE_ID');
    if (!deviceId) throw new Error('Device ID Tuya belum dikonfigurasi.');
    const result = await authenticatedTuyaRequest(
      'POST',
      `/v1.0/iot-03/devices/${encodeURIComponent(deviceId)}/commands`,
      { commands: [{ code: env('TUYA_SWITCH_DP') || 'switch', value: body.on }] }
    );
    return jsonResponse(origin, 200, { ok: true, requestedOn: body.on, result });
  } catch (error) {
    const failure = error as Error & { cause?: { code?: string } };
    const causeCode = failure.cause?.code;
    const message = failure.message === 'fetch failed' && causeCode
      ? `Koneksi ke Tuya gagal (${causeCode}).`
      : failure.message || 'Permintaan Tuya gagal.';
    return jsonResponse(origin, 502, { error: message });
  }
}

Deno.serve(handleRequest);
