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

// Request interceptor to add token
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
    config.headers['X-App-Platform'] = 'admin-apk';
    config.headers['Content-Type'] = 'application/json';
    config.headers['Accept'] = 'application/json';
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor - do NOT clear token on 401
// Clearing token on 401 causes logout when any API fails
// Token should only be cleared on explicit logout
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    console.log('[API] Error:', error.response?.status, error.config?.url);
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

export async function verifyOtp(phone, code, orgId) {
  const resp = await api.post('/auth/verify-otp', { phone, code, orgId });
  const data = resp.data;
  if (data?.success && data?.token) {
    await AsyncStorage.setItem('auth_token', String(data.token));
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
