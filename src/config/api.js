import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

const API_BASE_URL = __DEV__
  ? 'http://localhost:4000'
  : 'https://backend.vetansutra.com';

export { API_BASE_URL };

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
});

api.interceptors.request.use(
  async (config) => {
    const token = await AsyncStorage.getItem('auth_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    // Attach orgId for org-based data isolation
    const orgId = await AsyncStorage.getItem('orgId');
    if (orgId) {
      config.headers['X-Org-Id'] = orgId;
    }

    // Zero Trust device fingerprint generation and injection
    let deviceFingerprint = await AsyncStorage.getItem('device_fingerprint');
    if (!deviceFingerprint) {
      const chars = 'abcdef0123456789';
      let hex = '';
      for (let i = 0; i < 32; i++) {
        hex += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      deviceFingerprint = hex;
      await AsyncStorage.setItem('device_fingerprint', deviceFingerprint);
    }
    config.headers['x-device-fingerprint'] = deviceFingerprint;

    config.headers['X-App-Platform'] = 'admin-apk';
    config.headers['Content-Type'] = 'application/json';
    config.headers['Accept'] = 'application/json';
    return config;
  },
  (error) => Promise.reject(error)
);

// Background refresh queue handling
let isRefreshing = false;
let failedQueue = [];

const processQueue = (error, token = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

// Response interceptor - handle automatic transparent token refresh on 401
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    console.log('[API] Error:', error.response?.status, error.config?.url);
    const originalRequest = error.config;

    // Trigger refresh only on 401 Unauthorized errors and if it's not a retry already
    if (error.response?.status === 401 && !originalRequest._retry) {
      // If the refresh endpoint itself failed, clear credentials
      if (originalRequest.url && originalRequest.url.includes('/auth/refresh-mobile')) {
        await AsyncStorage.removeItem('auth_token');
        await AsyncStorage.removeItem('refresh_token');
        await AsyncStorage.removeItem('user');
        return Promise.reject(error);
      }

      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then((token) => {
            originalRequest.headers.Authorization = `Bearer ${token}`;
            return api(originalRequest);
          })
          .catch((err) => Promise.reject(err));
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const storedRefreshToken = await AsyncStorage.getItem('refresh_token');
        if (!storedRefreshToken) {
          throw new Error('Refresh token missing');
        }

        // Call mobile refresh endpoint
        const resp = await axios.post(`${API_BASE_URL}/auth/refresh-mobile`, {
          refreshToken: storedRefreshToken
        });

        const { token, refreshToken } = resp.data;

        await AsyncStorage.setItem('auth_token', String(token));
        await AsyncStorage.setItem('refresh_token', String(refreshToken));

        originalRequest.headers.Authorization = `Bearer ${token}`;

        processQueue(null, token);
        return api(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        await AsyncStorage.removeItem('auth_token');
        await AsyncStorage.removeItem('refresh_token');
        await AsyncStorage.removeItem('user');
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }
    return Promise.reject(error);
  }
);

export default api;

// Auth
export async function sendOtp(phone) {
  const resp = await api.post('/auth/send-otp', { phone });
  return resp.data;
}

export async function getLatestOtpForPhone(phone) {
  const resp = await api.get(`/auth/otp/latest?phone=${encodeURIComponent(String(phone))}`);
  return resp.data;
}

export async function verifyOtp(phone, code, orgId, isSuperadminPanel) {
  const resp = await api.post('/auth/verify-otp', { phone, code, orgId, isSuperadminPanel });
  const data = resp.data;
  if (data?.success && data?.token) {
    await AsyncStorage.setItem('auth_token', String(data.token));
    if (data?.refreshToken) {
      await AsyncStorage.setItem('refresh_token', String(data.refreshToken));
    }
    if (data?.user) {
      await AsyncStorage.setItem('user', JSON.stringify(data.user));
    }
  }
  return data;
}

export async function switchAccount(orgId, isSuperadminPanel) {
  const resp = await api.post('/auth/switch-account', {
    orgId: orgId === null ? 'null' : orgId,
    isSuperadminPanel: !!isSuperadminPanel,
  });
  const data = resp.data;
  if (data?.success && data?.token) {
    await AsyncStorage.setItem('auth_token', String(data.token));
    if (data?.refreshToken) {
      await AsyncStorage.setItem('refresh_token', String(data.refreshToken));
    }
    if (data?.user) {
      await AsyncStorage.setItem('user', JSON.stringify(data.user));
    }
  }
  return data;
}

// Dashboard APIs - using actual backend admin routes
export async function getAdminDashboardStats() {
  const resp = await api.get('/admin/dashboard');
  return resp.data;
}

export async function getTodayAttendanceSummary() {
  // /admin/attendance?date=TODAY returns today's attendance records
  const today = new Date().toISOString().split('T')[0];
  const resp = await api.get(`/admin/attendance?date=${today}`);
  return resp.data;
}

export async function getMonthlyAttendanceSummary(month) {
  const qs = month ? `?month=${encodeURIComponent(String(month))}` : '';
  const resp = await api.get(`/admin/attendance/month${qs}`);
  return resp.data;
}

export async function getPresentEmployees() {
  const today = new Date().toISOString().split('T')[0];
  const resp = await api.get(`/admin/attendance?date=${today}&status=present`);
  return resp.data;
}

export async function getAbsentEmployees() {
  const today = new Date().toISOString().split('T')[0];
  const resp = await api.get(`/admin/attendance?date=${today}&status=absent`);
  return resp.data;
}

export async function getLateArrivals() {
  const today = new Date().toISOString().split('T')[0];
  const resp = await api.get(`/admin/attendance?date=${today}&status=late`);
  return resp.data;
}

export async function getEmployeesOnLeave() {
  const today = new Date().toISOString().split('T')[0];
  const resp = await api.get(`/admin/attendance?date=${today}&status=leave`);
  return resp.data;
}

export async function getAllStaff() {
  const resp = await api.get('/admin/staff');
  return resp.data;
}

// Notifications
export async function getAdminNotifications() {
  const resp = await api.get('/admin/notifications');
  return resp.data;
}

export async function markNotificationAsRead(id) {
  const resp = await api.post(`/admin/notifications/${id}/read`);
  return resp.data;
}

export async function markAllNotificationsAsRead() {
  const resp = await api.post('/admin/notifications/read-all');
  return resp.data;
}
