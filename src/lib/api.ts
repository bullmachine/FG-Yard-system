export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

export function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const token = localStorage.getItem('token');
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

export function getToken(): string | null {
  return localStorage.getItem('token');
}

export function buildSocketUrl(path: string): string {
  let base = API_URL.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
  if (base.startsWith('/')) {
    const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    base = `${scheme}//${window.location.host}${base}`;
  }
  return `${base}${path}`;
}
