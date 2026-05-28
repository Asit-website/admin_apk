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
  Modal,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import dayjs from 'dayjs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import BottomNav from '../components/BottomNav';
import api from '../config/api';

const { width } = Dimensions.get('window');
const LEAVE_PAGE_SIZE = 10;

export default function LeaveScreen({ navigation }) {
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

  const [activeTab, setActiveTab] = useState('requests'); // 'requests' | 'balances'
  const [requests, setRequests] = useState([]);
  const [staffList, setStaffList] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('ALL'); // 'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED'
  const [requestPage, setRequestPage] = useState(1);
  const [balancePage, setBalancePage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // States for Leave Balance Modal
  const [balanceModalVisible, setBalanceModalVisible] = useState(false);
  const [selectedStaff, setSelectedStaff] = useState(null);
  const [selectedStaffBalances, setSelectedStaffBalances] = useState([]);
  const [selectedStaffCycle, setSelectedStaffCycle] = useState(null);
  const [balanceLoading, setBalanceLoading] = useState(false);

  // States for Rejection Note Modal
  const [rejectionModalVisible, setRejectionModalVisible] = useState(false);
  const [requestToReject, setRequestToReject] = useState(null);
  const [rejectionNote, setRejectionNote] = useState('');
  const [actionLoadingId, setActionLoadingId] = useState(null);

  // Fetch all leave requests
  const fetchLeaves = useCallback(async () => {
    try {
      const res = await api.get('/leave');
      if (res.data?.success) {
        setRequests(res.data.leaves || []);
      }
    } catch (err) {
      console.log('Error fetching leaves:', err);
    }
  }, []);

  // Fetch all staff profiles
  const fetchStaff = useCallback(async () => {
    try {
      const res = await api.get('/admin/staff');
      if (res.data?.success) {
        setStaffList(res.data.data || res.data.staff || []);
      }
    } catch (err) {
      console.log('Error fetching staff list:', err);
    }
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    if (activeTab === 'requests') {
      await fetchLeaves();
    } else {
      await fetchStaff();
    }
    setLoading(false);
  }, [activeTab, fetchLeaves, fetchStaff]);

  const onRefresh = async () => {
    setRefreshing(true);
    if (activeTab === 'requests') {
      await fetchLeaves();
    } else {
      await fetchStaff();
    }
    setRefreshing(false);
  };

  useEffect(() => {
    loadData();
    // Reset search query when tab changes
    setSearchQuery('');
  }, [activeTab]);

  // Fetch leave balance details for a specific employee
  const viewLeaveBalance = async (staff) => {
    setSelectedStaff(staff);
    setBalanceLoading(true);
    setBalanceModalVisible(true);
    try {
      const res = await api.get(`/leave/categories?userId=${staff.id}`);
      if (res.data?.success) {
        setSelectedStaffBalances(res.data.categories || []);
        setSelectedStaffCycle(res.data.cycle || null);
      }
    } catch (err) {
      console.log('Error fetching employee leave balances:', err);
      Alert.alert('Error', 'Failed to fetch leave balances for this employee.');
      setBalanceModalVisible(false);
    } finally {
      setBalanceLoading(false);
    }
  };

  // Filter and Search Logic for Requests Tab
  const filteredRequests = useMemo(() => {
    if (activeTab !== 'requests') return [];
    return requests.filter(req => {
      // 1. Filter by Status
      if (filterStatus !== 'ALL' && req.status !== filterStatus) return false;

      // 2. Search query filter
      const name = (req.user?.profile?.name || req.user?.name || `Staff ${req.userId}`).toLowerCase();
      const reason = (req.reason || '').toLowerCase();
      const type = (req.leaveType || '').toLowerCase();
      const query = searchQuery.toLowerCase();

      return name.includes(query) || reason.includes(query) || type.includes(query);
    });
  }, [requests, activeTab, filterStatus, searchQuery]);

  useEffect(() => {
    setRequestPage(1);
    setBalancePage(1);
  }, [activeTab, filterStatus, searchQuery]);

  const requestTotalPages = Math.max(1, Math.ceil(filteredRequests.length / LEAVE_PAGE_SIZE));

  useEffect(() => {
    if (requestPage > requestTotalPages) setRequestPage(requestTotalPages);
  }, [requestPage, requestTotalPages]);

  const paginatedRequests = useMemo(() => {
    const start = (requestPage - 1) * LEAVE_PAGE_SIZE;
    return filteredRequests.slice(start, start + LEAVE_PAGE_SIZE);
  }, [filteredRequests, requestPage]);

  const showRequestPagination = filteredRequests.length > LEAVE_PAGE_SIZE;

  // Filter and Search Logic for Balances Tab
  const filteredStaff = useMemo(() => {
    if (activeTab !== 'balances') return [];
    return staffList.filter(staff => {
      const name = (staff.name || '').toLowerCase();
      const dept = (staff.department || '').toLowerCase();
      const phone = (staff.phone || '').toLowerCase();
      const query = searchQuery.toLowerCase();

      return name.includes(query) || dept.includes(query) || phone.includes(query);
    });
  }, [staffList, activeTab, searchQuery]);

  const balanceTotalPages = Math.max(1, Math.ceil(filteredStaff.length / LEAVE_PAGE_SIZE));

  useEffect(() => {
    if (balancePage > balanceTotalPages) setBalancePage(balanceTotalPages);
  }, [balancePage, balanceTotalPages]);

  const paginatedStaff = useMemo(() => {
    const start = (balancePage - 1) * LEAVE_PAGE_SIZE;
    return filteredStaff.slice(start, start + LEAVE_PAGE_SIZE);
  }, [filteredStaff, balancePage]);

  const showBalancePagination = filteredStaff.length > LEAVE_PAGE_SIZE;

  // Handle Approve Request
  const handleApprove = (reqId) => {
    const doApproval = async () => {
      setActionLoadingId(reqId);
      try {
        const res = await api.patch(`/leave/${reqId}/status`, { status: 'APPROVED' });
        if (res.data?.success) {
          Alert.alert('Success', 'Leave request has been approved successfully.');
          fetchLeaves();
        } else {
          Alert.alert('Error', res.data?.message || 'Failed to approve request.');
        }
      } catch (err) {
        console.log('Error approving leave:', err);
        Alert.alert('Error', err.response?.data?.message || 'Failed to approve request.');
      } finally {
        setActionLoadingId(null);
      }
    };

    if (Platform.OS === 'web') {
      if (window.confirm('Are you sure you want to approve this leave request?')) {
        doApproval();
      }
    } else {
      Alert.alert(
        'Approve Leave',
        'Are you sure you want to approve this leave request?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Approve', onPress: doApproval }
        ]
      );
    }
  };

  // Open Rejection Dialog
  const handleRejectPrompt = (reqItem) => {
    setRequestToReject(reqItem);
    setRejectionNote('');
    setRejectionModalVisible(true);
  };

  // Handle Reject Request
  const handleRejectConfirm = async () => {
    if (!requestToReject) return;
    const reqId = requestToReject.id;
    setRejectionModalVisible(false);
    setActionLoadingId(reqId);

    try {
      const res = await api.patch(`/leave/${reqId}/status`, {
        status: 'REJECTED',
        note: rejectionNote || 'Rejected by Admin'
      });
      if (res.data?.success) {
        Alert.alert('Success', 'Leave request has been rejected.');
        fetchLeaves();
      } else {
        Alert.alert('Error', res.data?.message || 'Failed to reject request.');
      }
    } catch (err) {
      console.log('Error rejecting leave:', err);
      Alert.alert('Error', err.response?.data?.message || 'Failed to reject request.');
    } finally {
      setActionLoadingId(null);
      setRequestToReject(null);
    }
  };

  // Badge Style Helper for Category Key
  const getCategoryBadgeStyle = (catKey) => {
    const key = (catKey || '').toLowerCase();
    if (key.includes('sick')) {
      return { color: '#DC2626', bg: '#FEF2F2', icon: 'thermometer-outline', label: 'Sick Leave' };
    } else if (key.includes('casual')) {
      return { color: '#D97706', bg: '#FFFBEB', icon: 'cafe-outline', label: 'Casual Leave' };
    } else if (key.includes('earned') || key.includes('annual') || key.includes('privilege') || key.includes('cl') || key.includes('sl') || key.includes('el')) {
      return { color: '#16A34A', bg: '#F0FDF4', icon: 'ribbon-outline', label: 'Earned Leave' };
    } else if (key.includes('unpaid')) {
      return { color: '#4B5563', bg: '#F3F4F6', icon: 'ban-outline', label: 'Unpaid Leave' };
    }
    return { color: '#7C3AED', bg: '#F5F3FF', icon: 'calendar-outline', label: catKey ? catKey.toUpperCase() : 'Leave' };
  };

  // Status Badge Helper
  const getStatusBadgeStyle = (status) => {
    const s = (status || '').toUpperCase();
    switch (s) {
      case 'APPROVED':
        return { color: '#16A34A', bg: '#F0FDF4', label: 'Approved' };
      case 'REJECTED':
        return { color: '#DC2626', bg: '#FEF2F2', label: 'Rejected' };
      case 'PENDING':
      default:
        return { color: '#D97706', bg: '#FFFBEB', label: 'Pending' };
    }
  };

  // Avatar initials helper
  const getInitials = (name) => {
    if (!name) return 'S';
    return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
  };

  // Colors for Avatars
  const getAvatarBg = (id) => {
    const colors = ['#EFF6FF', '#F0FDF4', '#FFFBEB', '#F5F3FF', '#ECFDF5', '#FDF2F8'];
    return colors[Number(id || 0) % colors.length];
  };

  return (
    <View style={styles.screen}>
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Leave Management</Text>
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

      {/* Segmented Control Navigation */}
      <View style={styles.segmentedTabContainer}>
        <TouchableOpacity
          style={[styles.segmentedTab, activeTab === 'requests' && styles.segmentedTabActive]}
          onPress={() => setActiveTab('requests')}
          activeOpacity={0.82}
        >
          <Ionicons name="calendar-outline" size={15} color={activeTab === 'requests' ? '#FFFFFF' : '#6B7280'} />
          <Text style={[styles.segmentedTabLabel, activeTab === 'requests' && styles.segmentedTabLabelActive]}>
            Leave Requests
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.segmentedTab, activeTab === 'balances' && styles.segmentedTabActive]}
          onPress={() => setActiveTab('balances')}
          activeOpacity={0.82}
        >
          <Ionicons name="pie-chart-outline" size={15} color={activeTab === 'balances' ? '#FFFFFF' : '#6B7280'} />
          <Text style={[styles.segmentedTabLabel, activeTab === 'balances' && styles.segmentedTabLabelActive]}>
            Leave Balances
          </Text>
        </TouchableOpacity>
      </View>

      {/* Filters & Search for Requests */}
      {activeTab === 'requests' && (
        <View style={styles.filtersWrapper}>
          {/* Status Pills */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterPillsContainer}
          >
            {['ALL', 'PENDING', 'APPROVED', 'REJECTED'].map((st) => {
              const isActive = filterStatus === st;
              const count = requests.filter(r => st === 'ALL' || r.status === st).length;
              return (
                <TouchableOpacity
                  key={st}
                  style={[styles.filterPill, isActive && styles.filterPillActive]}
                  onPress={() => setFilterStatus(st)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.filterPillText, isActive && styles.filterPillTextActive]}>
                    {st === 'ALL' ? 'All' : st.charAt(0) + st.slice(1).toLowerCase()} ({count})
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Search Bar */}
          <View style={styles.searchContainer}>
            <Ionicons name="search-outline" size={18} color="#9CA3AF" style={styles.searchIcon} />
            <TextInput
              placeholder="Search by employee name..."
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
        </View>
      )}

      {/* Search for Balances */}
      {activeTab === 'balances' && (
        <View style={styles.searchContainer}>
          <Ionicons name="search-outline" size={18} color="#9CA3AF" style={styles.searchIcon} />
          <TextInput
            placeholder="Search staff to view balance..."
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

      {/* Main Content scrollable list */}
      {loading && !refreshing ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color="#0F3B8C" />
          <Text style={styles.loadingText}>Loading leave module...</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#0F3B8C" />}
        >
          {/* Requests Tab List */}
          {activeTab === 'requests' && (
            filteredRequests.length === 0 ? (
              <View style={styles.emptyBox}>
                <Ionicons name="mail-unread-outline" size={48} color="#D1D5DB" />
                <Text style={styles.emptyText}>No leave requests found</Text>
                <Text style={styles.emptySub}>
                  {filterStatus === 'ALL' 
                    ? "Employees haven't submitted any leave requests yet."
                    : `No leave requests matches "${filterStatus.toLowerCase()}" filter.`}
                </Text>
              </View>
            ) : (
              paginatedRequests.map((item) => {
                const badge = getCategoryBadgeStyle(item.categoryKey || item.leaveType);
                const statusStyle = getStatusBadgeStyle(item.status);
                const isPending = item.status === 'PENDING';
                const empName = item.user?.profile?.name || item.user?.name || `Staff ${item.userId}`;
                const initials = getInitials(empName);
                const initialsBg = getAvatarBg(item.userId);

                return (
                  <View key={item.id} style={styles.detailCard}>
                    {/* Header: Avatar, Info & Days Badge */}
                    <View style={styles.cardHeaderRow}>
                      <View style={[styles.avatarBox, { backgroundColor: initialsBg }]}>
                        <Text style={styles.avatarText}>{initials}</Text>
                      </View>
                      <View style={styles.employeeMeta}>
                        <Text style={styles.empName}>{empName}</Text>
                        <View style={styles.subMetaRow}>
                          <Text style={styles.empSubText}>ID: {item.user?.profile?.staffId || '--'}</Text>
                        </View>
                      </View>
                      <View style={styles.daysBadge}>
                        <Text style={styles.daysBadgeText}>{item.days} {item.days === 1 ? 'Day' : 'Days'}</Text>
                      </View>
                    </View>

                    <View style={styles.divider} />

                    {/* Details: Type, Dates & Reason */}
                    <View style={styles.detailsBody}>
                      <View style={styles.metaLabelRow}>
                        <View style={[styles.catBadge, { backgroundColor: badge.bg }]}>
                          <Ionicons name={badge.icon} size={12} color={badge.color} style={{ marginRight: 4 }} />
                          <Text style={[styles.catBadgeText, { color: badge.color }]}>{badge.label}</Text>
                        </View>
                        <View style={[styles.statusBadge, { backgroundColor: statusStyle.bg }]}>
                          <Text style={[styles.statusBadgeText, { color: statusStyle.color }]}>{statusStyle.label}</Text>
                        </View>
                      </View>

                      {/* Date Row */}
                      <View style={styles.detailTextRow}>
                        <Ionicons name="calendar-outline" size={14} color="#6B7280" style={{ marginRight: 6 }} />
                        <Text style={styles.detailDateRangeText}>
                          {dayjs(item.startDate).format('DD MMM YYYY')} to {dayjs(item.endDate).format('DD MMM YYYY')}
                        </Text>
                      </View>

                      {/* Reason Row */}
                      {item.reason ? (
                        <View style={styles.noteBox}>
                          <Ionicons name="document-text-outline" size={13} color="#4B5563" style={{ marginRight: 6, marginTop: 1 }} />
                          <Text style={styles.noteText}>"{item.reason}"</Text>
                        </View>
                      ) : null}

                      {/* Review Note Row */}
                      {item.reviewNote ? (
                        <View style={[styles.noteBox, { backgroundColor: '#F0FDF4', borderColor: '#DCFCE7', borderWidth: 0.5 }]}>
                          <Ionicons name="checkmark-done-circle-outline" size={13} color="#16A34A" style={{ marginRight: 6, marginTop: 1 }} />
                          <Text style={[styles.noteText, { color: '#15803D' }]}>
                            Review Note: {item.reviewNote}
                          </Text>
                        </View>
                      ) : null}
                    </View>

                    {/* Pending Actions */}
                    {isPending && (
                      <View style={styles.actionsRow}>
                        <TouchableOpacity
                          style={styles.actionBtnReject}
                          onPress={() => handleRejectPrompt(item)}
                          disabled={actionLoadingId !== null}
                          activeOpacity={0.8}
                        >
                          <Ionicons name="close-circle-outline" size={16} color="#DC2626" />
                          <Text style={styles.actionRejectText}>Reject</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={styles.actionBtnApprove}
                          onPress={() => handleApprove(item.id)}
                          disabled={actionLoadingId !== null}
                          activeOpacity={0.8}
                        >
                          {actionLoadingId === item.id ? (
                            <ActivityIndicator size="small" color="#FFFFFF" />
                          ) : (
                            <>
                              <Ionicons name="checkmark-circle-outline" size={16} color="#FFFFFF" />
                              <Text style={styles.actionApproveText}>Approve</Text>
                            </>
                          )}
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                );
              })
            )
          )}

          {activeTab === 'requests' && showRequestPagination && (
            <PaginationControls
              page={requestPage}
              totalPages={requestTotalPages}
              totalItems={filteredRequests.length}
              pageSize={LEAVE_PAGE_SIZE}
              onPrev={() => setRequestPage(page => Math.max(1, page - 1))}
              onNext={() => setRequestPage(page => Math.min(requestTotalPages, page + 1))}
            />
          )}

          {/* Leave Balances Tab List */}
          {activeTab === 'balances' && (
            filteredStaff.length === 0 ? (
              <View style={styles.emptyBox}>
                <Ionicons name="people-outline" size={48} color="#D1D5DB" />
                <Text style={styles.emptyText}>No staff profiles found</Text>
                <Text style={styles.emptySub}>No results matched your search query.</Text>
              </View>
            ) : (
              paginatedStaff.map((staff) => {
                const initials = getInitials(staff.name);
                const initialsBg = getAvatarBg(staff.id);

                return (
                  <TouchableOpacity
                    key={staff.id}
                    style={styles.staffCard}
                    onPress={() => viewLeaveBalance(staff)}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.avatarBox, { backgroundColor: initialsBg }]}>
                      <Text style={styles.avatarText}>{initials}</Text>
                    </View>
                    <View style={styles.staffInfo}>
                      <Text style={styles.staffNameText}>{staff.name}</Text>
                      <Text style={styles.staffMetaText}>
                        {staff.designation || 'Staff'} • {staff.department || 'Unassigned'}
                      </Text>
                      {staff.staffId && <Text style={styles.staffIdText}>ID: {staff.staffId}</Text>}
                    </View>
                    <View style={styles.viewBalanceBtn}>
                      <Text style={styles.viewBalanceBtnText}>Balances</Text>
                      <Ionicons name="chevron-forward" size={14} color="#0F3B8C" />
                    </View>
                  </TouchableOpacity>
                );
              })
            )
          )}

          {activeTab === 'balances' && showBalancePagination && (
            <PaginationControls
              page={balancePage}
              totalPages={balanceTotalPages}
              totalItems={filteredStaff.length}
              pageSize={LEAVE_PAGE_SIZE}
              onPrev={() => setBalancePage(page => Math.max(1, page - 1))}
              onNext={() => setBalancePage(page => Math.min(balanceTotalPages, page + 1))}
            />
          )}
        </ScrollView>
      )}

      {/* Bottom Tabs navigation bar */}
      <BottomNav navigation={navigation} activeKey="Leave" />

      {/* 1. Leave Balance Details Modal */}
      <Modal
        visible={balanceModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setBalanceModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {/* Modal Header */}
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderTitleGroup}>
                <Text style={styles.modalTitle}>{selectedStaff?.name}</Text>
                <Text style={styles.modalSubtitle}>
                  {selectedStaff?.designation || 'Staff'} • {selectedStaff?.department || 'General'}
                </Text>
              </View>
              <TouchableOpacity style={styles.closeModalBtn} onPress={() => setBalanceModalVisible(false)}>
                <Ionicons name="close" size={24} color="#4B5563" />
              </TouchableOpacity>
            </View>

            {balanceLoading ? (
              <View style={styles.modalLoadingWrap}>
                <ActivityIndicator size="large" color="#0F3B8C" />
                <Text style={styles.modalLoadingText}>Loading leave balances...</Text>
              </View>
            ) : (
              <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
                {selectedStaffCycle && selectedStaffBalances.length > 0 && (
                  <View style={styles.cycleBadge}>
                    <Ionicons name="time-outline" size={13} color="#0F3B8C" style={{ marginRight: 5 }} />
                    <Text style={styles.cycleBadgeText}>
                      Cycle: {dayjs(selectedStaffCycle.start).format('DD MMM YYYY')} to {dayjs(selectedStaffCycle.end).format('DD MMM YYYY')} ({selectedStaffCycle.type || 'monthly'})
                    </Text>
                  </View>
                )}

                {selectedStaffBalances.length === 0 ? (
                  <View style={styles.modalEmptyBox}>
                    <Ionicons name="calendar-outline" size={40} color="#D1D5DB" />
                    <Text style={styles.modalEmptyText}>No Leave Template Assigned</Text>
                    <Text style={styles.modalEmptySub}>
                      This employee has no active leave templates or categories assigned in their profile.
                    </Text>
                  </View>
                ) : (
                  selectedStaffBalances.map((cat, idx) => {
                    const badge = getCategoryBadgeStyle(cat.key || cat.name);
                    const usageRate = cat.total > 0 ? cat.used / cat.total : 0;
                    const percentFilled = Math.min(100, Math.max(0, usageRate * 100));

                    return (
                      <View key={cat.key || idx} style={styles.balanceProgressCard}>
                        {/* Title Row */}
                        <View style={styles.balanceCardTitleRow}>
                          <View style={[styles.catBadge, { backgroundColor: badge.bg }]}>
                            <Ionicons name={badge.icon} size={12} color={badge.color} style={{ marginRight: 4 }} />
                            <Text style={[styles.catBadgeText, { color: badge.color }]}>{cat.name}</Text>
                          </View>
                          <Text style={styles.remCountText}>{cat.remaining} Left</Text>
                        </View>

                        {/* Progress Bar */}
                        <View style={styles.progressBarBg}>
                          <View style={[styles.progressBarFill, { width: `${percentFilled}%`, backgroundColor: badge.color }]} />
                        </View>

                        {/* Usage Metrics Info */}
                        <View style={styles.balanceGrid}>
                          <View style={styles.balanceGridCell}>
                            <Text style={styles.gridValText}>{cat.used}</Text>
                            <Text style={styles.gridLblText}>Used</Text>
                          </View>
                          <View style={styles.balanceGridCell}>
                            <Text style={styles.gridValText}>{cat.remaining}</Text>
                            <Text style={styles.gridLblText}>Available</Text>
                          </View>
                          <View style={styles.balanceGridCell}>
                            <Text style={styles.gridValText}>{cat.total}</Text>
                            <Text style={styles.gridLblText}>Total Allocated</Text>
                          </View>
                        </View>
                      </View>
                    );
                  })
                )}
                <View style={{ height: 32 }} />
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* 2. Rejection Reason Note Modal */}
      <Modal
        visible={rejectionModalVisible}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setRejectionModalVisible(false)}
      >
        <View style={styles.modalOverlayOverlay}>
          <View style={styles.rejectionCard}>
            <Text style={styles.rejModalTitle}>Reject Leave Request</Text>
            <Text style={styles.rejModalSubtitle}>
              Please provide a reason for rejecting the leave request from {requestToReject?.user?.profile?.name || requestToReject?.user?.name}.
            </Text>

            <TextInput
              style={styles.rejTextInput}
              multiline={true}
              numberOfLines={3}
              placeholder="e.g. Workload is high, please reschedule this leave..."
              value={rejectionNote}
              onChangeText={setRejectionNote}
              placeholderTextColor="#9CA3AF"
            />

            <View style={styles.rejButtonsRow}>
              <TouchableOpacity
                style={styles.rejCancelBtn}
                onPress={() => {
                  setRejectionModalVisible(false);
                  setRequestToReject(null);
                }}
              >
                <Text style={styles.rejCancelBtnText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.rejConfirmBtn} onPress={handleRejectConfirm}>
                <Text style={styles.rejConfirmBtnText}>Reject Request</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function PaginationControls({ page, totalPages, totalItems, pageSize, onPrev, onNext }) {
  const start = ((page - 1) * pageSize) + 1;
  const end = Math.min(page * pageSize, totalItems);

  return (
    <View style={styles.paginationCard}>
      <TouchableOpacity
        style={[styles.pageNavButton, page === 1 && styles.pageNavButtonDisabled]}
        onPress={onPrev}
        disabled={page === 1}
        activeOpacity={0.8}
      >
        <Ionicons name="chevron-back" size={18} color={page === 1 ? '#CBD5E1' : '#0F3B8C'} />
      </TouchableOpacity>

      <View style={styles.pageInfo}>
        <Text style={styles.pageInfoTitle}>Page {page} of {totalPages}</Text>
        <Text style={styles.pageInfoSub}>{start}-{end} of {totalItems}</Text>
      </View>

      <TouchableOpacity
        style={[styles.pageNavButton, page === totalPages && styles.pageNavButtonDisabled]}
        onPress={onNext}
        disabled={page === totalPages}
        activeOpacity={0.8}
      >
        <Ionicons name="chevron-forward" size={18} color={page === totalPages ? '#CBD5E1' : '#0F3B8C'} />
      </TouchableOpacity>
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

  // Segmented Navigation tabs
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
    gap: 6,
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

  filtersWrapper: {
    marginBottom: 4,
  },
  filterPillsContainer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
    gap: 8,
    flexDirection: 'row',
  },
  filterPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E9F0',
  },
  filterPillActive: {
    backgroundColor: '#E6F0FA',
    borderColor: '#0F3B8C',
  },
  filterPillText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    color: '#6B7280',
  },
  filterPillTextActive: {
    color: '#0F3B8C',
    fontFamily: 'Inter_600SemiBold',
  },

  // Search Container
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
  scrollContent: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 110 },

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

  // Requests Cards
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
    alignItems: 'center',
  },
  avatarBox: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
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
  daysBadge: {
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#DBEAFE',
  },
  daysBadgeText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
    color: '#0F3B8C',
  },
  divider: {
    height: 1,
    backgroundColor: '#F3F4F6',
    marginVertical: 12,
  },
  detailsBody: {
    gap: 10,
  },
  metaLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  catBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  catBadgeText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 10,
    textTransform: 'capitalize',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  statusBadgeText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 10,
  },
  detailTextRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  detailDateRangeText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    color: '#374151',
  },
  noteBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#F9FAFB',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  noteText: {
    flex: 1,
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    color: '#4B5563',
    fontStyle: 'italic',
    lineHeight: 15,
  },

  // Action Buttons inside Requests
  actionsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    paddingTop: 12,
  },
  actionBtnReject: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    paddingVertical: 8,
    borderRadius: 8,
    gap: 6,
  },
  actionRejectText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    color: '#DC2626',
  },
  actionBtnApprove: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0F3B8C',
    paddingVertical: 8,
    borderRadius: 8,
    gap: 6,
    elevation: 1,
    shadowColor: '#0F3B8C',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
  },
  actionApproveText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    color: '#FFFFFF',
  },

  // Staff Cards (Balances tab)
  staffCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#EFF2F7',
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.02,
    shadowRadius: 2,
  },
  staffInfo: {
    flex: 1,
    marginLeft: 12,
    gap: 2,
  },
  staffNameText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    color: '#111827',
  },
  staffMetaText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    color: '#6B7280',
  },
  staffIdText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 10,
    color: '#9CA3AF',
  },
  viewBalanceBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    gap: 2,
  },
  viewBalanceBtnText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 10,
    color: '#0F3B8C',
  },

  // Empty Box
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

  // Modal styling (balances details)
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '85%',
    paddingBottom: 24,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  modalHeaderTitleGroup: {
    gap: 2,
  },
  modalTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 16,
    color: '#111827',
  },
  modalSubtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: '#6B7280',
  },
  closeModalBtn: {
    padding: 4,
  },
  modalLoadingWrap: {
    paddingVertical: 64,
    alignItems: 'center',
  },
  modalLoadingText: {
    marginTop: 12,
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: '#6B7280',
  },
  modalScroll: {
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  cycleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    borderRadius: 8,
    padding: 10,
    marginBottom: 16,
    borderWidth: 0.5,
    borderColor: '#BFDBFE',
  },
  cycleBadgeText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    color: '#0F3B8C',
    flex: 1,
  },
  modalEmptyBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  modalEmptyText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
    color: '#4B5563',
    marginTop: 12,
  },
  modalEmptySub: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: '#9CA3AF',
    textAlign: 'center',
    marginTop: 4,
    paddingHorizontal: 20,
  },

  // Balance grid & cards inside Modal
  balanceProgressCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EFF2F7',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.02,
    shadowRadius: 2,
  },
  balanceCardTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  remCountText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 13,
    color: '#111827',
  },
  progressBarBg: {
    height: 6,
    backgroundColor: '#E5E9F0',
    borderRadius: 3,
    marginBottom: 14,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  balanceGrid: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    paddingTop: 10,
  },
  balanceGridCell: {
    flex: 1,
    alignItems: 'center',
  },
  gridValText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 13,
    color: '#111827',
  },
  gridLblText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 9,
    color: '#9CA3AF',
    marginTop: 2,
  },

  // Rejection Dialog Modal
  modalOverlayOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  rejectionCard: {
    backgroundColor: '#FFFFFF',
    width: '100%',
    borderRadius: 16,
    padding: 20,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
  },
  rejModalTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 16,
    color: '#111827',
  },
  rejModalSubtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: '#4B5563',
    marginTop: 6,
    lineHeight: 16,
  },
  rejTextInput: {
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E9F0',
    borderRadius: 8,
    padding: 10,
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: '#111827',
    marginTop: 12,
    textAlignVertical: 'top',
    height: 72,
  },
  rejButtonsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 16,
  },
  rejCancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#F3F4F6',
  },
  rejCancelBtnText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    color: '#4B5563',
  },
  rejConfirmBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#DC2626',
  },
  rejConfirmBtnText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    color: '#FFFFFF',
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
});
