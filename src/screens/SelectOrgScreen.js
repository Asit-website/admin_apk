import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Platform,
  Image,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { verifyOtp, switchAccount } from '../config/api';
import { Ionicons } from '@expo/vector-icons';

const ADMIN_ROLES = ['admin', 'superadmin', 'channel_partner'];
const isAdminRole = (role) => ADMIN_ROLES.includes(String(role || '').toLowerCase());

const showNotAdminMessage = () => {
  const message = 'You are not an admin';
  if (Platform.OS === 'web') {
    window.alert(message);
  } else {
    alert(message);
  }
};

export default function SelectOrgScreen({ route, navigation }) {
  const { organizations = [], phone, code } = route.params || {};
  const [loadingId, setLoadingId] = useState(null);

  const handleSelect = async (org) => {
    if (loadingId) return;
    if (!isAdminRole(org?.role)) {
      await AsyncStorage.removeItem('auth_token');
      await AsyncStorage.removeItem('user');
      await AsyncStorage.removeItem('orgId');
      await AsyncStorage.removeItem('orgData');
      showNotAdminMessage();
      navigation.navigate('Login');
      return;
    }
    setLoadingId(org.id);
    try {
      // Prefer switch-account if token already exists (avoids re-using consumed OTP)
      const existingToken = await AsyncStorage.getItem('auth_token');
      let res;
      if (existingToken) {
        res = await switchAccount(org.id, org.isSuperadminPanel);
      } else if (code) {
        res = await verifyOtp(phone, code, org.id === null ? 'null' : org.id, org.isSuperadminPanel);
      } else {
        throw new Error('No active session. Please login again.');
      }

      if (res?.success) {
        if (!isAdminRole(res?.user?.role)) {
          await AsyncStorage.removeItem('auth_token');
          await AsyncStorage.removeItem('user');
          await AsyncStorage.removeItem('orgId');
          await AsyncStorage.removeItem('orgData');
          showNotAdminMessage();
          navigation.navigate('Login');
          return;
        }

        if (res?.user?.orgId) {
          await AsyncStorage.setItem('orgId', String(res.user.orgId));
        }
        if (res?.user?.org) {
          await AsyncStorage.setItem('orgData', JSON.stringify(res.user.org));
        }
        navigation.reset({ index: 0, routes: [{ name: 'Dashboard' }] });
      } else {
        if (Platform.OS === 'web') {
          window.alert(res?.message || 'Verification failed');
        } else {
          alert(res?.message || 'Verification failed');
        }
      }
    } catch (err) {
      const msg = err.response?.data?.message || err.message || 'Unable to select organization. Please try again.';
      if (Platform.OS === 'web') {
        window.alert(msg);
      } else {
        alert(msg);
      }
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <View style={styles.screen}>
      <View style={styles.container}>
        <View style={styles.topArea}>
          <Image
            source={{ uri: 'https://res.cloudinary.com/dgif730br/image/upload/v1771585917/Screenshot_8880_nmyxse.png' }}
            style={styles.logo}
          />
          <Text style={styles.adminBadge}>Admin Panel</Text>
        </View>

        <View style={styles.headerBox}>
          <Text style={styles.title}>Select Workspace</Text>
          <Text style={styles.subtitle}>Multiple accounts found for +91 {phone}. Choose one to continue.</Text>
        </View>

        <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          {organizations.map((org, idx) => {
            const isLoading = loadingId === org.id;
            return (
              <TouchableOpacity
                key={org.id || idx}
                style={styles.card}
                onPress={() => handleSelect(org)}
                activeOpacity={0.8}
                disabled={!!loadingId}
              >
                <View style={styles.cardLeft}>
                  <View style={styles.iconBg}>
                    <Ionicons name="business" size={22} color="#0F3B8C" />
                  </View>
                  <View style={styles.cardInfo}>
                    <Text style={styles.orgName} numberOfLines={1}>{org.name || 'Organization'}</Text>
                    <Text style={styles.roleLabel}>{String(org.role || 'admin').toUpperCase()}</Text>
                  </View>
                </View>

                <View style={styles.cardRight}>
                  {isLoading ? (
                    <ActivityIndicator size="small" color="#0F3B8C" />
                  ) : (
                    <Ionicons name="arrow-forward" size={18} color="#9CA3AF" />
                  )}
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.navigate('Login')}
          activeOpacity={0.8}
        >
          <Ionicons name="arrow-back-outline" size={16} color="#4B5563" />
          <Text style={styles.backText}>Use different number</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F8FAFD' },
  container: { flex: 1, paddingHorizontal: 24, paddingTop: 20 },

  topArea: { alignItems: 'center', marginVertical: 20 },
  logo: { width: 200, height: 75, resizeMode: 'contain' },
  adminBadge: {
    marginTop: 4,
    backgroundColor: '#0F3B8C',
    color: '#FFFFFF',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 10,
    paddingHorizontal: 12,
    paddingVertical: 3,
    borderRadius: 20,
    overflow: 'hidden',
  },

  headerBox: { alignItems: 'center', marginBottom: 20, marginTop: 10 },
  title: { color: '#111827', fontFamily: 'Inter_700Bold', fontSize: 22, textAlign: 'center' },
  subtitle: { color: '#6B7280', fontFamily: 'Inter_400Regular', fontSize: 13, textAlign: 'center', marginTop: 8, paddingHorizontal: 10 },

  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 30 },

  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E5E9F0',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
  },
  cardLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 12 },
  iconBg: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  cardInfo: { flex: 1 },
  orgName: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#1F2937' },
  roleLabel: { fontSize: 10, fontFamily: 'Inter_700Bold', color: '#3B82F6', marginTop: 4 },

  cardRight: { width: 30, alignItems: 'center' },

  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: '#EFF1F5',
    marginBottom: 20,
  },
  backText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: '#4B5563' },
});
