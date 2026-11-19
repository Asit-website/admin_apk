import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Alert,
  StyleSheet,
  Image,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { sendOtp, verifyOtp, getLatestOtpForPhone } from '../config/api';
import { notifyError, notifyInfo, notifySuccess } from '../utils/notify';

const ADMIN_ROLES = ['admin', 'superadmin', 'channel_partner'];

const isAdminRole = (role) => ADMIN_ROLES.includes(String(role || '').toLowerCase());

const showNotAdminMessage = () => {
  const message = 'You are not an admin';
  if (Platform.OS === 'web') {
    window.alert(message);
  } else {
    Alert.alert('Access Denied', message, [{ text: 'OK' }]);
  }
};

export default function OTPScreen({ route, navigation }) {
  const { phone, otp } = route.params || {};
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const inputRef = useRef(null);
  const autoFillTimerRef = useRef(null);

  const animateAutoFill = (otpStr) => {
    try { if (autoFillTimerRef.current) clearInterval(autoFillTimerRef.current); } catch { }
    const text = String(otpStr || '').replace(/[^0-9]/g, '').slice(0, 6);
    if (!text) return;
    setCode('');
    let i = 0;
    autoFillTimerRef.current = setInterval(() => {
      i += 1;
      setCode(text.slice(0, i));
      if (i >= text.length) {
        try { clearInterval(autoFillTimerRef.current); } catch { }
        autoFillTimerRef.current = null;
      }
    }, 90);
  };

  useEffect(() => {
    const t = setTimeout(() => {
      inputRef.current?.focus?.();
    }, 250);
    return () => clearTimeout(t);
  }, []);

  // Web autofill
  useEffect(() => {
    let active = true;
    let timer = null;
    if (Platform.OS === 'web' && phone) {
      timer = setTimeout(async () => {
        try {
          const res = await getLatestOtpForPhone(phone);
          if (active && res?.otp) animateAutoFill(String(res.otp));
        } catch { }
      }, 2200);
    }
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      try { if (autoFillTimerRef.current) clearInterval(autoFillTimerRef.current); } catch { }
      autoFillTimerRef.current = null;
    };
  }, [phone]);

  // Database OTP polling (works on all platforms including Android)
  useEffect(() => {
    let active = true;
    let timer = null;
    let attempts = 0;
    const maxAttempts = 20;

    const fetchOtpFromDatabase = async () => {
      try {
        if (!phone || !active) return;
        const response = await getLatestOtpForPhone(phone);
        if (response?.success && response?.otp && active) {
          const otpStr = String(response.otp).replace(/[^0-9]/g, '').slice(0, 6);
          if (otpStr.length === 6) {
            animateAutoFill(otpStr);
            attempts = maxAttempts;
            return;
          }
        }
        attempts++;
        if (attempts < maxAttempts && active) {
          timer = setTimeout(fetchOtpFromDatabase, 6000);
        }
      } catch (error) {
        attempts++;
        if (attempts < maxAttempts && active) {
          timer = setTimeout(fetchOtpFromDatabase, 6000);
        }
      }
    };

    if (phone) {
      timer = setTimeout(fetchOtpFromDatabase, 3000);
    }

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [phone]);

  const digits = Array.from({ length: 6 }).map((_, i) => code[i] || '');

  const handleVerify = async () => {
    if (code.trim().length < 6) {
      notifyInfo('Please enter the 6-digit OTP.');
      return;
    }
    setLoading(true);
    try {
      const res = await verifyOtp(phone, code.trim());
      console.log('[OTP] verify response:', JSON.stringify(res));

      if (res?.success) {
        if (res?.requireSelection) {
          const adminOrganizations = (res.organizations || []).filter(org => isAdminRole(org?.role));

          if (adminOrganizations.length === 0) {
            await AsyncStorage.removeItem('auth_token');
            await AsyncStorage.removeItem('user');
            await AsyncStorage.removeItem('orgId');
            await AsyncStorage.removeItem('orgData');
            setLoading(false);
            showNotAdminMessage();
            return;
          }

          setLoading(false);
          navigation.navigate('SelectOrg', {
            organizations: adminOrganizations,
            phone: phone,
            code: code.trim(),
          });
          return;
        }

        const role = res?.user?.role || '';
        console.log('[OTP] user role:', role);

        if (!isAdminRole(role)) {
          await AsyncStorage.removeItem('auth_token');
          await AsyncStorage.removeItem('user');
          await AsyncStorage.removeItem('orgId');
          await AsyncStorage.removeItem('orgData');
          setLoading(false);
          showNotAdminMessage();
          return;
        }

        // Block ONLY pure 'staff' role — admins have roles like:
        // 'admin', 'superadmin', 'superadmin_staff', 'owner', etc.
        const blockedRoles = ['staff'];
        if (blockedRoles.includes(role)) {
          await AsyncStorage.removeItem('auth_token');
          await AsyncStorage.removeItem('user');
          setLoading(false);
          if (Platform.OS === 'web') {
            window.alert('Access Denied ❌\n\nYou are not an Admin.\nStaff members must use the employee app (Vetansutra).');
          } else {
            Alert.alert(
              'Access Denied ❌',
              'You are not an Admin.\n\nStaff members must use the employee app.',
              [{ text: 'OK' }]
            );
          }
          return;
        }

        // Store org info for org-based API calls
        if (res?.user?.orgId) {
          await AsyncStorage.setItem('orgId', String(res.user.orgId));
        }
        if (res?.user?.org) {
          await AsyncStorage.setItem('orgData', JSON.stringify(res.user.org));
        }

        console.log('[OTP] navigating to Dashboard...');
        // Direct navigation — no setTimeout, no silent catch
        navigation.reset({ index: 0, routes: [{ name: 'Dashboard' }] });

      } else {
        const msg = res?.message || 'Invalid OTP. Please try again.';
        if (Platform.OS === 'web') {
          window.alert(msg);
        } else {
          Alert.alert('Error', msg);
        }
      }
    } catch (err) {
      console.log('[OTP] error:', err);
      const msg = err.response?.data?.message || 'Unable to verify OTP. Please try again.';
      if (Platform.OS === 'web') {
        window.alert(msg);
      } else {
        Alert.alert('Error', msg);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setResendLoading(true);
    try {
      const res = await sendOtp(phone);
      notifySuccess('OTP has been sent successfully.');
    } catch (e) {
      notifyError('Unable to resend OTP. Please try again.');
    } finally {
      setResendLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.container}>
        <View style={styles.topArea}>
          <Image
            source={{ uri: 'https://res.cloudinary.com/dgif730br/image/upload/v1771585917/Screenshot_8880_nmyxse.png' }}
            style={styles.logo}
          />
          <Text style={styles.adminBadge}>Admin Panel</Text>
        </View>

        <View style={styles.middleArea}>
          <Text style={styles.title}>Enter 6 digit pin</Text>

          {otp ? <Text style={styles.devOtp}>OTP: {String(otp)}</Text> : null}

          <TouchableOpacity style={styles.otpRow} activeOpacity={1} onPress={() => inputRef.current?.focus?.()}>
            {digits.map((d, idx) => (
              <View key={idx} style={[styles.otpBox, idx === 0 ? null : styles.otpBoxSpacing]}>
                <Text style={styles.otpDigit}>{d}</Text>
              </View>
            ))}

            <TextInput
              ref={inputRef}
              value={code}
              onChangeText={(t) => setCode((t || '').replace(/[^0-9]/g, '').slice(0, 6))}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoFocus={false}
              caretHidden
              selectionColor="transparent"
              underlineColorAndroid="transparent"
              style={styles.hiddenInput}
              maxLength={6}
            />
          </TouchableOpacity>

          <View style={styles.resendRow}>
            <Text style={styles.small}>Having any issue?</Text>
            <TouchableOpacity onPress={handleResend} disabled={resendLoading}>
              <Text style={styles.resend}>{resendLoading ? 'Sending...' : 'Send again'}</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.footerFixed}>
          <TouchableOpacity style={styles.primaryBtn} onPress={handleVerify} disabled={loading} activeOpacity={0.85}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Verify</Text>}
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#ffffff' },
  container: { flex: 1, paddingHorizontal: 20, paddingTop: 24 },

  topArea: { alignItems: 'center', paddingTop: 40 },
  logo: { width: 250, height: 100, resizeMode: 'contain' },
  adminBadge: {
    marginTop: 8,
    backgroundColor: '#0F3B8C',
    color: '#FFFFFF',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    paddingHorizontal: 16,
    paddingVertical: 4,
    borderRadius: 20,
    overflow: 'hidden',
  },

  middleArea: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: { color: '#515151', fontFamily: 'Inter_600SemiBold', fontSize: 16, marginBottom: 16 },
  devOtp: { color: '#9CA3AF', fontFamily: 'Inter_400Regular', fontSize: 11, marginBottom: 10 },

  otpRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', position: 'relative' },
  otpBox: {
    width: 45,
    height: 42,
    borderWidth: 1,
    borderColor: '#0F3B8C',
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  otpBoxSpacing: { marginLeft: 8 },
  otpDigit: { color: '#111827', fontFamily: 'Inter_500Medium', fontSize: 14 },

  hiddenInput: {
    position: 'absolute',
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    opacity: 0,
    zIndex: 10,
    outlineStyle: 'none',
    outlineWidth: 0,
  },

  resendRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 14 },
  small: { color: '#363535', marginRight: 6, fontFamily: 'Inter_400Regular', fontSize: 10 },
  resend: { color: '#184181', fontFamily: 'Inter_500Medium', fontSize: 11 },

  footerFixed: { marginTop: 20, marginBottom: 30, alignItems: 'center', paddingHorizontal: 20 },
  primaryBtn: { width: '100%', maxWidth: 320, backgroundColor: '#0F3B8C', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  primaryText: { color: '#FFFFFF', fontFamily: 'Inter_600SemiBold', fontSize: 14 },
});
