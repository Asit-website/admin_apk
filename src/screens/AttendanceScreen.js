import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Dimensions,
  Alert,
  Platform,
  Linking,
  Modal,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import dayjs from 'dayjs';
import BottomNav from '../components/BottomNav';
import api from '../config/api';

const parseTimeValue = (value) => {
  if (!value) return null;
  const v = String(value).trim();
  if (!v || v === '-' || v.toLowerCase() === 'invalid date') return null;

  let d = dayjs(v, 'HH:mm:ss', true);
  if (d.isValid()) return d;
  d = dayjs(v, 'HH:mm', true);
  if (d.isValid()) return d;

  const parts = v.split(':');
  if (parts.length >= 2) {
    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10);
    if (!isNaN(hours) && !isNaN(minutes)) {
      return dayjs().hour(hours).minute(minutes).second(0);
    }
  }

  d = dayjs(v);
  if (d.isValid()) return d;
  return null;
};

const formatWorkingHours = (checkInRaw, checkOutRaw, totalWorkHours) => {
  const hours = Number(totalWorkHours);
  if (Number.isFinite(hours) && hours > 0) {
    return `${hours.toFixed(2)} hrs`;
  }
  const checkIn = parseTimeValue(checkInRaw);
  const checkOut = parseTimeValue(checkOutRaw);
  if (!checkIn || !checkOut) return '--';
  let minutes = checkOut.diff(checkIn, 'minute');
  if (minutes < 0) minutes += 1440; // Add 24 hours for night shifts
  if (!Number.isFinite(minutes)) return '--';
  return `${(minutes / 60).toFixed(2)} hrs`;
};

const toTitleCase = (value) => String(value || '')
  .replace(/_/g, ' ')
  .trim()
  .replace(/\b\w/g, c => c.toUpperCase());

const getLeaveCategoryLabel = (item) => {
  const label = item?.categoryName || item?.categoryKey || item?.leaveType;
  return label ? toTitleCase(label) : '';
};

const getStatusLabel = (item, fallbackLabel) => {
  const status = String(item?.status || '').toLowerCase();
  if (status === 'leave' || status === 'on_leave') {
    const categoryLabel = getLeaveCategoryLabel(item);
    return categoryLabel ? `Leave (${categoryLabel})` : 'Leave';
  }
  return fallbackLabel;
};

const getDatesInRange = (startDate, endDate, monthKey = null) => {
  const dates = [];
  let current = dayjs(startDate);
  const end = dayjs(endDate);

  if (!current.isValid() || !end.isValid()) return dates;

  while (current.isBefore(end) || current.isSame(end, 'day')) {
    const dateStr = current.format('YYYY-MM-DD');
    if (!monthKey || dateStr.startsWith(monthKey)) {
      dates.push(dateStr);
    }
    current = current.add(1, 'day');
  }

  return dates;
};

const buildLeaveRows = (leaves, existingAttendance, selectedView, selectedDate, selectedMonth) => {
  const attendanceKeySet = new Set(existingAttendance.map(a => `${a.userId}-${a.date}`));
  const leaveByKey = new Map();

  leaves.forEach((leave) => {
    const dates = selectedView === 'daily'
      ? (leave.startDate <= selectedDate && leave.endDate >= selectedDate ? [selectedDate] : [])
      : getDatesInRange(leave.startDate, leave.endDate, selectedMonth);

    dates.forEach((dateStr) => {
      leaveByKey.set(`${leave.userId}-${dateStr}`, { leave, dateStr });
    });
  });

  const attendanceWithLeaveCategory = existingAttendance.map((item) => {
    const leaveInfo = leaveByKey.get(`${item.userId}-${item.date}`);
    if (!leaveInfo) return item;
    const { leave } = leaveInfo;
    return {
      ...item,
      leaveType: leave.leaveType,
      categoryKey: leave.categoryKey,
      categoryName: leave.categoryName,
    };
  });

  const syntheticLeaveRows = [];
  leaveByKey.forEach(({ leave, dateStr }, key) => {
    if (attendanceKeySet.has(key)) return;
    syntheticLeaveRows.push({
      id: `leave-req-${leave.id}-${dateStr}`,
      userId: leave.userId,
      date: dateStr,
      status: 'leave',
      checkIn: null,
      checkOut: null,
      breakMinutes: 0,
      totalWorkHours: 0,
      user: {
        id: leave.userId,
        name: leave.user?.profile?.name || leave.user?.name || 'Unknown Staff',
      },
      staffProfile: {
        staffId: leave.user?.profile?.staffId || 'N/A',
        department: leave.user?.profile?.department || '',
        workLocation: leave.user?.profile?.workLocation || '',
      },
      leaveType: leave.leaveType,
      categoryKey: leave.categoryKey,
      categoryName: leave.categoryName,
      _isLeaveRequest: true,
    });
  });

  return [...attendanceWithLeaveCategory, ...syntheticLeaveRows];
};

const hasGeolocationAccess = (item) => {
  const roles = item?.user?.roles || [];
  return roles.some(role => 
    (role?.permissions || []).some(perm => perm.name === 'geolocation_access')
  );
};

const { width } = Dimensions.get('window');
const DAILY_PAGE_SIZE = 10;

export default function AttendanceScreen({ navigation }) {
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

  useEffect(() => {
    fetchUnreadCount();
  }, [fetchUnreadCount]);

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

  const [selectedView, setSelectedView] = useState('daily'); // 'daily' | 'calendar' | 'department' | 'branch'
  const [selectedDate, setSelectedDate] = useState(dayjs().format('YYYY-MM-DD'));
  const [selectedMonth, setSelectedMonth] = useState(dayjs().format('YYYY-MM'));
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [attendanceData, setAttendanceData] = useState([]);
  const [staffList, setStaffList] = useState([]);
  const [dailyPage, setDailyPage] = useState(1);
  const [expandedGroups, setExpandedGroups] = useState({});
  const [selectedLocationItem, setSelectedLocationItem] = useState(null);
  const [showLocationModal, setShowLocationModal] = useState(false);

  const handleOpenLocation = (item) => {
    setSelectedLocationItem(item);
    setShowLocationModal(true);
  };

  const fetchStaff = useCallback(async () => {
    try {
      const res = await api.get('/admin/staff?module=attendance');
      if (res.data?.success) {
        const rows = Array.isArray(res.data.staff)
          ? res.data.staff
          : (Array.isArray(res.data.data) ? res.data.data : []);
        setStaffList(rows);
      }
    } catch (err) {
      console.log('Error fetching staff:', err);
    }
  }, []);

  // Fetch attendance records from backend
  const fetchAttendance = useCallback(async () => {
    setLoading(true);
    try {
      if (selectedView === 'daily') {
        const [attendanceRes, leaveRes] = await Promise.all([
          api.get(`/admin/attendance?date=${selectedDate}`),
          api.get('/leave', { params: { status: 'APPROVED' } }).catch(() => null),
        ]);
        if (attendanceRes.data?.success) {
          const attendanceRows = attendanceRes.data.data || [];
          const leaves = leaveRes?.data?.leaves || [];
          setAttendanceData(buildLeaveRows(leaves, attendanceRows, selectedView, selectedDate, selectedMonth));
        }
      } else {
        // Calendar, Department, Branch need the whole month's records
        const [attendanceRes, leaveRes] = await Promise.all([
          api.get(`/admin/attendance?month=${selectedMonth}`),
          api.get('/leave', { params: { status: 'APPROVED' } }).catch(() => null),
        ]);
        if (attendanceRes.data?.success) {
          const attendanceRows = attendanceRes.data.data || [];
          const leaves = leaveRes?.data?.leaves || [];
          setAttendanceData(buildLeaveRows(leaves, attendanceRows, selectedView, selectedDate, selectedMonth));
        }
      }
    } catch (err) {
      console.log('Error fetching attendance:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedView, selectedDate, selectedMonth]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchAttendance();
    setRefreshing(false);
  };

  useEffect(() => {
    fetchAttendance();
  }, [fetchAttendance]);

  useEffect(() => {
    fetchStaff();
  }, [fetchStaff]);

  // Adjust daily date previous/next
  const adjustDate = (days) => {
    const nextDate = dayjs(selectedDate).add(days, 'day').format('YYYY-MM-DD');
    setSelectedDate(nextDate);
  };

  // Adjust month previous/next
  const adjustMonth = (months) => {
    const nextMonth = dayjs(`${selectedMonth}-01`).add(months, 'month').format('YYYY-MM');
    setSelectedMonth(nextMonth);
  };

  // Toggle group expansion (for Department and Branch views)
  const toggleGroup = (groupName) => {
    setExpandedGroups(prev => ({
      ...prev,
      [groupName]: !prev[groupName]
    }));
  };

  // 1. DAILY VIEW: Filtered list based on Search Query
  const filteredDailyAttendance = useMemo(() => {
    if (selectedView !== 'daily') return [];
    return attendanceData.filter(item => {
      const name = (item.user?.name || '').toLowerCase();
      const dept = (item.staffProfile?.department || '').toLowerCase();
      const query = searchQuery.toLowerCase();
      return name.includes(query) || dept.includes(query);
    });
  }, [attendanceData, selectedView, searchQuery]);

  useEffect(() => {
    setDailyPage(1);
  }, [selectedDate, searchQuery, selectedView]);

  const dailyTotalPages = Math.max(1, Math.ceil(filteredDailyAttendance.length / DAILY_PAGE_SIZE));

  useEffect(() => {
    if (dailyPage > dailyTotalPages) setDailyPage(dailyTotalPages);
  }, [dailyPage, dailyTotalPages]);

  const paginatedDailyAttendance = useMemo(() => {
    const start = (dailyPage - 1) * DAILY_PAGE_SIZE;
    return filteredDailyAttendance.slice(start, start + DAILY_PAGE_SIZE);
  }, [dailyPage, filteredDailyAttendance]);

  const showDailyPagination = filteredDailyAttendance.length > DAILY_PAGE_SIZE;

  const dailySummary = useMemo(() => {
    if (selectedView !== 'daily') {
      return { present: 0, absent: 0, leave: 0 };
    }

    const query = searchQuery.toLowerCase();
    const filteredActiveStaff = staffList.filter((staff) => {
      if (staff.active === false) return false;
      const name = (staff.name || staff.profile?.name || '').toLowerCase();
      const dept = (staff.department || staff.profile?.department || '').toLowerCase();
      return !query || name.includes(query) || dept.includes(query);
    });

    const presentUserIds = new Set();
    const leaveUserIds = new Set();

    filteredDailyAttendance.forEach((item) => {
      const status = String(item.status || '').toLowerCase();
      if (status === 'present' || status === 'half_day' || status === 'overtime') {
        presentUserIds.add(String(item.userId));
      } else if (status === 'leave' || status === 'on_leave') {
        leaveUserIds.add(String(item.userId));
      }
    });

    const activeCount = filteredActiveStaff.length || filteredDailyAttendance.length;
    const present = presentUserIds.size;
    const leave = leaveUserIds.size;
    const absent = Math.max(0, activeCount - present - leave);

    return { present, absent, leave };
  }, [filteredDailyAttendance, searchQuery, selectedView, staffList]);

  // 2. CALENDAR VIEW: Computes daily attendance rates and dates
  const calendarDays = useMemo(() => {
    if (selectedView !== 'calendar') return [];
    const firstDayOfMonth = dayjs(`${selectedMonth}-01`);
    const totalDays = firstDayOfMonth.daysInMonth();
    const startDayIndex = (firstDayOfMonth.day() + 6) % 7; // Align Mon = 0, Sun = 6

    const days = [];
    // Add blank padded days for previous month
    for (let i = 0; i < startDayIndex; i++) {
      days.push({ blank: true });
    }

    // Add actual days of active month
    for (let d = 1; d <= totalDays; d++) {
      const dateStr = firstDayOfMonth.date(d).format('YYYY-MM-DD');
      
      // Calculate attendance rate for this day
      const dayRecords = attendanceData.filter(r => r.date === dateStr);
      const total = dayRecords.length;
      const present = dayRecords.filter(r => 
        r.status === 'present' || r.status === 'half_day' || r.status === 'overtime'
      ).length;

      days.push({
        blank: false,
        dayNum: d,
        dateStr,
        attendanceRate: total > 0 ? Math.round((present / total) * 100) : null,
        totalStaff: total,
      });
    }

    return days;
  }, [attendanceData, selectedView, selectedMonth]);

  // 3. DEPARTMENT VIEW: Groups attendance by department
  const departmentGroups = useMemo(() => {
    if (selectedView !== 'department') return {};
    const groups = {};
    attendanceData.forEach(item => {
      const dept = item.staffProfile?.department || 'Unassigned';
      if (!groups[dept]) {
        groups[dept] = { presentCount: 0, absentCount: 0, items: [] };
      }
      if (item.status === 'present' || item.status === 'half_day' || item.status === 'overtime') {
        groups[dept].presentCount++;
      } else {
        groups[dept].absentCount++;
      }
      groups[dept].items.push(item);
    });
    return groups;
  }, [attendanceData, selectedView]);

  // 4. BRANCH VIEW: Groups attendance by workLocation / branch
  const branchGroups = useMemo(() => {
    if (selectedView !== 'branch') return {};
    const groups = {};
    attendanceData.forEach(item => {
      const branch = item.staffProfile?.workLocation || 'Head Office';
      if (!groups[branch]) {
        groups[branch] = { presentCount: 0, absentCount: 0, items: [] };
      }
      if (item.status === 'present' || item.status === 'half_day' || item.status === 'overtime') {
        groups[branch].presentCount++;
      } else {
        groups[branch].absentCount++;
      }
      groups[branch].items.push(item);
    });
    return groups;
  }, [attendanceData, selectedView]);

  // Status Color Helper
  const getStatusStyle = (status) => {
    const s = (status || '').toLowerCase();
    switch (s) {
      case 'present':
        return { color: '#16A34A', bg: '#F0FDF4', label: 'Present' };
      case 'overtime':
        return { color: '#16A34A', bg: '#F0FDF4', label: 'Overtime' };
      case 'absent':
        return { color: '#DC2626', bg: '#FEF2F2', label: 'Absent' };
      case 'late':
        return { color: '#D97706', bg: '#FFFBEB', label: 'Late' };
      case 'half_day':
        return { color: '#CA8A04', bg: '#FEFCE8', label: 'Half Day' };
      case 'leave':
      case 'on_leave':
        return { color: '#7C3AED', bg: '#F5F3FF', label: 'On Leave' };
      default:
        return { color: '#4B5563', bg: '#F3F4F6', label: status || 'Unknown' };
    }
  };

  return (
    <View style={styles.screen}>
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Attendance Management</Text>
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

      {/* Modern Segmented Navigation View Tabs */}
      <View style={styles.segmentedTabContainer}>
        {['daily', 'calendar', 'department', 'branch'].map((v) => {
          const isActive = selectedView === v;
          const label = v.charAt(0).toUpperCase() + v.slice(1);
          let icon = 'today-outline';
          if (v === 'calendar') icon = 'calendar-outline';
          else if (v === 'department') icon = 'business-outline';
          else if (v === 'branch') icon = 'location-outline';

          return (
            <TouchableOpacity
              key={v}
              style={[styles.segmentedTab, isActive && styles.segmentedTabActive]}
              onPress={() => setSelectedView(v)}
              activeOpacity={0.82}
            >
              <Ionicons name={icon} size={15} color={isActive ? '#FFFFFF' : '#6B7280'} />
              <Text style={[styles.segmentedTabLabel, isActive && styles.segmentedTabLabelActive]}>
                {v === 'daily' ? 'Daily' : label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Date / Month Select Bar */}
      <View style={styles.dateControlBar}>
        {selectedView === 'daily' ? (
          <>
            <TouchableOpacity onPress={() => adjustDate(-1)} style={styles.arrowBtn}>
              <Ionicons name="chevron-back" size={20} color="#0F3B8C" />
            </TouchableOpacity>
            <View style={styles.dateCenter}>
              <Ionicons name="calendar-outline" size={16} color="#0F3B8C" style={{ marginRight: 6 }} />
              <Text style={styles.dateText}>{dayjs(selectedDate).format('dddd, DD MMM YYYY')}</Text>
            </View>
            <TouchableOpacity onPress={() => adjustDate(1)} style={styles.arrowBtn}>
              <Ionicons name="chevron-forward" size={20} color="#0F3B8C" />
            </TouchableOpacity>
          </>
        ) : (
          <>
            <TouchableOpacity onPress={() => adjustMonth(-1)} style={styles.arrowBtn}>
              <Ionicons name="chevron-back" size={20} color="#0F3B8C" />
            </TouchableOpacity>
            <View style={styles.dateCenter}>
              <Ionicons name="calendar-outline" size={16} color="#0F3B8C" style={{ marginRight: 6 }} />
              <Text style={styles.dateText}>{dayjs(`${selectedMonth}-01`).format('MMMM YYYY')}</Text>
            </View>
            <TouchableOpacity onPress={() => adjustMonth(1)} style={styles.arrowBtn}>
              <Ionicons name="chevron-forward" size={20} color="#0F3B8C" />
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* Search Input (For Daily, Department, and Branch list-based filters) */}
      {selectedView !== 'calendar' && (
        <View style={styles.searchContainer}>
          <Ionicons name="search-outline" size={18} color="#9CA3AF" style={styles.searchIcon} />
          <TextInput
            placeholder="Search employee by name or department..."
            value={searchQuery}
            onChangeText={setSearchQuery}
            style={styles.searchInput}
            placeholderTextColor="#9CA3AF"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')} style={styles.clearBtn}>
              <Ionicons name="close-circle" size={16} color="#9CA3AF" />
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Content Area */}
      {loading && !refreshing ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color="#0F3B8C" />
          <Text style={styles.loadingText}>Fetching records...</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#0F3B8C" />}
        >
          {/* VIEW: DAILY */}
          {selectedView === 'daily' && (
            <>
              <View style={styles.summaryCardsRow}>
                <SummaryCard
                  icon="checkmark-circle-outline"
                  label="Total Present"
                  value={dailySummary.present}
                  color="#16A34A"
                  bg="#F0FDF4"
                />
                <SummaryCard
                  icon="close-circle-outline"
                  label="Total Absent"
                  value={dailySummary.absent}
                  color="#DC2626"
                  bg="#FEF2F2"
                />
                <SummaryCard
                  icon="person-outline"
                  label="On Leave"
                  value={dailySummary.leave}
                  color="#2563EB"
                  bg="#EFF6FF"
                />
              </View>

              {filteredDailyAttendance.length === 0 ? (
                <View style={styles.emptyBox}>
                  <Ionicons name="people-outline" size={48} color="#D1D5DB" />
                  <Text style={styles.emptyText}>No attendance records found</Text>
                  <Text style={styles.emptySub}>Try searching another name or selecting a different date</Text>
                </View>
              ) : (
                paginatedDailyAttendance.map((item, idx) => (
                  <AttendanceDetailCard key={item.id || idx} item={item} getStatusStyle={getStatusStyle} onOpenLocation={handleOpenLocation} />
                ))
              )}

              {showDailyPagination && (
                <View style={styles.paginationCard}>
                  <TouchableOpacity
                    style={[styles.pageNavButton, dailyPage === 1 && styles.pageNavButtonDisabled]}
                    onPress={() => setDailyPage(page => Math.max(1, page - 1))}
                    disabled={dailyPage === 1}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="chevron-back" size={18} color={dailyPage === 1 ? '#CBD5E1' : '#0F3B8C'} />
                  </TouchableOpacity>

                  <View style={styles.pageInfo}>
                    <Text style={styles.pageInfoTitle}>Page {dailyPage} of {dailyTotalPages}</Text>
                    <Text style={styles.pageInfoSub}>
                      {((dailyPage - 1) * DAILY_PAGE_SIZE) + 1}-{Math.min(dailyPage * DAILY_PAGE_SIZE, filteredDailyAttendance.length)} of {filteredDailyAttendance.length}
                    </Text>
                  </View>

                  <TouchableOpacity
                    style={[styles.pageNavButton, dailyPage === dailyTotalPages && styles.pageNavButtonDisabled]}
                    onPress={() => setDailyPage(page => Math.min(dailyTotalPages, page + 1))}
                    disabled={dailyPage === dailyTotalPages}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="chevron-forward" size={18} color={dailyPage === dailyTotalPages ? '#CBD5E1' : '#0F3B8C'} />
                  </TouchableOpacity>
                </View>
              )}
            </>
          )}

          {/* VIEW: CALENDAR */}
          {selectedView === 'calendar' && (
            <View style={styles.calendarContainer}>
              {/* Days of Week Header */}
              <View style={styles.weekHeader}>
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => (
                  <Text key={day} style={styles.weekDayText}>{day}</Text>
                ))}
              </View>

              {/* Days Grid */}
              <View style={styles.daysGrid}>
                {calendarDays.map((cell, idx) => {
                  if (cell.blank) {
                    return <View key={`blank-${idx}`} style={styles.dayCellBlank} />;
                  }

                  const isToday = cell.dateStr === dayjs().format('YYYY-MM-DD');
                  const isSelected = cell.dateStr === selectedDate;
                  
                  // Dot Color Logic
                  let rateColor = '#E5E7EB';
                  if (cell.attendanceRate !== null) {
                    if (cell.attendanceRate >= 80) rateColor = '#10B981'; // Green
                    else if (cell.attendanceRate >= 50) rateColor = '#F59E0B'; // Orange
                    else rateColor = '#EF4444'; // Red
                  }

                  return (
                    <TouchableOpacity
                      key={`day-${cell.dayNum}`}
                      style={[
                        styles.dayCell,
                        isToday && styles.dayCellToday,
                        isSelected && styles.dayCellSelected,
                      ]}
                      onPress={() => {
                        setSelectedDate(cell.dateStr);
                        setSelectedView('daily');
                      }}
                      activeOpacity={0.8}
                    >
                      <Text style={[
                        styles.dayNumberText,
                        isToday && styles.dayNumberTextToday,
                        isSelected && styles.dayNumberTextSelected,
                      ]}>
                        {cell.dayNum}
                      </Text>
                      {cell.attendanceRate !== null ? (
                        <View style={[styles.dayRateDot, { backgroundColor: rateColor }]} />
                      ) : (
                        <View style={[styles.dayRateDot, { backgroundColor: 'transparent' }]} />
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Legend */}
              <View style={styles.legendContainer}>
                <Text style={styles.legendTitle}>Attendance Rate Legend:</Text>
                <View style={styles.legendRow}>
                  <View style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: '#10B981' }]} />
                    <Text style={styles.legendText}>Excellent (≥ 80%)</Text>
                  </View>
                  <View style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: '#F59E0B' }]} />
                    <Text style={styles.legendText}>Average (50%-79%)</Text>
                  </View>
                  <View style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: '#EF4444' }]} />
                    <Text style={styles.legendText}>Low (&lt; 50%)</Text>
                  </View>
                </View>
                <View style={styles.tipBox}>
                  <Ionicons name="information-circle-outline" size={16} color="#0F3B8C" style={{ marginRight: 6 }} />
                  <Text style={styles.tipText}>Tap any date cell to view detailed check-in logs for that day.</Text>
                </View>
              </View>
            </View>
          )}

          {/* VIEW: DEPARTMENT */}
          {selectedView === 'department' && (
            Object.keys(departmentGroups).length === 0 ? (
              <View style={styles.emptyBox}>
                <Ionicons name="business-outline" size={48} color="#D1D5DB" />
                <Text style={styles.emptyText}>No department logs found</Text>
              </View>
            ) : (
              Object.keys(departmentGroups).map((deptName) => {
                const group = departmentGroups[deptName];
                const isExpanded = !!expandedGroups[deptName];

                // Filter items based on search query
                const matchedItems = group.items.filter(item => 
                  (item.user?.name || '').toLowerCase().includes(searchQuery.toLowerCase())
                );

                if (searchQuery.length > 0 && matchedItems.length === 0) return null;

                return (
                  <View key={deptName} style={styles.groupCard}>
                    <TouchableOpacity
                      style={styles.groupHeader}
                      onPress={() => toggleGroup(deptName)}
                      activeOpacity={0.8}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.groupTitle}>{deptName}</Text>
                        <Text style={styles.groupSubtitle}>
                          {group.presentCount} Present • {group.absentCount} Absent
                        </Text>
                      </View>
                      <Ionicons
                        name={isExpanded ? 'chevron-up-outline' : 'chevron-down-outline'}
                        size={20}
                        color="#6B7280"
                      />
                    </TouchableOpacity>

                    {isExpanded && (
                      <View style={styles.groupContent}>
                        {matchedItems.map((item, idx) => (
                          <AttendanceGroupRow key={item.id || idx} item={item} getStatusStyle={getStatusStyle} onOpenLocation={handleOpenLocation} />
                        ))}
                      </View>
                    )}
                  </View>
                );
              })
            )
          )}

          {/* VIEW: BRANCH */}
          {selectedView === 'branch' && (
            Object.keys(branchGroups).length === 0 ? (
              <View style={styles.emptyBox}>
                <Ionicons name="location-outline" size={48} color="#D1D5DB" />
                <Text style={styles.emptyText}>No branch logs found</Text>
              </View>
            ) : (
              Object.keys(branchGroups).map((branchName) => {
                const group = branchGroups[branchName];
                const isExpanded = !!expandedGroups[branchName];

                // Filter items based on search query
                const matchedItems = group.items.filter(item => 
                  (item.user?.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
                  (item.staffProfile?.department || '').toLowerCase().includes(searchQuery.toLowerCase())
                );

                if (searchQuery.length > 0 && matchedItems.length === 0) return null;

                return (
                  <View key={branchName} style={styles.groupCard}>
                    <TouchableOpacity
                      style={styles.groupHeader}
                      onPress={() => toggleGroup(branchName)}
                      activeOpacity={0.8}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.groupTitle}>{branchName}</Text>
                        <Text style={styles.groupSubtitle}>
                          {group.presentCount} Present • {group.absentCount} Absent
                        </Text>
                      </View>
                      <Ionicons
                        name={isExpanded ? 'chevron-up-outline' : 'chevron-down-outline'}
                        size={20}
                        color="#6B7280"
                      />
                    </TouchableOpacity>

                    {isExpanded && (
                      <View style={styles.groupContent}>
                        {matchedItems.map((item, idx) => (
                          <AttendanceGroupRow key={item.id || idx} item={item} getStatusStyle={getStatusStyle} onOpenLocation={handleOpenLocation} />
                        ))}
                      </View>
                    )}
                  </View>
                );
              })
            )
          )}

          <View style={{ height: 80 }} />
        </ScrollView>
      )}

      {/* Location Details Modal */}
      <Modal
        visible={showLocationModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowLocationModal(false)}
      >
        <View style={styles.modalBackdrop}>
          <TouchableOpacity 
            style={styles.modalOverlayClose} 
            activeOpacity={1} 
            onPress={() => setShowLocationModal(false)} 
          />
          
          <View style={styles.locationModalContainer}>
            <View style={styles.locationModalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.locationModalTitle}>Location Details</Text>
                <Text style={styles.locationModalSubTitle}>
                  {selectedLocationItem?.user?.profile?.name || selectedLocationItem?.user?.name || 'Unknown Staff'} (ID: {selectedLocationItem?.staffProfile?.staffId || 'N/A'})
                </Text>
                {selectedLocationItem?.user?.profile?.phone ? (
                  <Text style={styles.locationPhoneText}>📞 {selectedLocationItem.user.profile.phone}</Text>
                ) : null}
              </View>
              <TouchableOpacity 
                onPress={() => setShowLocationModal(false)}
                style={styles.closeBtn}
              >
                <Ionicons name="close-circle" size={26} color="#9CA3AF" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 350 }}>
              {/* Punch In */}
              <View style={styles.locationSectionPunchIn}>
                <View style={styles.locationSectionHeader}>
                  <Ionicons name="checkmark-circle" size={18} color="#16A34A" style={{ marginRight: 6 }} />
                  <Text style={styles.locationSectionTitle}>Punch In</Text>
                </View>
                
                <Text style={styles.locationFieldLabel}>Address:</Text>
                <Text style={styles.locationFieldValue}>
                  {selectedLocationItem?.address || 'No address recorded'}
                </Text>

                <Text style={styles.locationFieldLabel}>Coordinates:</Text>
                {selectedLocationItem?.latitude ? (
                  <TouchableOpacity 
                    onPress={() => {
                      const url = `https://www.google.com/maps/search/?api=1&query=${selectedLocationItem.latitude},${selectedLocationItem.longitude}`;
                      Linking.openURL(url);
                    }}
                    style={styles.coordinatesLink}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.coordinatesLinkText}>
                      {Number(selectedLocationItem.latitude).toFixed(6)}, {Number(selectedLocationItem.longitude).toFixed(6)}
                    </Text>
                    <Ionicons name="open-outline" size={14} color="#0F3B8C" style={{ marginLeft: 4 }} />
                  </TouchableOpacity>
                ) : (
                  <Text style={styles.locationFieldValue}>0.000000, 0.000000</Text>
                )}
              </View>

              <View style={{ height: 12 }} />

              {/* Punch Out */}
              <View style={styles.locationSectionPunchOut}>
                <View style={styles.locationSectionHeader}>
                  <Ionicons name="log-out" size={18} color="#D97706" style={{ marginRight: 6 }} />
                  <Text style={styles.locationSectionTitle}>Punch Out</Text>
                </View>
                
                <Text style={styles.locationFieldLabel}>Address:</Text>
                <Text style={styles.locationFieldValue}>
                  {selectedLocationItem?.punchOutAddress || 'No address recorded'}
                </Text>

                <Text style={styles.locationFieldLabel}>Coordinates:</Text>
                {selectedLocationItem?.punchOutLatitude ? (
                  <TouchableOpacity 
                    onPress={() => {
                      const url = `https://www.google.com/maps/search/?api=1&query=${selectedLocationItem.punchOutLatitude},${selectedLocationItem.punchOutLongitude}`;
                      Linking.openURL(url);
                    }}
                    style={styles.coordinatesLink}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.coordinatesLinkText}>
                      {Number(selectedLocationItem.punchOutLatitude).toFixed(6)}, {Number(selectedLocationItem.punchOutLongitude).toFixed(6)}
                    </Text>
                    <Ionicons name="open-outline" size={14} color="#0F3B8C" style={{ marginLeft: 4 }} />
                  </TouchableOpacity>
                ) : (
                  <Text style={styles.locationFieldValue}>0.000000, 0.000000</Text>
                )}
              </View>

              <TouchableOpacity 
                onPress={() => setShowLocationModal(false)}
                style={styles.locationCloseButton}
                activeOpacity={0.8}
              >
                <Text style={styles.locationCloseButtonText}>Close</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Bottom Tab Bar */}
      <BottomNav navigation={navigation} activeKey="Attendance" />
    </View>
  );
}

// 📋 Daily Detailed Card Component
function SummaryCard({ icon, label, value, color, bg }) {
  return (
    <View style={styles.summaryCard}>
      <View style={[styles.summaryIconWrap, { backgroundColor: bg }]}>
        <Ionicons name={icon} size={15} color={color} />
      </View>
      <Text style={styles.summaryLabel} numberOfLines={1}>{label}</Text>
      <Text style={[styles.summaryValue, { color }]}>{value}</Text>
    </View>
  );
}

function AttendanceDetailCard({ item, getStatusStyle, onOpenLocation }) {
  const statusConfig = getStatusStyle(item.status);
  const initials = item.user?.name ? item.user.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() : '??';

  return (
    <View style={styles.detailCard}>
      <View style={styles.cardHeaderRow}>
        <View style={[styles.avatarBox, { backgroundColor: '#0F3B8C12' }]}>
          <Text style={styles.avatarText}>{initials}</Text>
        </View>
        <View style={styles.employeeMeta}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <Text style={styles.empName}>{item.user?.name || 'Unknown Staff'}</Text>
            {hasGeolocationAccess(item) && (
              <TouchableOpacity onPress={() => onOpenLocation(item)} style={styles.locationIconButton} activeOpacity={0.7}>
                <Ionicons name="location" size={16} color="#0F3B8C" />
              </TouchableOpacity>
            )}
          </View>
          <View style={styles.subMetaRow}>
            {item.staffProfile?.department ? (
              <Text style={styles.empSubText}>{item.staffProfile.department}</Text>
            ) : null}
            {item.staffProfile?.staffId ? (
              <Text style={styles.empStaffId}> • ID: {item.staffProfile.staffId}</Text>
            ) : null}
          </View>
        </View>
        <View style={styles.statusBadgeContainer}>
          <View style={[styles.statusBadge, { backgroundColor: statusConfig.bg }]}>
            <Text style={[styles.statusBadgeText, { color: statusConfig.color }]}>
              {getStatusLabel(item, statusConfig.label)}
            </Text>
          </View>
          
          {item.status === 'overtime' && item.overtimeMinutes > 0 ? (
            <Text style={styles.overtimeText}>
              ({item.overtimeMinutes} min OT)
            </Text>
          ) : null}

          {item.isLate && item.latePenaltyText ? (
            <View style={styles.lateTag}>
              <Text style={styles.lateTagText}>
                Late: {item.latePenaltyText}
                {item.bufferMinutes > 0 && ` (${item.bufferMinutes}m buffer applied)`}
              </Text>
            </View>
          ) : null}

          {!item.latePenaltyText && item.latePunchInMinutes > 0 ? (
            <View style={styles.lateTag}>
              <Text style={styles.lateTagText}>
                Late by {item.latePunchInMinutes} min
                {item.bufferMinutes > 0 && ` (${item.bufferMinutes}m buffer applied)`}
              </Text>
            </View>
          ) : null}

          {item.earlyExitMinutes > 0 ? (
            <View style={styles.earlyExitTag}>
              <Text style={styles.earlyExitTagText}>
                Early Exit: {item.earlyExitMinutes} min
              </Text>
            </View>
          ) : null}

          {item.earlyOvertimeMinutes > 0 ? (
            <View style={styles.earlyOtTag}>
              <Text style={styles.earlyOtTagText}>
                Early OT: {item.earlyOvertimeMinutes} min
              </Text>
            </View>
          ) : null}
        </View>
      </View>

      <View style={styles.divider} />

      <View style={styles.punchesRow}>
        <View style={styles.punchColumn}>
          <View style={styles.punchTitleRow}>
            <Ionicons name="log-in-outline" size={14} color="#16A34A" style={{ marginRight: 4 }} />
            <Text style={styles.punchLabel}>PUNCH IN</Text>
          </View>
          <Text style={styles.punchTime}>{item.checkIn || '--:--'}</Text>
          {item.address ? (
            <Text style={styles.punchAddr} numberOfLines={1}>{item.address}</Text>
          ) : null}
        </View>

        <View style={styles.verticalDivider} />

        <View style={styles.punchColumn}>
          <View style={styles.punchTitleRow}>
            <Ionicons name="log-out-outline" size={14} color="#DC2626" style={{ marginRight: 4 }} />
            <Text style={styles.punchLabel}>PUNCH OUT</Text>
          </View>
          <Text style={styles.punchTime}>{item.checkOut || '--:--'}</Text>
          {item.punchOutAddress ? (
            <Text style={styles.punchAddr} numberOfLines={1}>{item.punchOutAddress}</Text>
          ) : null}
        </View>
      </View>

      {/* Metrics Footer (Only visible if checked in) */}
      {!!(item.checkIn || item.totalWorkHours > 0) ? (
        <>
          <View style={styles.cardFooterDivider} />
          <View style={styles.cardMetricsFooter}>
            <View style={styles.metricItem}>
              <Text style={styles.metricLabel}>WORK HOURS</Text>
              <Text style={styles.metricValue}>
                {formatWorkingHours(item.checkIn, item.checkOut, item.totalWorkHours)}
              </Text>
            </View>
            <View style={styles.metricItem}>
              <Text style={styles.metricLabel}>LATE DURATION</Text>
              <Text style={[styles.metricValue, item.isLate && { color: '#D97706' }]}>
                {item.latePunchInMinutes ? `${item.latePunchInMinutes} mins` : '0 mins'}
              </Text>
            </View>
            <View style={styles.metricItem}>
              <Text style={styles.metricLabel}>BREAK TIME</Text>
              <Text style={styles.metricValue}>
                {item.breakMinutes ? `${item.breakMinutes} mins` : '0 mins'}
              </Text>
            </View>
          </View>
        </>
      ) : null}

      {/* Note Section if exists */}
      {!!item.note ? (
        <View style={styles.noteBox}>
          <Ionicons name="document-text-outline" size={12} color="#4B5563" style={{ marginRight: 4 }} />
          <Text style={styles.noteText} numberOfLines={2}>
            <Text style={{ fontWeight: '600' }}>Note: </Text>
            {item.note}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

// Expandable Group Employee Row Component
function AttendanceGroupRow({ item, getStatusStyle, onOpenLocation }) {
  const statusConfig = getStatusStyle(item.status);
  return (
    <View style={styles.groupEmpRow}>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <Text style={styles.groupEmpName}>{item.user?.name || 'Unknown Staff'}</Text>
          {hasGeolocationAccess(item) && (
            <TouchableOpacity onPress={() => onOpenLocation(item)} style={styles.locationIconButton} activeOpacity={0.7}>
              <Ionicons name="location" size={14} color="#0F3B8C" />
            </TouchableOpacity>
          )}
        </View>
        <View style={styles.groupEmpMeta}>
          <Ionicons name="calendar-outline" size={11} color="#9CA3AF" style={{ marginRight: 4 }} />
          <Text style={styles.groupEmpTime}>
            {dayjs(item.date).format('DD MMM')}  •  In: {item.checkIn || '--:--'}  •  Out: {item.checkOut || '--:--'}
          </Text>
        </View>
      </View>
      <View style={styles.statusBadgeContainerSmall}>
        <View style={[styles.statusBadgeSmall, { backgroundColor: statusConfig.bg }]}>
          <Text style={[styles.statusBadgeTextSmall, { color: statusConfig.color }]}>
            {getStatusLabel(item, statusConfig.label)}
          </Text>
        </View>
        
        {item.status === 'overtime' && item.overtimeMinutes > 0 ? (
          <Text style={styles.overtimeTextSmall}>
            ({item.overtimeMinutes}m OT)
          </Text>
        ) : null}

        {!!(item.isLate && item.latePenaltyText) ? (
          <View style={styles.lateTagSmall}>
            <Text style={styles.lateTagTextSmall}>
              Late: {item.latePenaltyText}
            </Text>
          </View>
        ) : null}

        {!!(!item.latePenaltyText && item.latePunchInMinutes > 0) ? (
          <View style={styles.lateTagSmall}>
            <Text style={styles.lateTagTextSmall}>
              Late: {item.latePunchInMinutes}m
            </Text>
          </View>
        ) : null}

        {item.earlyExitMinutes > 0 ? (
          <View style={styles.earlyExitTagSmall}>
            <Text style={styles.earlyExitTagTextSmall}>
              Exit: {item.earlyExitMinutes}m
            </Text>
          </View>
        ) : null}

        {item.earlyOvertimeMinutes > 0 ? (
          <View style={styles.earlyOtTagSmall}>
            <Text style={styles.earlyOtTagTextSmall}>
              E-OT: {item.earlyOvertimeMinutes}m
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F8FAFD' },
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingBottom: 80 },
  loadingText: { marginTop: 12, fontFamily: 'Inter_400Regular', fontSize: 13, color: '#6B7280' },

  header: {
    backgroundColor: '#FFFFFF',
    paddingTop: 14,
    paddingBottom: 14,
    paddingHorizontal: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E9F0',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
  },
  headerTitle: { fontFamily: 'Inter_700Bold', fontSize: 18, color: '#111827' },
  headerSubtitle: { fontFamily: 'Inter_400Regular', fontSize: 11, color: '#6B7280', marginTop: 2 },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FEF2F2',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  logoutText: { fontFamily: 'Inter_600SemiBold', fontSize: 11, color: '#DC2626' },

  // Segmented Navigation Bar Styles
  segmentedTabContainer: {
    flexDirection: 'row',
    backgroundColor: '#EFF3F9',
    marginHorizontal: 16,
    marginTop: 14,
    borderRadius: 10,
    padding: 4,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  segmentedTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 8,
    gap: 4,
  },
  segmentedTabActive: {
    backgroundColor: '#0F3B8C',
    elevation: 2,
    shadowColor: '#0F3B8C',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  segmentedTabLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    color: '#6B7280',
  },
  segmentedTabLabelActive: {
    color: '#FFFFFF',
    fontFamily: 'Inter_600SemiBold',
  },

  // Date Control Bar Styles
  dateControlBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginTop: 10,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: '#E5E9F0',
  },
  arrowBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EFF6FF',
  },
  dateCenter: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dateText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    color: '#111827',
  },

  // Search input styles
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 6,
    borderRadius: 12,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#E5E9F0',
    height: 40,
  },
  searchIcon: { marginRight: 8 },
  searchInput: {
    flex: 1,
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: '#111827',
    padding: 0,
  },
  clearBtn: { padding: 4 },

  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 100 },

  summaryCardsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  summaryCard: {
    flex: 1,
    minHeight: 76,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: '#EFF2F7',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
  },
  summaryIconWrap: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 5,
  },
  summaryLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 9,
    color: '#6B7280',
    textAlign: 'center',
  },
  summaryValue: {
    fontFamily: 'Inter_700Bold',
    fontSize: 16,
    marginTop: 2,
  },

  paginationCard: {
    marginTop: 2,
    marginBottom: 14,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#E5E9F0',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
  },
  pageNavButton: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#DBEAFE',
  },
  pageNavButtonDisabled: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E5E7EB',
  },
  pageInfo: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 10,
  },
  pageInfoTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 12,
    color: '#111827',
  },
  pageInfoSub: {
    fontFamily: 'Inter_500Medium',
    fontSize: 10,
    color: '#6B7280',
    marginTop: 2,
  },

  // Detailed Card Styles
  detailCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    borderWidth: 1,
    borderColor: '#EFF2F7',
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  avatarBox: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  avatarText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    color: '#0F3B8C',
  },
  employeeMeta: {
    flex: 1,
    marginLeft: 12,
  },
  empName: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    color: '#111827',
  },
  subMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  empSubText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    color: '#6B7280',
  },
  empStaffId: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    color: '#9CA3AF',
  },
  statusBadgeContainer: {
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  statusBadgeText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
  },
  overtimeText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 10,
    color: '#6B7280',
    marginTop: 2,
  },
  lateTag: {
    backgroundColor: '#FFF1F0',
    borderColor: '#FFA39E',
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginTop: 3,
  },
  lateTagText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 9,
    color: '#CF1322',
  },
  earlyExitTag: {
    backgroundColor: '#FFF7E6',
    borderColor: '#FFE58F',
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginTop: 3,
  },
  earlyExitTagText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 9,
    color: '#D46B08',
  },
  earlyOtTag: {
    backgroundColor: '#F6FFED',
    borderColor: '#B7EB8F',
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginTop: 3,
  },
  earlyOtTagText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 9,
    color: '#389E0D',
  },
  statusBadgeContainerSmall: {
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  overtimeTextSmall: {
    fontFamily: 'Inter_500Medium',
    fontSize: 8,
    color: '#6B7280',
    marginTop: 1,
  },
  lateTagSmall: {
    backgroundColor: '#FFF1F0',
    borderColor: '#FFA39E',
    borderWidth: 1,
    borderRadius: 3,
    paddingHorizontal: 4,
    paddingVertical: 1,
    marginTop: 2,
  },
  lateTagTextSmall: {
    fontFamily: 'Inter_500Medium',
    fontSize: 8,
    color: '#CF1322',
  },
  earlyExitTagSmall: {
    backgroundColor: '#FFF7E6',
    borderColor: '#FFE58F',
    borderWidth: 1,
    borderRadius: 3,
    paddingHorizontal: 4,
    paddingVertical: 1,
    marginTop: 2,
  },
  earlyExitTagTextSmall: {
    fontFamily: 'Inter_500Medium',
    fontSize: 8,
    color: '#D46B08',
  },
  earlyOtTagSmall: {
    backgroundColor: '#F6FFED',
    borderColor: '#B7EB8F',
    borderWidth: 1,
    borderRadius: 3,
    paddingHorizontal: 4,
    paddingVertical: 1,
    marginTop: 2,
  },
  earlyOtTagTextSmall: {
    fontFamily: 'Inter_500Medium',
    fontSize: 8,
    color: '#389E0D',
  },
  divider: {
    height: 1,
    backgroundColor: '#F3F4F6',
    marginVertical: 12,
  },
  punchesRow: {
    flexDirection: 'row',
  },
  punchColumn: {
    flex: 1,
  },
  punchTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  punchLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 9,
    color: '#9CA3AF',
    letterSpacing: 0.5,
  },
  punchTime: {
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
    color: '#111827',
  },
  punchAddr: {
    fontFamily: 'Inter_400Regular',
    fontSize: 10,
    color: '#6B7280',
    marginTop: 4,
    paddingRight: 6,
  },
  verticalDivider: {
    width: 1,
    backgroundColor: '#F3F4F6',
    marginHorizontal: 12,
  },
  cardFooterDivider: {
    height: 1,
    backgroundColor: '#F3F4F6',
    marginTop: 12,
  },
  cardMetricsFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 10,
  },
  metricItem: {
    alignItems: 'flex-start',
  },
  metricLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 8,
    color: '#9CA3AF',
  },
  metricValue: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    color: '#111827',
    marginTop: 2,
  },
  noteBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    marginTop: 10,
  },
  noteText: {
    flex: 1,
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    color: '#4B5563',
  },

  // Calendar Styles
  calendarContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#EFF2F7',
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 3,
  },
  weekHeader: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  weekDayText: {
    flex: 1,
    textAlign: 'center',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
    color: '#9CA3AF',
  },
  daysGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  dayCell: {
    width: `${100 / 7}%`,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 4,
    borderRadius: 24,
  },
  dayCellBlank: {
    width: `${100 / 7}%`,
    height: 48,
  },
  dayCellToday: {
    borderWidth: 1.5,
    borderColor: '#0F3B8C',
  },
  dayCellSelected: {
    backgroundColor: '#0F3B8C',
  },
  dayNumberText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    color: '#111827',
  },
  dayNumberTextToday: {
    color: '#0F3B8C',
    fontFamily: 'Inter_700Bold',
  },
  dayNumberTextSelected: {
    color: '#FFFFFF',
    fontFamily: 'Inter_700Bold',
  },
  dayRateDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    marginTop: 3,
  },

  // Calendar Legend Styles
  legendContainer: {
    marginTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    paddingTop: 12,
  },
  legendTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
    color: '#4B5563',
    marginBottom: 6,
  },
  legendRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  legendText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 10,
    color: '#6B7280',
  },
  tipBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    padding: 8,
    borderRadius: 8,
    marginTop: 12,
  },
  tipText: {
    flex: 1,
    fontFamily: 'Inter_400Regular',
    fontSize: 10,
    color: '#0F3B8C',
  },

  // Accordion Group Styles (Department & Branch Views)
  groupCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#EFF2F7',
    overflow: 'hidden',
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 3,
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: '#FFFFFF',
  },
  groupTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
    color: '#111827',
  },
  groupSubtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    color: '#6B7280',
    marginTop: 2,
  },
  groupContent: {
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    backgroundColor: '#FCFDFF',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  groupEmpRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  groupEmpName: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    color: '#111827',
  },
  groupEmpMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  groupEmpTime: {
    fontFamily: 'Inter_400Regular',
    fontSize: 10,
    color: '#6B7280',
  },
  statusBadgeSmall: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  statusBadgeTextSmall: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 9,
  },

  // Empty placeholder styles
  emptyBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    paddingHorizontal: 20,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#EFF2F7',
    marginTop: 10,
  },
  emptyText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
    color: '#6B7280',
    marginTop: 12,
  },
  emptySub: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 4,
    textAlign: 'center',
  },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bellBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F3F4F6',
    position: 'relative',
  },
  bellBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
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
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalOverlayClose: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
  },
  locationModalContainer: {
    backgroundColor: '#ffffff',
    width: '90%',
    maxWidth: 400,
    borderRadius: 24,
    padding: 20,
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
  },
  locationModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    paddingBottom: 12,
  },
  locationModalTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 18,
    color: '#111827',
  },
  locationModalSubTitle: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    color: '#4B5563',
    marginTop: 4,
  },
  locationPhoneText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    color: '#6B7280',
    marginTop: 2,
  },
  closeBtn: {
    padding: 4,
  },
  locationSectionPunchIn: {
    backgroundColor: '#F0FDF4',
    borderColor: '#E8F5E9',
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
  },
  locationSectionPunchOut: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FFF3E0',
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
  },
  locationSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  locationSectionTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    color: '#111827',
  },
  locationFieldLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    color: '#6B7280',
    marginTop: 8,
    marginBottom: 2,
  },
  locationFieldValue: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: '#111827',
    lineHeight: 18,
  },
  coordinatesLink: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  coordinatesLinkText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    color: '#0F3B8C',
    textDecorationLine: 'underline',
  },
  locationCloseButton: {
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
  },
  locationCloseButtonText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    color: '#4B5563',
  },
  locationIconButton: {
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
});
