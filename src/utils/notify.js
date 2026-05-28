import { Platform } from 'react-native';
import { showToast } from './toastBus';

let notificationRef = null;

export function setNotificationRef(ref) {
  notificationRef = ref;
}

export function notifySuccess(message, title = 'Success') {
  if (Platform.OS === 'android' && notificationRef) {
    notificationRef.show(title, message, 'success');
    return;
  }
  const ok = showToast({ type: 'success', title, message });
  if (!ok && Platform.OS !== 'android') {
    console.log(`✅ ${title}: ${message}`);
  }
}

export function notifyError(message, title = 'Error') {
  if (Platform.OS === 'android' && notificationRef) {
    notificationRef.show(title, message, 'error');
    return;
  }
  const ok = showToast({ type: 'error', title, message });
  if (!ok && Platform.OS !== 'android') {
    console.log(`❌ ${title}: ${message}`);
  }
}

export function notifyInfo(message, title = 'Info') {
  if (Platform.OS === 'android' && notificationRef) {
    notificationRef.show(title, message, 'info');
    return;
  }
  const ok = showToast({ type: 'info', title, message });
  if (!ok && Platform.OS !== 'android') {
    console.log(`ℹ️ ${title}: ${message}`);
  }
}
