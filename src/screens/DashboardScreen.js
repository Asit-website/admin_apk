import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Dimensions,
  Alert,
  Platform,
} from 'react-native';
import BottomNav from '../components/BottomNav';
import api from '../config/api';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import dayjs from 'dayjs';

const { width } = Dimensions.get('window');

export default function DashboardScreen({ navigation }) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [user, setUser] = useState(null);
  const [stats, setStats] = useState({
    present: 0,
    absent: 0,
    late: 0,
    onLeave: 0,
    total: 0,
    totalStaff: 0,
    activeStaff: 0,
    inactiveStaff: 0,
  });
  const [monthlyData, setMonthlyData] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const fetchUnreadCount = useCallback(async () => {
    try {
      const res = await api.get('/admin/notifications');
      if (res?.data?.success) {
        const list = res.data.data || [];
        const count = list.filter((n) => !n.isRead).length;
        setUnreadCount(count);
      }
    } catch (err) {
      console.log('Error fetching unread count:', err);
    }
  }, []);

  const loadUser = async () => {
    try {
      const userStr = await AsyncStorage.getItem('user');
      if (userStr) setUser(JSON.parse(userStr));
    } catch { }
  };

  const fetchData = useCallback(async () => {
    try {
      fetchUnreadCount();
      const [dashboardRes, monthlyRes] = await Promise.allSettled([
        api.get('/admin/dashboard'),
        api.get('/admin/dashboard/attendance-chart'),
      ]);

      // Parse backend dashboard stats (accurate database-driven stats)
      if (dashboardRes.status === 'fulfilled' && dashboardRes.value?.data?.success) {
        const d = dashboardRes.value?.data?.data || {};
        const tS = d.totalStaff ?? 0;
        const aS = d.activeStaff ?? 0;
        const iS = Math.max(0, tS - aS);
        setStats({
          present: d.presentToday ?? 0,
          absent: d.absentToday ?? 0,
          late: d.lateArrivals ?? 0,
          onLeave: d.leaveToday ?? 0,
          total: aS || tS || 0,
          totalStaff: tS,
          activeStaff: aS,
          inactiveStaff: iS,
        });
      }

      // Monthly/Weekly summary chart
      if (monthlyRes.status === 'fulfilled' && monthlyRes.value?.data?.success) {
        const arr = monthlyRes.value?.data?.data || [];
        setMonthlyData(Array.isArray(arr) ? arr : []);
      }

    } catch (err) {
      console.log('Dashboard fetch error:', err);
    }
  }, []);

  const load = async () => {
    setLoading(true);
    await loadUser();
    await fetchData();
    setLoading(false);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      fetchUnreadCount();
    });
    return unsubscribe;
  }, [navigation, fetchUnreadCount]);

  const doLogout = async () => {
    await AsyncStorage.removeItem('auth_token');
    await AsyncStorage.removeItem('user');
    await AsyncStorage.removeItem('orgId');
    await AsyncStorage.removeItem('orgData');
    navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
  };

  const handleLogout = () => {
    if (Platform.OS === 'web') {
      // web pe window.confirm use karo
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

  const getMonthlyBars = () => {
    if (!monthlyData || monthlyData.length === 0) {
      return [
        { label: 'Mon', value: 85 }, { label: 'Tue', value: 90 },
        { label: 'Wed', value: 78 }, { label: 'Thu', value: 92 },
        { label: 'Fri', value: 88 }, { label: 'Sat', value: 60 },
        { label: 'Sun', value: 20 },
      ];
    }
    return monthlyData.map((d) => {
      const present = d.present || 0;
      const total = d.total || 0;
      const rate = total > 0 ? Math.round((present / total) * 100) : 0;
      return {
        label: d.day || '',
        value: rate,
      };
    });
  };

  const bars = getMonthlyBars();
  const maxBar = Math.max(...bars.map(b => b.value), 1);
  const attendancePct = stats.total > 0 ? Math.round((stats.present / stats.total) * 100) : 0;



  if (loading) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator size="large" color="#0F3B8C" />
        <Text style={styles.loadingText}>Loading Dashboard...</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerGreet}>
            Good {dayjs().hour() < 12 ? 'Morning' : dayjs().hour() < 17 ? 'Afternoon' : 'Evening'} 👋
          </Text>
          <Text style={styles.headerName}>{user?.name || 'Admin'}</Text>
          <Text style={styles.headerDate}>{dayjs().format('dddd, DD MMM YYYY')}</Text>
        </View>
        <View style={styles.headerRight}>
          <TouchableOpacity
            style={styles.bellBtn}
            onPress={() => navigation.navigate('Notification')}
            activeOpacity={0.8}
          >
            <Ionicons name="notifications-outline" size={20} color="#374151" />
            {unreadCount > 0 && (
              <View style={styles.bellBadge}>
                <Text style={styles.bellBadgeText}>
                  {unreadCount > 9 ? '9+' : unreadCount}
                </Text>
              </View>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.8}>
            <Ionicons name="power-outline" size={18} color="#DC2626" />
            <Text style={styles.logoutText}>Logout</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#0F3B8C" />}
      >
        {/* Today's Attendance Premium Hero Card */}
        <View style={styles.premiumBigCard}>
          <View style={styles.bigCardLeft}>
            <Text style={styles.bigCardLabel}>TODAY'S ATTENDANCE RATE</Text>
            <Text style={styles.bigCardPct}>{attendancePct}%</Text>
            <View style={styles.progressBarBg}>
              <View style={[styles.progressBarFill, { width: `${attendancePct}%` }]} />
            </View>
            <View style={styles.bigCardStatsRow}>
              <Ionicons name="people" size={14} color="rgba(255,255,255,0.85)" />
              <Text style={styles.bigCardSub}>{stats.present} of {stats.total} employees present</Text>
            </View>
          </View>
          <View style={styles.bigCardRightContainer}>
            <View style={styles.bigCardIconCircle}>
              <Ionicons name="trending-up" size={26} color="#0F3B8C" />
            </View>
          </View>
        </View>

        {/* Staff Metrics Row */}
        <View style={styles.cardsRow}>
          <KpiCardSmall
            title="Total Staff" value={stats.totalStaff}
            icon="people-outline" color="#0F3B8C" bg="#EFF6FF"
          />
          <KpiCardSmall
            title="Active Staff" value={stats.activeStaff}
            icon="shield-checkmark-outline" color="#0D9488" bg="#F0FDFA"
          />
          <KpiCardSmall
            title="Inactive Staff" value={stats.inactiveStaff}
            icon="ban-outline" color="#4B5563" bg="#F3F4F6"
          />
        </View>

        {/* KPI Cards */}
        <View style={styles.cardsRow}>
          <KpiCard
            title="Present" value={stats.present}
            icon="checkmark-circle-outline" color="#16A34A" bg="#F0FDF4"
          />
          <KpiCard
            title="Absent" value={stats.absent}
            icon="close-circle-outline" color="#DC2626" bg="#FEF2F2"
          />
        </View>

        <View style={styles.cardsRow}>
          <KpiCard
            title="Late Arrivals" value={stats.late}
            icon="time-outline" color="#D97706" bg="#FFFBEB"
          />
          <KpiCard
            title="On Leave" value={stats.onLeave}
            icon="calendar-outline" color="#7C3AED" bg="#F5F3FF"
          />
        </View>

        {/* Monthly Chart */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Monthly Attendance Summary</Text>
          <Text style={styles.sectionSub}>{dayjs().format('MMMM YYYY')} — Last 7 days</Text>
          <View style={styles.chartWrap}>
            <View style={styles.barsRow}>
              {bars.map((b, i) => {
                const barH = Math.max(4, (b.value / maxBar) * 100);
                return (
                  <View key={i} style={styles.barCol}>
                    <Text style={styles.barValue}>{Math.round(b.value)}%</Text>
                    <View style={styles.barBg}>
                      <View style={[styles.barFill, { height: `${barH}%` }]} />
                    </View>
                    <Text style={styles.barLabel}>{b.label}</Text>
                  </View>
                );
              })}
            </View>
          </View>
        </View>

        <View style={{ height: 8 }} />
      </ScrollView>
      <BottomNav navigation={navigation} activeKey="Dashboard" />
    </View>
  );
}

function KpiCard({ title, value, icon, color, bg }) {
  return (
    <View style={[styles.kpiCard, { backgroundColor: bg }]}>
      <View style={[styles.kpiIconWrap, { backgroundColor: color + '22' }]}>
        <Ionicons name={icon} size={22} color={color} />
      </View>
      <Text style={styles.kpiValue}>{value}</Text>
      <Text style={styles.kpiTitle}>{title}</Text>
    </View>
  );
}

function KpiCardSmall({ title, value, icon, color, bg }) {
  return (
    <View style={[styles.kpiCardSmall, { backgroundColor: bg }]}>
      <View style={[styles.kpiIconWrapSmall, { backgroundColor: color + '22' }]}>
        <Ionicons name={icon} size={18} color={color} />
      </View>
      <Text style={styles.kpiValueSmall}>{value}</Text>
      <Text style={styles.kpiTitleSmall} numberOfLines={1}>{title}</Text>
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
  headerGreet: { fontFamily: 'Inter_400Regular', fontSize: 12, color: '#8892A0' },
  headerName: { fontFamily: 'Inter_700Bold', fontSize: 20, color: '#1E293B', marginTop: 2 },
  headerDate: { fontFamily: 'Inter_400Regular', fontSize: 11, color: '#94A3B8', marginTop: 3 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  bellBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F1F5F9',
    position: 'relative',
  },
  bellBadge: {
    position: 'absolute',
    top: -1,
    right: -1,
    backgroundColor: '#EF4444',
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 3,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  bellBadgeText: {
    color: '#FFFFFF',
    fontSize: 8,
    fontFamily: 'Inter_700Bold',
    lineHeight: 10,
    textAlign: 'center',
  },
  logoutBtn: {
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
  logoutText: { fontFamily: 'Inter_600SemiBold', fontSize: 11, color: '#EF4444' },

  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 100 },

  premiumBigCard: {
    backgroundColor: '#0F3B8C',
    borderRadius: 20,
    padding: 22,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    elevation: 6,
    shadowColor: '#0F3B8C',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.22,
    shadowRadius: 12,
  },
  bigCardLeft: { flex: 1 },
  bigCardLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 11, color: 'rgba(255,255,255,0.7)', letterSpacing: 0.8, marginBottom: 4 },
  bigCardPct: { fontFamily: 'Inter_800ExtraBold', fontSize: 44, color: '#FFFFFF' },
  progressBarBg: {
    height: 8, backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 4,
    marginTop: 10, marginBottom: 10, overflow: 'hidden',
  },
  progressBarFill: { height: '100%', backgroundColor: '#10B981', borderRadius: 4 },
  bigCardStatsRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  bigCardSub: { fontFamily: 'Inter_500Medium', fontSize: 12, color: 'rgba(255,255,255,0.85)' },
  bigCardRightContainer: { paddingLeft: 12 },
  bigCardIconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },

  cardsRow: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  
  kpiCard: {
    flex: 1, borderRadius: 16, padding: 16, alignItems: 'flex-start',
    borderWidth: 1, borderColor: '#F1F5F9',
    elevation: 2, shadowColor: '#0F3B8C', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03, shadowRadius: 4,
  },
  kpiIconWrap: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  kpiValue: { fontFamily: 'Inter_700Bold', fontSize: 26, color: '#0F172A' },
  kpiTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 12, color: '#475569', marginTop: 4 },

  kpiCardSmall: {
    flex: 1, borderRadius: 14, padding: 12, alignItems: 'flex-start',
    borderWidth: 1, borderColor: '#F1F5F9',
    elevation: 2, shadowColor: '#0F3B8C', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03, shadowRadius: 4,
  },
  kpiIconWrapSmall: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  kpiValueSmall: { fontFamily: 'Inter_700Bold', fontSize: 20, color: '#0F172A' },
  kpiTitleSmall: { fontFamily: 'Inter_600SemiBold', fontSize: 11, color: '#475569', marginTop: 2 },

  section: {
    backgroundColor: '#FFFFFF', borderRadius: 20, padding: 18, marginBottom: 16,
    borderWidth: 1, borderColor: '#EAEFF8',
    elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03, shadowRadius: 6,
  },
  sectionTitle: { fontFamily: 'Inter_700Bold', fontSize: 15, color: '#1E293B' },
  sectionSub: { fontFamily: 'Inter_400Regular', fontSize: 11, color: '#94A3B8', marginTop: 3, marginBottom: 18 },



  chartWrap: { height: 160, paddingBottom: 4 },
  barsRow: { flexDirection: 'row', alignItems: 'flex-end', height: '100%', gap: 8 },
  barCol: { flex: 1, alignItems: 'center', height: '100%', justifyContent: 'flex-end' },
  barValue: { fontFamily: 'Inter_600SemiBold', fontSize: 9, color: '#64748B', marginBottom: 4 },
  barBg: {
    width: '100%', flex: 1, backgroundColor: '#F1F5F9', borderRadius: 6,
    justifyContent: 'flex-end', overflow: 'hidden', maxHeight: 115,
  },
  barFill: { 
    width: '100%', 
    backgroundColor: '#0F3B8C', 
    borderTopLeftRadius: 6, 
    borderTopRightRadius: 6, 
    borderBottomLeftRadius: 0, 
    borderBottomRightRadius: 0 
  },
  barLabel: { fontFamily: 'Inter_500Medium', fontSize: 10, color: '#94A3B8', marginTop: 6 },
});
