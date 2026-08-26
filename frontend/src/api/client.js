const AUTH_API_URL = import.meta.env.VITE_AUTH_API_URL || '/api/auth';
const TASK_API_URL = import.meta.env.VITE_TASK_API_URL || '/api/tasks';

let accessToken = null;
export function setAccessToken(token) {
  accessToken = token;
}

async function request(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ? JSON.stringify(body.error) : `Request failed: ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export const authApi = {
  register: (email, password, displayName) =>
    request(`${AUTH_API_URL}/register`, { method: 'POST', body: JSON.stringify({ email, password, displayName }) }),
  login: (email, password) =>
    request(`${AUTH_API_URL}/login`, { method: 'POST', body: JSON.stringify({ email, password }) }),
  refresh: (refreshToken) =>
    request(`${AUTH_API_URL}/refresh`, { method: 'POST', body: JSON.stringify({ refreshToken }) }),
  me: () => request(`${AUTH_API_URL}/me`),
  logout: (refreshToken) =>
    request(`${AUTH_API_URL}/logout`, { method: 'POST', body: JSON.stringify({ refreshToken }) }),
};

export const taskApi = {
  list: (teamId) => request(`${TASK_API_URL}?teamId=${encodeURIComponent(teamId)}`),
  create: (payload) => request(TASK_API_URL, { method: 'POST', body: JSON.stringify(payload) }),
  update: (id, payload) => request(`${TASK_API_URL}/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  remove: (id) => request(`${TASK_API_URL}/${id}`, { method: 'DELETE' }),
};
