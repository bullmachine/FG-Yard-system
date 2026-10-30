import http from 'http';
import { getSettings } from './settingsService';

/**
 * One call to the SAP data API (zsap_data_api). Every API_TYP (FERT_API, FG_API, UM_API)
 * shares the endpoint, user, password and plant kept with the Material Master settings;
 * only the JSON body changes. PLANT is added here.
 *
 * Uses Node core http directly: built-in fetch (undici) rejects GET requests with a body,
 * while the SAP endpoint requires the params as a raw JSON body (same as Postman).
 */
export async function sapRequest<T>(
  params: Record<string, string>,
  label: string,
  timeoutOverrideMs?: number
): Promise<T[]> {
  const settings = await getSettings();
  const timeoutMs = timeoutOverrideMs ?? settings.materialTimeoutMs;
  const auth = 'Basic ' + Buffer.from(`${settings.materialUsername}:${settings.materialPassword}`).toString('base64');
  const body = JSON.stringify({ ...params, PLANT: settings.materialPlant });
  const parsed = new URL(settings.materialApiUrl);

  const raw = await new Promise<string>((resolve, reject) => {
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || 80,
        path: `${parsed.pathname}${parsed.search}`,
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          Authorization: auth
        }
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(data);
          } else {
            reject(new Error(`${label} API request failed with status ${res.statusCode}: ${data.slice(0, 300)}`));
          }
        });
      }
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`${label} API request timed out after ${timeoutMs}ms`));
    });

    req.on('error', (err) => reject(err));
    req.write(body);
    req.end();
  });

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid ${label} API response: not valid JSON (${raw.slice(0, 200)})`);
  }

  if (!Array.isArray(data)) {
    throw new Error(`Invalid ${label} API response: expected array, got ${JSON.stringify(data).slice(0, 200)}`);
  }

  return data as T[];
}
