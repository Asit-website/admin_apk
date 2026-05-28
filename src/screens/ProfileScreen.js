import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Platform,
  Dimensions,
  Clipboard,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import BottomNav from '../components/BottomNav';
import api from '../config/api';

const { width } = Dimensions.get('window');

export default function ProfileScreen({ navigation }) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [profile, setProfile] = useState(null);
  const [orgData, setOrgData] = useState(null);

  const loadLocalData = async () => {
    try {
      const userStr = await AsyncStorage.getItem('user');
      const orgStr = await AsyncStorage.getItem('orgData');
      if (userStr) {
        const u = JSON.parse(userStr);
        setProfile(prev => ({
          ...prev,
          name: u.name,
          phone: u.phone,
          email: u.email,
          role: u.role,
          ...prev
        }));
      }
      if (orgStr) {
        setOrgData(JSON.parse(orgStr));
      }
    } catch (e) {
      console.log('Error reading local storage:', e);
    }
  };

  const fetchProfile = useCallback(async () => {
    try {
      const res = await api.get('/me/profile');
      if (res?.data?.success && res.data.profile) {
        setProfile(res.data.profile);
        // Sync back to local user storage
        await AsyncStorage.setItem('user', JSON.stringify(res.data.profile));
      }
    } catch (err) {
      console.log('Error fetching user profile:', err);
    }
  }, []);

  const loadAll = async () => {
    setLoading(true);
    await loadLocalData();
    await fetchProfile();
    setLoading(false);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchProfile();
    // Re-load org data just in case
    const orgStr = await AsyncStorage.getItem('orgData');
    if (orgStr) setOrgData(JSON.parse(orgStr));
    setRefreshing(false);
  };

  useEffect(() => {
    loadAll();
  }, []);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      fetchProfile();
    });
    return unsubscribe;
  }, [navigation]);

  const doLogout = async () => {
    await AsyncStorage.removeItem('auth_token');
    await AsyncStorage.removeItem('user');
    await AsyncStorage.removeItem('orgId');
    await AsyncStorage.removeItem('orgData');
    navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
  };

  const handleLogout = () => {
    if (Platform.OS === 'web') {
      if (window.confirm('Are you sure you want to logout?')) {
        doLogout();
      }
    } else {
      Alert.alert(
        'Logout',
        'Are you sure you want to logout?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Logout', style: 'destructive', onPress: doLogout },
        ]
      );
    }
  };

  const copyToClipboard = (text, label) => {
    if (!text) return;
    Clipboard.setString(text);
    if (Platform.OS === 'web') {
      window.alert(`${label} copied to clipboard!`);
    } else {
      Alert.alert('Copied', `${label} copied to clipboard!`);
    }
  };

  if (loading && !refreshing) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator size="large" color="#0F3B8C" />
        <Text style={styles.loadingText}>Loading Profile...</Text>
      </View>
    );
  }

  const initials = profile?.name
    ? profile.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
    : 'AD';

  return (
    <View style={styles.screen}>
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Account & Settings</Text>
        </View>
        <TouchableOpacity style={styles.logoutHeaderBtn} onPress={handleLogout} activeOpacity={0.8}>
          <Ionicons name="power-outline" size={18} color="#DC2626" />
          <Text style={styles.logoutHeaderText}>Logout</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#0F3B8C" />}
      >
        {/* User Large Avatar / Intro */}
        <View style={styles.avatarCard}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <Text style={styles.userName}>{profile?.name || 'Admin User'}</Text>
          <View style={styles.roleBadge}>
            <Text style={styles.roleBadgeText}>
              {String(profile?.role || 'Admin').toUpperCase()}
            </Text>
          </View>
        </View>

        {/* ACCOUNT SETTINGS CARD (Mimics Web Portal settings layout) */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="person-circle-outline" size={20} color="#0F3B8C" style={{ marginRight: 8 }} />
            <Text style={styles.cardTitle}>Account Settings</Text>
          </View>
          <View style={styles.cardContent}>
            {/* Name */}
            <TouchableOpacity 
              style={styles.infoRow}
              onPress={() => copyToClipboard(profile?.name, 'Name')}
              activeOpacity={0.6}
            >
              <View style={styles.infoIconWrap}>
                <Ionicons name="person" size={16} color="#4B5563" />
              </View>
              <View style={styles.infoBody}>
                <Text style={styles.infoLabel}>Name</Text>
                <Text style={styles.infoValue}>{profile?.name || '--'}</Text>
              </View>
              <Ionicons name="copy-outline" size={14} color="#9CA3AF" />
            </TouchableOpacity>

            <View style={styles.divider} />

            {/* Phone */}
            <TouchableOpacity 
              style={styles.infoRow}
              onPress={() => copyToClipboard(profile?.phone, 'Phone Number')}
              activeOpacity={0.6}
            >
              <View style={styles.infoIconWrap}>
                <Ionicons name="call" size={16} color="#4B5563" />
              </View>
              <View style={styles.infoBody}>
                <Text style={styles.infoLabel}>Phone Number</Text>
                <Text style={styles.infoValue}>
                  {profile?.phone ? `+91 ${profile.phone}` : '--'}
                </Text>
              </View>
              <Ionicons name="copy-outline" size={14} color="#9CA3AF" />
            </TouchableOpacity>

            <View style={styles.divider} />

            {/* Email */}
            <TouchableOpacity 
              style={styles.infoRow}
              onPress={() => copyToClipboard(profile?.email, 'Email Address')}
              activeOpacity={0.6}
            >
              <View style={styles.infoIconWrap}>
                <Ionicons name="mail" size={16} color="#4B5563" />
              </View>
              <View style={styles.infoBody}>
                <Text style={styles.infoLabel}>Email Address</Text>
                <Text style={styles.infoValue}>{profile?.email || '--'}</Text>
              </View>
              <Ionicons name="copy-outline" size={14} color="#9CA3AF" />
            </TouchableOpacity>
          </View>
        </View>

        {/* BUSINESS INFO CARD (Mimics Web Portal Business Settings) */}
        {orgData ? (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Ionicons name="business-outline" size={20} color="#0F3B8C" style={{ marginRight: 8 }} />
              <Text style={styles.cardTitle}>Business Info</Text>
            </View>
            <View style={styles.cardContent}>
              {/* Business Name */}
              <View style={styles.infoRowNonClickable}>
                <View style={styles.infoIconWrap}>
                  <Ionicons name="business" size={16} color="#4B5563" />
                </View>
                <View style={styles.infoBody}>
                  <Text style={styles.infoLabel}>Business Name</Text>
                  <Text style={styles.infoValue}>{orgData?.name || 'thinktech'}</Text>
                </View>
              </View>

              {orgData?.city || orgData?.state ? (
                <>
                  <View style={styles.divider} />
                  {/* City & State */}
                  <View style={styles.infoRowNonClickable}>
                    <View style={styles.infoIconWrap}>
                      <Ionicons name="location" size={16} color="#4B5563" />
                    </View>
                    <View style={styles.infoBody}>
                      <Text style={styles.infoLabel}>Business City & State</Text>
                      <Text style={styles.infoValue}>
                        {[orgData?.city, orgData?.state].filter(Boolean).join(', ')}
                      </Text>
                    </View>
                  </View>
                </>
              ) : null}

              {orgData?.address ? (
                <>
                  <View style={styles.divider} />
                  {/* Address */}
                  <View style={styles.infoRowNonClickable}>
                    <View style={styles.infoIconWrap}>
                      <Ionicons name="map" size={16} color="#4B5563" />
                    </View>
                    <View style={styles.infoBody}>
                      <Text style={styles.infoLabel}>Business Address</Text>
                      <Text style={styles.infoValue}>{orgData.address}</Text>
                    </View>
                  </View>
                </>
              ) : null}
            </View>
          </View>
        ) : null}

        {/* Explicit Action Buttons */}
        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.8}>
          <Ionicons name="log-out" size={18} color="#FFFFFF" style={{ marginRight: 8 }} />
          <Text style={styles.logoutText}>Logout Account</Text>
        </TouchableOpacity>

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Bottom Nav Tab */}
      <BottomNav navigation={navigation} activeKey="Profile" />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F4F7FC' },
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F4F7FC' },
  loadingText: { marginTop: 12, fontFamily: 'Inter_400Regular', fontSize: 13, color: '#6B7280' },

  header: {
    backgroundColor: '#FFFFFF',
    paddingTop: 16,
    paddingBottom: 16,
    paddingHorizontal: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#EAEFF8',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
  },
  headerTitle: { fontFamily: 'Inter_700Bold', fontSize: 18, color: '#1E293B' },
  logoutHeaderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FEF2F2',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#FEE2E2',
  },
  logoutHeaderText: { fontFamily: 'Inter_600SemiBold', fontSize: 11, color: '#EF4444' },

  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 100 },

  avatarCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#EAEFF8',
    elevation: 2,
    shadowColor: '#0F3B8C',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 6,
  },
  avatarCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#DBEAFE',
    marginBottom: 12,
  },
  avatarText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 28,
    color: '#0F3B8C',
  },
  userName: {
    fontFamily: 'Inter_700Bold',
    fontSize: 18,
    color: '#1E293B',
    textAlign: 'center',
  },
  roleBadge: {
    marginTop: 6,
    backgroundColor: '#0F3B8C15',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  roleBadgeText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 10,
    color: '#0F3B8C',
    letterSpacing: 0.5,
  },

  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 18,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#EAEFF8',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 6,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    paddingBottom: 12,
    marginBottom: 12,
  },
  cardTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
    color: '#1E293B',
  },
  cardContent: {
    gap: 12,
  },

  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
  },
  infoRowNonClickable: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
  },
  infoIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  infoBody: {
    flex: 1,
  },
  infoLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    color: '#94A3B8',
    marginBottom: 2,
  },
  infoValue: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    color: '#1E293B',
  },
  divider: {
    height: 1,
    backgroundColor: '#F1F5F9',
  },

  logoutBtn: {
    backgroundColor: '#EF4444',
    borderRadius: 14,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    elevation: 3,
    shadowColor: '#EF4444',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
  },
  logoutText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
    color: '#FFFFFF',
  },
});
