import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
  Linking,
  Animated,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import dayjs from 'dayjs';
import BottomNav from '../components/BottomNav';
import api, { API_BASE_URL } from '../config/api';

const { width } = Dimensions.get('window');
const STAFF_PAGE_SIZE = 10;

const prefEarn = ['basic_salary', 'hra', 'da', 'special_allowance', 'travel_allowance', 'conveyance_allowance', 'medical_allowance', 'telephone_allowance', 'bonus', 'overtime'];
const prefDed = ['provident_fund', 'esi', 'professional_tax', 'income_tax', 'loan_deduction', 'other_deductions'];

const normalizeDeductions = (deductions) => {
  if (!deductions || typeof deductions !== 'object') return {};
  const d = { ...deductions };
  const pf = Number(d.provident_fund);
  const pfEmp = Number(d.provident_fund_employee);
  if ((!Number.isFinite(pf) || pf === 0) && Number.isFinite(pfEmp) && pfEmp !== 0) {
    d.provident_fund = pfEmp;
  }
  delete d.provident_fund_employee;
  delete d.provident_fund_employer;
  return d;
};

const formatShiftTime = (timeStr) => {
  if (!timeStr) return '';
  const parts = String(timeStr).split(':');
  if (parts.length < 2) return timeStr;
  let hours = parseInt(parts[0], 10);
  const minutes = parts[1];
  if (isNaN(hours)) return timeStr;
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  const strHours = hours < 10 ? '0' + hours : hours;
  return `${strHours}:${minutes} ${ampm}`;
};


const extractSV = (u) => {
  let sv = u?.salaryValues;
  if (typeof sv === 'string') {
    try { sv = JSON.parse(sv); } catch { sv = null; }
  }
  // Helper to build base from numeric columns
  const baseFromNumerics = () => {
    const e = {}; const d = {};
    const camelMap = {
      basic_salary: 'basicSalary',
      hra: 'hra',
      da: 'da',
      special_allowance: 'specialAllowance',
      travel_allowance: 'travelAllowance',
      conveyance_allowance: 'conveyanceAllowance',
      medical_allowance: 'medicalAllowance',
      telephone_allowance: 'telephoneAllowance',
      bonus: 'bonus',
      overtime: 'overtime',
      provident_fund: 'providentFund',
      esi: 'esi',
      professional_tax: 'professionalTax',
      income_tax: 'incomeTax',
      loan_deduction: 'loanDeduction',
      other_deductions: 'otherDeductions',
    };
    const pick = (snakeKey) => {
      const camelKey = camelMap[snakeKey];
      const v1 = Number(u?.[snakeKey]);
      const v2 = camelKey ? Number(u?.[camelKey]) : 0;
      return Number.isFinite(v1) && v1 !== 0 ? v1 : (Number.isFinite(v2) ? v2 : 0);
    };
    const earnKeys = ['basic_salary', 'hra', 'da', 'special_allowance', 'travel_allowance', 'conveyance_allowance', 'medical_allowance', 'telephone_allowance', 'bonus', 'overtime'];
    earnKeys.forEach(k => { const v = pick(k); if (v) e[k.toLowerCase()] = v; });
    const dedKeys = ['provident_fund', 'esi', 'professional_tax', 'income_tax', 'loan_deduction', 'other_deductions'];
    dedKeys.forEach(k => { const v = pick(k); if (v) d[k.toLowerCase()] = v; });
    return { earnings: e, deductions: d };
  };
  const norm = (s = '') => s.toLowerCase().replace(/[_\s]/g, '');
  if (sv && typeof sv === 'object') {
    const e = {};
    const d = {};

    if (sv.earnings && typeof sv.earnings === 'object') {
      Object.entries(sv.earnings).forEach(([k, v]) => { if (k) e[norm(k)] = v; });
    }
    if (sv.deductions && typeof sv.deductions === 'object') {
      Object.entries(normalizeDeductions(sv.deductions)).forEach(([k, v]) => { if (k) d[norm(k)] = v; });
    }

    // If base earnings/deductions are empty, derive from numeric columns as fallback
    let noBaseEarn = Object.keys(e).length === 0;
    let noBaseDed = Object.keys(d).length === 0;

    if (noBaseEarn || noBaseDed) {
      const base = baseFromNumerics();
      if (noBaseEarn) Object.assign(e, base.earnings);
      if (noBaseDed) Object.assign(d, base.deductions);
    }

    return {
      earnings: e,
      deductions: d,
      lastUpdatedMonth: sv.lastUpdatedMonth,
      lastUpdatedMonthKey: sv.lastUpdatedMonthKey,
      months: sv.months
    };
  }
  const base = baseFromNumerics();
  const res = { earnings: {}, deductions: {} };
  Object.entries(base.earnings).forEach(([k, v]) => res.earnings[norm(k)] = v);
  Object.entries(base.deductions).forEach(([k, v]) => res.deductions[norm(k)] = v);
  return res;
};

const toEntries = (obj) => Object.entries(obj || {});

const orderByPref = (entries, pref, templateKeys = null) => {
  const norm = (s = '') => s.toLowerCase().replace(/[_\s]/g, '');
  const map = new Map();

  entries.forEach(([k, v]) => {
    const nk = norm(k);
    if (nk) {
      const existing = map.get(nk);
      map.set(nk, { key: k, value: (existing ? existing.value : 0) + (Number(v) || 0) });
    }
  });

  const used = new Set();
  const ordered = [];
  const effectivePref = templateKeys && templateKeys.length > 0 ? templateKeys : pref;

  effectivePref.forEach(k => {
    if (!k) return;
    const nk = norm(k);
    const existing = map.get(nk);
    ordered.push([k, existing ? existing.value : 0]);
    used.add(nk);
  });

  entries.forEach(([k, v]) => {
    const nk = norm(k);
    if (nk && !used.has(nk)) {
      ordered.push([k, v]);
      used.add(nk);
    }
  });

  return ordered;
};

const labelize = (k, tplKeys = []) => {
  if (!k) return '';
  const norm = (s = '') => s.toLowerCase().replace(/[_\s]/g, '');
  const nk = norm(k);
  const match = tplKeys.find(tk => norm(tk) === nk);
  if (match) return match;
  const upper = { hra: 'HRA', da: 'DA', pf: 'PF', esi: 'ESI' };
  if (upper[k.toLowerCase()]) return upper[k.toLowerCase()];
  if (nk === 'providentfund' || nk === 'providentfundemployee') return 'Employee PF';
  return k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
};

const StaffScreen = ({ navigation }) => {
  const [unreadCount, setUnreadCount] = useState(0);
  const [authToken, setAuthToken] = useState(null);
 
   useEffect(() => {
     const loadToken = async () => {
       try {
         const token = await AsyncStorage.getItem('auth_token');
         setAuthToken(token);
       } catch (err) {
         console.log('Error loading token in StaffScreen:', err);
       }
     };
     loadToken();
   }, []);

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

  const [staffList, setStaffList] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDept, setSelectedDept] = useState('All');
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // States for Staff Detail Modal
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [selectedStaff, setSelectedStaff] = useState(null);
  const [modalActiveTab, setModalActiveTab] = useState('profile'); // 'profile' | 'attendance' | 'salaryOverview' | 'salaryStructure' | 'educationExperience' | 'leaves' | 'expenses' | 'documents'
  const [salaryTemplates, setSalaryTemplates] = useState([]);



  // New States for Detail Tabs
  const [attMonth, setAttMonth] = useState(dayjs());
  const [attRows, setAttRows] = useState([]);
  const [attStats, setAttStats] = useState({});
  const [attLoading, setAttLoading] = useState(false);

  const [salaryMonth, setSalaryMonth] = useState(dayjs());
  const [salaryPayrollLine, setSalaryPayrollLine] = useState(null);
  const [salaryCycleData, setSalaryCycleData] = useState(null);
  const [salaryLoading, setSalaryLoading] = useState(false);

  const [leavesList, setLeavesList] = useState([]);
  const [leavesLoading, setLeavesLoading] = useState(false);
  const [leaveToReject, setLeaveToReject] = useState(null);
  const [leaveRejectionNote, setLeaveRejectionNote] = useState('');
  const [leaveRejectionModalVisible, setLeaveRejectionModalVisible] = useState(false);

  const [expensesList, setExpensesList] = useState([]);
  const [expensesLoading, setExpensesLoading] = useState(false);

  const [documentsList, setDocumentsList] = useState([]);
  const [docsLoading, setDocsLoading] = useState(false);

  // Premium Tab Fade Animation Hook
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const isActiveTabLoading = useMemo(() => {
    if (modalActiveTab === 'attendance') return attLoading;
    if (modalActiveTab === 'salaryOverview') return salaryLoading;
    if (modalActiveTab === 'leaves') return leavesLoading;
    if (modalActiveTab === 'expenses') return expensesLoading;
    if (modalActiveTab === 'documents') return docsLoading;
    return false;
  }, [modalActiveTab, attLoading, salaryLoading, leavesLoading, expensesLoading, docsLoading]);

  useEffect(() => {
    fadeAnim.setValue(0.3);
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 250,
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [modalActiveTab, isActiveTabLoading]);

  const getFullUrl = (url) => {
    if (!url) return '';
    const cleanUrl = url.startsWith('http') ? url : `${API_BASE_URL}${url}`;
    if (authToken) {
      const sep = cleanUrl.includes('?') ? '&' : '?';
      return `${cleanUrl}${sep}token=${encodeURIComponent(authToken)}`;
    }
    return cleanUrl;
  };

  const fetchAttendanceOverview = useCallback(async (staffId, monthStr) => {
    try {
      setAttLoading(true);
      const res = await api.get(`/admin/staff/${staffId}/attendance-overview`, {
        params: { month: monthStr }
      });
      if (res.data?.success) {
        setAttRows(res.data.dailyData || []);
        setAttStats(res.data.stats || {});
      } else {
        setAttRows([]);
        setAttStats({});
      }
    } catch (err) {
      console.log('Error fetching attendance overview:', err);
      setAttRows([]);
      setAttStats({});
    } finally {
      setAttLoading(false);
    }
  }, []);

  const fetchSalaryOverview = useCallback(async (staffId, monthStr) => {
    try {
      setSalaryLoading(true);
      const res = await api.get(`/admin/payroll?monthKey=${monthStr}&staffId=${staffId}`);
      if (res.data?.success) {
        setSalaryCycleData(res.data.cycle || null);
        const userLine = res.data.lines?.find(line => Number(line.userId) === Number(staffId));
        setSalaryPayrollLine(userLine || null);
      } else {
        setSalaryPayrollLine(null);
        setSalaryCycleData(null);
      }
    } catch (err) {
      console.log('Error fetching salary overview:', err);
      setSalaryPayrollLine(null);
      setSalaryCycleData(null);
    } finally {
      setSalaryLoading(false);
    }
  }, []);

  const fetchLeavesList = useCallback(async (staffId) => {
    try {
      setLeavesLoading(true);
      const res = await api.get(`/admin/staff/${staffId}/leaves`);
      if (res.data?.success) {
        setLeavesList(res.data.data || []);
      } else {
        setLeavesList([]);
      }
    } catch (err) {
      console.log('Error fetching leaves list:', err);
      setLeavesList([]);
    } finally {
      setLeavesLoading(false);
    }
  }, []);

  const fetchExpensesList = useCallback(async (staffId) => {
    try {
      setExpensesLoading(true);
      const res = await api.get(`/admin/staff/${staffId}/expenses`);
      if (res.data?.success) {
        setExpensesList(res.data.data || []);
      } else {
        setExpensesList([]);
      }
    } catch (err) {
      console.log('Error fetching expenses list:', err);
      setExpensesList([]);
    } finally {
      setExpensesLoading(false);
    }
  }, []);

  const fetchDocumentsList = useCallback(async (staffId) => {
    try {
      setDocsLoading(true);
      const res = await api.get(`/admin/staff/${staffId}/documents`);
      if (res.data?.success) {
        setDocumentsList(res.data.data || []);
      } else {
        setDocumentsList([]);
      }
    } catch (err) {
      console.log('Error fetching documents list:', err);
      setDocumentsList([]);
    } finally {
      setDocsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedStaff) return;
    const staffId = selectedStaff.id;

    if (modalActiveTab === 'attendance') {
      fetchAttendanceOverview(staffId, attMonth.format('YYYY-MM'));
    } else if (modalActiveTab === 'salaryOverview') {
      fetchSalaryOverview(staffId, salaryMonth.format('YYYY-MM'));
    } else if (modalActiveTab === 'leaves') {
      fetchLeavesList(staffId);
    } else if (modalActiveTab === 'expenses') {
      fetchExpensesList(staffId);
    } else if (modalActiveTab === 'documents') {
      fetchDocumentsList(staffId);
    }
  }, [selectedStaff, modalActiveTab, attMonth, salaryMonth, fetchAttendanceOverview, fetchSalaryOverview, fetchLeavesList, fetchExpensesList, fetchDocumentsList]);

  // Leave approval & rejection
  const handleApproveLeave = async (leaveId) => {
    if (!selectedStaff) return;
    try {
      const res = await api.patch(`/leave/${leaveId}/status`, { status: 'APPROVED' });
      if (res.data?.success) {
        Alert.alert('Success', 'Leave request has been approved.');
        fetchLeavesList(selectedStaff.id);
      } else {
        Alert.alert('Error', res.data?.message || 'Failed to approve request.');
      }
    } catch (err) {
      Alert.alert('Error', err.response?.data?.message || 'Failed to approve request.');
    }
  };

  const handleRejectConfirmLeave = async () => {
    if (!selectedStaff || !leaveToReject) return;
    const leaveId = leaveToReject.id;
    try {
      const res = await api.patch(`/leave/${leaveId}/status`, {
        status: 'REJECTED',
        note: leaveRejectionNote || 'Rejected by Admin'
      });
      if (res.data?.success) {
        Alert.alert('Success', 'Leave request has been rejected.');
        setLeaveRejectionModalVisible(false);
        setLeaveToReject(null);
        setLeaveRejectionNote('');
        fetchLeavesList(selectedStaff.id);
      } else {
        Alert.alert('Error', res.data?.message || 'Failed to reject request.');
      }
    } catch (err) {
      Alert.alert('Error', err.response?.data?.message || 'Failed to reject request.');
    }
  };

  // Expense approval & rejection
  const handleApproveExpense = async (claim) => {
    if (!selectedStaff) return;
    try {
      const res = await api.put(`/admin/expenses/${claim.id}/status`, {
        status: 'approved',
        approvedAmount: claim.amount
      });
      if (res.data?.success) {
        Alert.alert('Success', 'Expense claim approved successfully.');
        fetchExpensesList(selectedStaff.id);
      } else {
        Alert.alert('Error', res.data?.message || 'Failed to approve expense.');
      }
    } catch (err) {
      Alert.alert('Error', err.response?.data?.message || 'Failed to approve expense.');
    }
  };

  const handleRejectExpense = async (claimId) => {
    if (!selectedStaff) return;
    try {
      const res = await api.put(`/admin/expenses/${claimId}/status`, {
        status: 'rejected'
      });
      if (res.data?.success) {
        Alert.alert('Success', 'Expense claim rejected successfully.');
        fetchExpensesList(selectedStaff.id);
      } else {
        Alert.alert('Error', res.data?.message || 'Failed to reject expense.');
      }
    } catch (err) {
      Alert.alert('Error', err.response?.data?.message || 'Failed to reject expense.');
    }
  };

  // States for Add Employee Modal
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [addName, setAddName] = useState('');
  const [addPhone, setAddPhone] = useState('');
  const [addStaffId, setAddStaffId] = useState('');
  const [addDesignation, setAddDesignation] = useState('');
  const [addDepartment, setAddDepartment] = useState('');
  const [addEmail, setAddEmail] = useState('');
  const [addStaffType, setAddStaffType] = useState('monthly'); // 'monthly' | 'daily' | 'hourly' | 'weekly'
  const [addShiftSelection, setAddShiftSelection] = useState('Standard Shift');
  const [addMobilePunchEnabled, setAddMobilePunchEnabled] = useState(true);
  const [addQrPunchEnabled, setAddQrPunchEnabled] = useState(true);
  const [addDateOfJoining, setAddDateOfJoining] = useState(dayjs().format('YYYY-MM-DD'));
  const [addEducation, setAddEducation] = useState('');
  const [addExperience, setAddExperience] = useState('');

  // Fetch staff list
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

  const fetchSalaryTemplates = useCallback(async () => {
    try {
      const res = await api.get('/admin/salary-templates');
      if (res.data?.success) {
        setSalaryTemplates(res.data.data || []);
      }
    } catch (err) {
      console.log('Error fetching salary templates:', err);
    }
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchStaff(), fetchSalaryTemplates()]);
    setLoading(false);
  }, [fetchStaff, fetchSalaryTemplates]);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([fetchStaff(), fetchSalaryTemplates()]);
    setRefreshing(false);
  };

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Logout actions
  const doLogout = async () => {
    try {
      const storedRefreshToken = await AsyncStorage.getItem('refresh_token');
      if (storedRefreshToken) {
        await api.post('/auth/logout-mobile', { refreshToken: storedRefreshToken });
      }
    } catch (e) {
      console.log('Logout API failed:', e);
    } finally {
      await AsyncStorage.removeItem('auth_token');
      await AsyncStorage.removeItem('refresh_token');
      await AsyncStorage.removeItem('user');
      await AsyncStorage.removeItem('orgId');
      await AsyncStorage.removeItem('orgData');
      navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
    }
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

  // Add Staff submission
  const handleAddStaff = async () => {
    if (!addName.trim()) {
      Alert.alert('Validation Error', 'Please enter employee name');
      return;
    }
    if (!addPhone.trim()) {
      Alert.alert('Validation Error', 'Please enter 10-digit phone number');
      return;
    }
    if (addPhone.replace(/[^0-9]/g, '').length !== 10) {
      Alert.alert('Validation Error', 'Phone number must be exactly 10 digits');
      return;
    }

    try {
      setLoading(true);
      const payload = {
        name: addName.trim(),
        phone: addPhone.trim(),
        staffId: addStaffId.trim() || undefined,
        designation: addDesignation.trim() || undefined,
        department: addDepartment.trim() || undefined,
        email: addEmail.trim() || undefined,
        staffType: addStaffType,
        shiftSelection: addShiftSelection,
        mobilePunchEnabled: addMobilePunchEnabled,
        qrPunchEnabled: addQrPunchEnabled,
        dateOfJoining: addDateOfJoining,
        education: addEducation.trim() || undefined,
        experience: addExperience.trim() || undefined,
        active: true
      };

      const res = await api.post('/staff', payload);
      if (res.data?.success) {
        Alert.alert('Success', 'New employee added successfully!');
        setAddModalVisible(false);
        // Reset form
        setAddName('');
        setAddPhone('');
        setAddStaffId('');
        setAddDesignation('');
        setAddDepartment('');
        setAddEmail('');
        setAddStaffType('monthly');
        setAddShiftSelection('Standard Shift');
        setAddMobilePunchEnabled(true);
        setAddQrPunchEnabled(true);
        setAddDateOfJoining(dayjs().format('YYYY-MM-DD'));
        setAddEducation('');
        setAddExperience('');
        // Refresh
        fetchStaff();
      } else {
        Alert.alert('Error', res.data?.message || 'Failed to add employee');
      }
    } catch (err) {
      console.log('Error adding staff:', err);
      Alert.alert('Error', err.response?.data?.message || 'Server error while adding employee');
    } finally {
      setLoading(false);
    }
  };

  // Toggle punch or access settings with optimistic UI updates
  const toggleSetting = async (field, currentValue) => {
    if (!selectedStaff) return;
    const updatedValue = !currentValue;

    // Optimistic UI updates in both detail modal state and staffList state
    const originalStaff = { ...selectedStaff };
    setSelectedStaff(prev => ({ ...prev, [field]: updatedValue }));
    setStaffList(prev => prev.map(s => s.id === selectedStaff.id ? { ...s, [field]: updatedValue } : s));

    try {
      const res = await api.put(`/staff/${selectedStaff.id}`, { [field]: updatedValue });
      if (!res.data?.success) {
        // Rollback
        setSelectedStaff(originalStaff);
        setStaffList(prev => prev.map(s => s.id === selectedStaff.id ? originalStaff : s));
        Alert.alert('Error', res.data?.message || 'Failed to update setting');
      }
    } catch (err) {
      console.log('Error updating setting:', err);
      // Rollback
      setSelectedStaff(originalStaff);
      setStaffList(prev => prev.map(s => s.id === selectedStaff.id ? originalStaff : s));
      Alert.alert('Error', err.response?.data?.message || 'Server error');
    }
  };

  // Toggle employee Active/Inactive status
  const toggleStaffActive = async (staffId, isCurrentlyActive) => {
    const nextActiveState = !isCurrentlyActive;
    const confirmMsg = nextActiveState
      ? 'Are you sure you want to ACTIVATE this employee?'
      : 'Are you sure you want to DEACTIVATE this employee? Deactivated employees cannot check-in/out or use the portal.';

    const performToggle = async () => {
      try {
        setLoading(true);
        const res = await api.put(`/staff/${staffId}/active`, { active: nextActiveState });
        if (res.data?.success) {
          setStaffList(prevList =>
            prevList.map(s => (s.id === staffId ? { ...s, active: nextActiveState } : s))
          );
          if (selectedStaff && selectedStaff.id === staffId) {
            setSelectedStaff(prev => ({ ...prev, active: nextActiveState }));
          }
          Alert.alert('Success', `Employee ${nextActiveState ? 'activated' : 'deactivated'} successfully`);
        } else {
          Alert.alert('Error', res.data?.message || 'Failed to change status');
        }
      } catch (err) {
        console.log('Error toggling active status:', err);
        Alert.alert('Error', err.response?.data?.message || 'Server error while toggling status');
      } finally {
        setLoading(false);
      }
    };

    if (Platform.OS === 'web') {
      if (window.confirm(confirmMsg)) {
        performToggle();
      }
    } else {
      Alert.alert(
        nextActiveState ? 'Activate Staff' : 'Deactivate Staff',
        confirmMsg,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: nextActiveState ? 'Activate' : 'Deactivate', style: 'destructive', onPress: performToggle }
        ]
      );
    }
  };

  // Delete employee permanently
  const confirmDeleteStaff = (staffId) => {
    const performDelete = async () => {
      try {
        setLoading(true);
        const res = await api.delete(`/staff/${staffId}`);
        if (res.data?.success) {
          Alert.alert('Deleted', 'Employee deleted successfully');
          setDetailModalVisible(false);
          fetchStaff();
        } else {
          Alert.alert('Error', res.data?.message || 'Failed to delete employee');
        }
      } catch (err) {
        console.log('Error deleting staff:', err);
        Alert.alert('Error', err.response?.data?.message || 'Server error while deleting employee');
      } finally {
        setLoading(false);
      }
    };

    const confirmMsg = 'Are you sure you want to permanently delete this employee? This action cannot be undone and will delete all their historical profile data.';

    if (Platform.OS === 'web') {
      if (window.confirm(confirmMsg)) {
        performDelete();
      }
    } else {
      Alert.alert(
        'Delete Employee',
        confirmMsg,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: performDelete }
        ]
      );
    }
  };

  // Extract unique departments dynamically
  const departmentsList = useMemo(() => {
    const depts = new Set(['All']);
    staffList.forEach(s => {
      if (s.department) depts.add(s.department);
    });
    return Array.from(depts);
  }, [staffList]);

  // Filter & Search staff list
  const filteredStaff = useMemo(() => {
    return staffList.filter(staff => {
      // 1. Department Filter
      if (selectedDept !== 'All' && staff.department !== selectedDept) return false;

      // 2. Search query filter
      const name = (staff.name || '').toLowerCase();
      const dept = (staff.department || '').toLowerCase();
      const desig = (staff.designation || '').toLowerCase();
      const phone = (staff.phone || '').toLowerCase();
      const sId = (staff.staffId || '').toLowerCase();
      const query = searchQuery.toLowerCase();

      return name.includes(query) || dept.includes(query) || desig.includes(query) || phone.includes(query) || sId.includes(query);
    });
  }, [staffList, selectedDept, searchQuery]);

  useEffect(() => {
    setCurrentPage(1);
  }, [selectedDept, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredStaff.length / STAFF_PAGE_SIZE));

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  const paginatedStaff = useMemo(() => {
    const start = (currentPage - 1) * STAFF_PAGE_SIZE;
    return filteredStaff.slice(start, start + STAFF_PAGE_SIZE);
  }, [filteredStaff, currentPage]);

  const showPagination = filteredStaff.length > STAFF_PAGE_SIZE;

  const fetchStaffDetails = async (staffId) => {
    try {
      const res = await api.get(`/admin/staff/${staffId}`);
      if (res.data?.success) {
        setSelectedStaff(res.data.staff);
      }
    } catch (err) {
      console.log('Error fetching detailed staff profile:', err);
    }
  };

  const openStaffDetails = (staff) => {
    setSelectedStaff(staff);
    setModalActiveTab('profile');
    setDetailModalVisible(true);
    fetchStaffDetails(staff.id);
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

  const totalStaffCount = staffList.length;
  const activeStaffCount = staffList.filter(s => s.active !== false).length;
  const inactiveStaffCount = staffList.filter(s => s.active === false).length;

  return (
    <View style={styles.screen}>
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Staff Management</Text>
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

      {/* Summary Cards Row */}
      <View style={styles.summaryCardsRow}>
        <View style={[styles.summaryCard, { borderLeftColor: '#0F3B8C' }]}>
          <Text style={styles.summaryCardLabel}>Total Staff</Text>
          <Text style={[styles.summaryCardValue, { color: '#0F3B8C' }]}>{totalStaffCount}</Text>
        </View>
        <View style={[styles.summaryCard, { borderLeftColor: '#16A34A' }]}>
          <Text style={styles.summaryCardLabel}>Active Staff</Text>
          <Text style={[styles.summaryCardValue, { color: '#16A34A' }]}>{activeStaffCount}</Text>
        </View>
        <View style={[styles.summaryCard, { borderLeftColor: '#DC2626' }]}>
          <Text style={styles.summaryCardLabel}>Inactive Staff</Text>
          <Text style={[styles.summaryCardValue, { color: '#DC2626' }]}>{inactiveStaffCount}</Text>
        </View>
      </View>

      {/* Dynamic Department Filter Pills */}
      <View style={styles.filterWrapper}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterPillsContainer}
        >
          {departmentsList.map((dept) => {
            const isActive = selectedDept === dept;
            const count = staffList.filter(s => dept === 'All' || s.department === dept).length;
            return (
              <TouchableOpacity
                key={dept}
                style={[styles.filterPill, isActive && styles.filterPillActive]}
                onPress={() => setSelectedDept(dept)}
                activeOpacity={0.8}
              >
                <Text style={[styles.filterPillText, isActive && styles.filterPillTextActive]}>
                  {dept} ({count})
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Search Bar */}
        <View style={styles.searchContainer}>
          <Ionicons name="search-outline" size={18} color="#9CA3AF" style={styles.searchIcon} />
          <TextInput
            placeholder="Search by name, ID, phone, designation..."
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

      {/* Main Staff List */}
      {loading && !refreshing ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color="#0F3B8C" />
          <Text style={styles.loadingText}>Loading employees...</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#0F3B8C" />}
        >
          {filteredStaff.length === 0 ? (
            <View style={styles.emptyBox}>
              <Ionicons name="people-outline" size={48} color="#D1D5DB" />
              <Text style={styles.emptyText}>No employees found</Text>
              <Text style={styles.emptySub}>No results matches your search query or selected department.</Text>
            </View>
          ) : (
            paginatedStaff.map((staff) => {
              const initials = getInitials(staff.name);
              const initialsBg = getAvatarBg(staff.id);
              const isActive = staff.active !== false;

              return (
                <TouchableOpacity
                  key={staff.id}
                  style={styles.staffCard}
                  onPress={() => openStaffDetails(staff)}
                  activeOpacity={0.75}
                >
                  {/* Top Row: Avatar & Primary Info */}
                  <View style={styles.staffCardHeader}>
                    <View style={[styles.avatarBox, { backgroundColor: initialsBg }]}>
                      <Text style={styles.avatarText}>{initials}</Text>
                    </View>
                    <View style={styles.staffCardMeta}>
                      <Text style={styles.staffName}>{staff.name}</Text>
                      <Text style={styles.staffDesigText}>
                        {staff.designation || 'Staff'} • {staff.department || 'General'}
                      </Text>
                      {staff.staffId && <Text style={styles.staffIdText}>ID: {staff.staffId}</Text>}
                    </View>
                    <View style={[styles.statusBadge, { backgroundColor: isActive ? '#F0FDF4' : '#FEF2F2' }]}>
                      <Text style={[styles.statusBadgeText, { color: isActive ? '#16A34A' : '#DC2626' }]}>
                        {isActive ? 'Active' : 'Inactive'}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.divider} />

                  {/* Body Details: Contact & Settings Shortcuts */}
                  <View style={styles.staffCardBody}>
                    <View style={styles.cardInfoRow}>
                      <Ionicons name="call-outline" size={13} color="#6B7280" style={{ marginRight: 6 }} />
                      <Text style={styles.cardInfoText}>{staff.phone || '--'}</Text>
                    </View>
                    {staff.email && (
                      <View style={styles.cardInfoRow}>
                        <Ionicons name="mail-outline" size={13} color="#6B7280" style={{ marginRight: 6 }} />
                        <Text style={styles.cardInfoText} numberOfLines={1}>{staff.email}</Text>
                      </View>
                    )}
                  </View>

                  {/* Badge Shortcuts Row */}
                  <View style={styles.shortcutBadgesRow}>
                    {staff.staffType && (
                      <View style={[styles.shortcutBadge, { backgroundColor: '#F3F4F6' }]}>
                        <Text style={[styles.shortcutBadgeText, { color: '#4B5563', textTransform: 'capitalize' }]}>
                          {staff.staffType}
                        </Text>
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })
          )}

          {showPagination && (
            <View style={styles.paginationCard}>
              <TouchableOpacity
                style={[styles.pageNavButton, currentPage === 1 && styles.pageNavButtonDisabled]}
                onPress={() => setCurrentPage(page => Math.max(1, page - 1))}
                disabled={currentPage === 1}
                activeOpacity={0.8}
              >
                <Ionicons name="chevron-back" size={18} color={currentPage === 1 ? '#CBD5E1' : '#0F3B8C'} />
              </TouchableOpacity>

              <View style={styles.pageInfo}>
                <Text style={styles.pageInfoTitle}>Page {currentPage} of {totalPages}</Text>
                <Text style={styles.pageInfoSub}>
                  {((currentPage - 1) * STAFF_PAGE_SIZE) + 1}-{Math.min(currentPage * STAFF_PAGE_SIZE, filteredStaff.length)} of {filteredStaff.length}
                </Text>
              </View>

              <TouchableOpacity
                style={[styles.pageNavButton, currentPage === totalPages && styles.pageNavButtonDisabled]}
                onPress={() => setCurrentPage(page => Math.min(totalPages, page + 1))}
                disabled={currentPage === totalPages}
                activeOpacity={0.8}
              >
                <Ionicons name="chevron-forward" size={18} color={currentPage === totalPages ? '#CBD5E1' : '#0F3B8C'} />
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      )}

      {/* Navigation tabs */}
      <BottomNav navigation={navigation} activeKey="Staff" />

      {/* Employee Detailed Profile Modal */}
      <Modal
        visible={detailModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setDetailModalVisible(false)}
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
              <TouchableOpacity style={styles.closeModalBtn} onPress={() => setDetailModalVisible(false)}>
                <Ionicons name="close" size={24} color="#4B5563" />
              </TouchableOpacity>
            </View>

            {/* Modal Segmented Tabs */}
            <View style={styles.modalTabsContainer}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.modalTabsScrollContent}>
                <TouchableOpacity
                  style={[styles.modalTab, styles.modalTabScrollable, modalActiveTab === 'profile' && styles.modalTabActive]}
                  onPress={() => setModalActiveTab('profile')}
                  activeOpacity={0.8}
                >
                  <Ionicons name="person-outline" size={14} color={modalActiveTab === 'profile' ? '#0F3B8C' : '#6B7280'} />
                  <Text numberOfLines={1} style={[styles.modalTabLabel, modalActiveTab === 'profile' && styles.modalTabLabelActive]}>Profile</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalTab, styles.modalTabScrollable, modalActiveTab === 'attendance' && styles.modalTabActive]}
                  onPress={() => setModalActiveTab('attendance')}
                  activeOpacity={0.8}
                >
                  <Ionicons name="calendar-outline" size={14} color={modalActiveTab === 'attendance' ? '#0F3B8C' : '#6B7280'} />
                  <Text numberOfLines={1} style={[styles.modalTabLabel, modalActiveTab === 'attendance' && styles.modalTabLabelActive]}>Attendance</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalTab, styles.modalTabScrollable, modalActiveTab === 'salaryOverview' && styles.modalTabActive]}
                  onPress={() => setModalActiveTab('salaryOverview')}
                  activeOpacity={0.8}
                >
                  <Ionicons name="cash-outline" size={14} color={modalActiveTab === 'salaryOverview' ? '#0F3B8C' : '#6B7280'} />
                  <Text numberOfLines={1} style={[styles.modalTabLabel, modalActiveTab === 'salaryOverview' && styles.modalTabLabelActive]}>Salary Overview</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalTab, styles.modalTabScrollable, modalActiveTab === 'salaryStructure' && styles.modalTabActive]}
                  onPress={() => setModalActiveTab('salaryStructure')}
                  activeOpacity={0.8}
                >
                  <Ionicons name="wallet-outline" size={14} color={modalActiveTab === 'salaryStructure' ? '#0F3B8C' : '#6B7280'} />
                  <Text numberOfLines={1} style={[styles.modalTabLabel, modalActiveTab === 'salaryStructure' && styles.modalTabLabelActive]}>Salary Structure</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalTab, styles.modalTabScrollable, modalActiveTab === 'educationExperience' && styles.modalTabActive]}
                  onPress={() => setModalActiveTab('educationExperience')}
                  activeOpacity={0.8}
                >
                  <Ionicons name="school-outline" size={14} color={modalActiveTab === 'educationExperience' ? '#0F3B8C' : '#6B7280'} />
                  <Text numberOfLines={1} style={[styles.modalTabLabel, modalActiveTab === 'educationExperience' && styles.modalTabLabelActive]}>Edu & Exp</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalTab, styles.modalTabScrollable, modalActiveTab === 'leaves' && styles.modalTabActive]}
                  onPress={() => setModalActiveTab('leaves')}
                  activeOpacity={0.8}
                >
                  <Ionicons name="airplane-outline" size={14} color={modalActiveTab === 'leaves' ? '#0F3B8C' : '#6B7280'} />
                  <Text numberOfLines={1} style={[styles.modalTabLabel, modalActiveTab === 'leaves' && styles.modalTabLabelActive]}>Leave(s)</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalTab, styles.modalTabScrollable, modalActiveTab === 'expenses' && styles.modalTabActive]}
                  onPress={() => setModalActiveTab('expenses')}
                  activeOpacity={0.8}
                >
                  <Ionicons name="receipt-outline" size={14} color={modalActiveTab === 'expenses' ? '#0F3B8C' : '#6B7280'} />
                  <Text numberOfLines={1} style={[styles.modalTabLabel, modalActiveTab === 'expenses' && styles.modalTabLabelActive]}>Expenses</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalTab, styles.modalTabScrollable, modalActiveTab === 'documents' && styles.modalTabActive]}
                  onPress={() => setModalActiveTab('documents')}
                  activeOpacity={0.8}
                >
                  <Ionicons name="document-text-outline" size={14} color={modalActiveTab === 'documents' ? '#0F3B8C' : '#6B7280'} />
                  <Text numberOfLines={1} style={[styles.modalTabLabel, modalActiveTab === 'documents' && styles.modalTabLabelActive]}>Documents</Text>
                </TouchableOpacity>
              </ScrollView>
            </View>

            {/* Modal Scroll Content */}
            <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
              <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
              
              {/* TAB: PROFILE */}
              {modalActiveTab === 'profile' && (
                <View style={styles.detailsSection}>
                  <Text style={styles.sectionSubtitle}>Profile Information</Text>
                  <ProfileDetailRow icon="person-outline" label="Name" value={selectedStaff?.profile?.name || selectedStaff?.name} />
                  <ProfileDetailRow icon="finger-print-outline" label="Staff ID" value={selectedStaff?.profile?.staffId || selectedStaff?.staffId || 'Not set'} />
                  <ProfileDetailRow icon="git-branch-outline" label="Designation" value={selectedStaff?.profile?.designation || selectedStaff?.designation || 'Not assigned'} />
                  <ProfileDetailRow icon="shirt-outline" label="Staff Type" value={selectedStaff?.profile?.staffType || selectedStaff?.staffType} capital={true} />
                  <ProfileDetailRow icon="call-outline" label="Contact Number" value={selectedStaff?.profile?.phone || selectedStaff?.phone || 'Not set'} />
                  <ProfileDetailRow icon="calendar-outline" label="Date of Joining" value={(selectedStaff?.profile?.dateOfJoining || selectedStaff?.dateOfJoining) ? dayjs(selectedStaff?.profile?.dateOfJoining || selectedStaff?.dateOfJoining).format('DD MMM YYYY') : 'Not set'} />
                  <ProfileDetailRow icon="business-outline" label="Department" value={selectedStaff?.profile?.department || selectedStaff?.department || 'Not assigned'} />

                  <Text style={[styles.sectionSubtitle, { marginTop: 14 }]}>General Information</Text>
                  <ProfileDetailRow icon="calendar-outline" label="Salary Cycle Date" value={selectedStaff?.profile?.salaryCycleDate || selectedStaff?.salaryCycleDate} />
                  <ProfileDetailRow 
                    icon="alarm-outline" 
                    label="Shift" 
                    value={
                      (() => {
                        const sName = selectedStaff?.shiftTemplate?.name || selectedStaff?.profile?.shiftSelection || selectedStaff?.shiftSelection || 'Standard Shift';
                        const start = selectedStaff?.shiftTemplate?.startTime;
                        const end = selectedStaff?.shiftTemplate?.endTime;
                        if (start && end) {
                          return `${sName} (${formatShiftTime(start)} - ${formatShiftTime(end)})`;
                        }
                        return sName;
                      })()
                    } 
                  />
                  {/* <ProfileDetailRow icon="lock-open-outline" label="Salary Access" value={(selectedStaff?.profile?.allowCurrentCycleSalaryAccess || selectedStaff?.allowCurrentCycleSalaryAccess) ? 'Allow current cycle' : 'Restricted'} />
                  <ProfileDetailRow icon="options-outline" label="Attendance Setting Template" value={selectedStaff?.attendanceTemplate?.name || selectedStaff?.profile?.attendanceSettingTemplate || selectedStaff?.attendanceSettingTemplate || 'Not set'} /> */}
                  {/* <ProfileDetailRow icon="options-outline" label="Effective Template" value={selectedStaff?.profile?.effectiveTemplate || 'Not set'} />
                  <ProfileDetailRow icon="eye-outline" label="Attendance Mode" value={selectedStaff?.profile?.attendanceMode || 'Not set'} /> */}
                  <ProfileDetailRow 
                    icon="wallet-outline" 
                    label="Salary Template" 
                    value={
                      (() => {
                        const staffTplId = selectedStaff?.profile?.salaryTemplateId || selectedStaff?.salaryTemplateId;
                        const tpl = salaryTemplates.find(t => t.id === staffTplId);
                        return tpl?.name || 'No Template';
                      })()
                    } 
                  />

                  <Text style={[styles.sectionSubtitle, { marginTop: 14 }]}>Personal Information</Text>
                  <ProfileDetailRow icon="mail-outline" label="Email" value={selectedStaff?.profile?.email || selectedStaff?.email || 'Not set'} />
                  <ProfileDetailRow icon="male-female-outline" label="Gender" value={selectedStaff?.profile?.gender || selectedStaff?.gender || 'Not set'} />
                  <ProfileDetailRow icon="today-outline" label="Date of Birth" value={selectedStaff?.profile?.dob || selectedStaff?.dob || 'Not set'} />
                  <ProfileDetailRow icon="heart-half-outline" label="Marital Status" value={selectedStaff?.profile?.maritalStatus || selectedStaff?.maritalStatus || 'Not set'} />
                  <ProfileDetailRow icon="water-outline" label="Blood Group" value={selectedStaff?.profile?.bloodGroup || selectedStaff?.bloodGroup || 'Not set'} />
                  <ProfileDetailRow icon="call-outline" label="Emergency Contact" value={selectedStaff?.profile?.emergencyContact || selectedStaff?.emergencyContact || 'Not set'} />
                  <ProfileDetailRow icon="location-outline" label="Address" value={`${selectedStaff?.profile?.addressLine1 || selectedStaff?.addressLine1 || ''} ${selectedStaff?.profile?.addressLine2 || selectedStaff?.addressLine2 || ''} ${selectedStaff?.profile?.city || selectedStaff?.city || ''} ${selectedStaff?.profile?.state || selectedStaff?.state || ''} ${selectedStaff?.profile?.postalCode || selectedStaff?.postalCode || ''}`.trim() || 'Not set'} />

                  <Text style={[styles.sectionSubtitle, { marginTop: 14 }]}>Bank Details</Text>
                  <ProfileDetailRow icon="card-outline" label="Bank Name" value={selectedStaff?.profile?.bankName || selectedStaff?.bankName || 'Not set'} />
                  <ProfileDetailRow icon="location-outline" label="Branch" value={selectedStaff?.profile?.bankBranch || selectedStaff?.bankBranch || 'Not set'} />
                  <ProfileDetailRow icon="barcode-outline" label="IFSC" value={selectedStaff?.profile?.bankIfsc || selectedStaff?.bankIfsc || 'Not set'} />
                  <ProfileDetailRow icon="wallet-outline" label="Account Number" value={selectedStaff?.profile?.bankAccountNumber || selectedStaff?.bankAccountNumber || 'Not set'} />
                  <ProfileDetailRow icon="person-outline" label="Account Holder" value={selectedStaff?.profile?.bankAccountHolderName || selectedStaff?.bankAccountHolderName || 'Not set'} />
                  <ProfileDetailRow icon="qr-code-outline" label="UPI ID" value={selectedStaff?.profile?.upiId || selectedStaff?.upiId || 'Not set'} />
                </View>
              )}

              {/* TAB: ATTENDANCE */}
              {modalActiveTab === 'attendance' && (
                <View style={styles.detailsSection}>
                  <View style={styles.monthSelectorBar}>
                    <TouchableOpacity
                      style={styles.monthSelectorBtn}
                      onPress={() => setAttMonth(attMonth.subtract(1, 'month'))}
                    >
                      <Ionicons name="chevron-back" size={18} color="#0F3B8C" />
                    </TouchableOpacity>
                    <Text style={styles.monthSelectorText}>{attMonth.format('MMM YYYY')}</Text>
                    <TouchableOpacity
                      style={styles.monthSelectorBtn}
                      onPress={() => setAttMonth(attMonth.add(1, 'month'))}
                    >
                      <Ionicons name="chevron-forward" size={18} color="#0F3B8C" />
                    </TouchableOpacity>
                  </View>

                  {attLoading ? (
                    <ActivityIndicator size="small" color="#0F3B8C" style={{ marginVertical: 20 }} />
                  ) : (
                    <>
                      {/* Log List */}
                      {attRows.length === 0 ? (
                        <Text style={styles.emptyTabText}>No attendance records for this month.</Text>
                      ) : (
                        attRows.map((r, idx) => {
                          const hasAttended = !!r.checkIn;
                          const isOffDay = r.status === 'weekly_off' || r.status === 'holiday';
                          let badgeBg = '#F3F4F6';
                          let badgeText = '#6B7280';
                          if (r.status === 'present') { badgeBg = '#E8F5E9'; badgeText = '#2E7D32'; }
                          else if (r.status === 'absent') { badgeBg = '#FFEBEE'; badgeText = '#C62828'; }
                          else if (r.status === 'late') { badgeBg = '#FFF3E0'; badgeText = '#EF6C00'; }
                          else if (r.status === 'leave') { badgeBg = '#E3F2FD'; badgeText = '#1565C0'; }
                          else if (r.status === 'half_day') { badgeBg = '#FFFDE7'; badgeText = '#F57F17'; }

                          return (
                            <View key={idx} style={styles.attendanceLogCard}>
                              <View style={styles.logCardLeft}>
                                <Text style={styles.logDateText}>{dayjs(r.date).format('DD MMM')}</Text>
                                <Text style={styles.logDayText}>{r.day || ''}</Text>
                              </View>

                              <View style={styles.logCardMiddle}>
                                <View style={[styles.logStatusBadge, { backgroundColor: badgeBg }]}>
                                  <Text style={[styles.logStatusText, { color: badgeText }]}>
                                    {(r.status || '').replace('_', ' ').toUpperCase()}
                                  </Text>
                                </View>
                                {isOffDay && hasAttended && (
                                  <View style={[styles.logStatusBadge, { backgroundColor: '#E8F5E9', marginTop: 4 }]}>
                                    <Text style={[styles.logStatusText, { color: '#2E7D32' }]}>PRESENT</Text>
                                  </View>
                                )}
                                {r.isLate && (
                                  <View style={[styles.logStatusBadge, { backgroundColor: '#FFF3E0', marginTop: 4 }]}>
                                    <Text style={[styles.logStatusText, { color: '#EF6C00' }]}>LATE</Text>
                                  </View>
                                )}
                              </View>

                              <View style={styles.logCardRight}>
                                <Text style={styles.logPunchTime}>In: {r.checkIn || '--:--'}</Text>
                                <Text style={styles.logPunchTime}>Out: {r.checkOut || '--:--'}</Text>
                                {r.workDuration > 0 && (
                                  <Text style={styles.logDurationText}>
                                    Work: {Math.floor(r.workDuration / 60)}h {r.workDuration % 60}m
                                  </Text>
                                )}
                                {r.overtimeMinutes > 0 && (
                                  <Text style={[styles.logDurationText, { color: '#16A34A', fontFamily: 'Inter_600SemiBold' }]}>
                                    +{r.overtimeMinutes}m OT
                                  </Text>
                                )}
                              </View>
                            </View>
                          );
                        })
                      )}
                    </>
                  )}
                </View>
              )}

              {/* TAB: SALARY OVERVIEW */}
              {modalActiveTab === 'salaryOverview' && (
                <View style={styles.detailsSection}>
                  <View style={styles.monthSelectorBar}>
                    <TouchableOpacity
                      style={styles.monthSelectorBtn}
                      onPress={() => setSalaryMonth(salaryMonth.subtract(1, 'month'))}
                    >
                      <Ionicons name="chevron-back" size={18} color="#0F3B8C" />
                    </TouchableOpacity>
                    <Text style={styles.monthSelectorText}>{salaryMonth.format('MMM YYYY')}</Text>
                    <TouchableOpacity
                      style={styles.monthSelectorBtn}
                      onPress={() => setSalaryMonth(salaryMonth.add(1, 'month'))}
                    >
                      <Ionicons name="chevron-forward" size={18} color="#0F3B8C" />
                    </TouchableOpacity>
                  </View>

                  {salaryLoading ? (
                    <ActivityIndicator size="small" color="#0F3B8C" style={{ marginVertical: 20 }} />
                  ) : (
                    <>
                      {/* Premium Summary Card */}
                      {salaryPayrollLine ? (
                        (() => {
                          const safeParse = (v) => {
                            if (!v) return {};
                            if (typeof v === 'object') return v;
                            try { return JSON.parse(v); } catch { return {}; }
                          };
                          const totals = safeParse(salaryPayrollLine.totals);
                          const pe = safeParse(salaryPayrollLine.earnings);
                          const pi = safeParse(salaryPayrollLine.incentives);
                          const pd = safeParse(salaryPayrollLine.deductions);

                          const isPaid = !!salaryPayrollLine.paidAt;
                          const netPayable = totals.netSalary || 0;
                          const totalEarnVal = Number(totals.totalEarnings || 0) + Number(totals.totalIncentives || 0);
                          const totalDedVal = Number(totals.totalDeductions || 0);

                          return (
                            <View style={styles.payrollSummaryCard}>
                              <Text style={styles.payrollSummaryTitle}>Net Salary</Text>
                              <Text style={styles.payrollSummaryAmount}>₹{Number(netPayable).toLocaleString('en-IN')}</Text>
                              <View style={[styles.statusBadge, { alignSelf: 'center', marginTop: 8, backgroundColor: isPaid ? '#ECFDF5' : '#FEF2F2' }]}>
                                <Text style={[styles.statusBadgeText, { color: isPaid ? '#10B981' : '#DC2626' }]}>
                                  {isPaid ? `PAID on ${dayjs(salaryPayrollLine.paidAt).format('DD MMM YYYY')}` : 'DUE'}
                                </Text>
                              </View>

                              {/* Breakdown */}
                              <Text style={[styles.sectionSubtitle, { marginTop: 18, textAlign: 'left' }]}>Earnings Breakdown</Text>
                              <View style={styles.breakdownContainer}>
                                {Object.entries(pe).map(([k, v]) => (
                                  <View key={k} style={styles.breakdownRow}>
                                    <Text style={styles.breakdownLabel}>{k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</Text>
                                    <Text style={[styles.breakdownVal, { color: '#16A34A' }]}>₹{Number(v).toLocaleString('en-IN')}</Text>
                                  </View>
                                ))}
                                {Object.entries(pi).map(([k, v]) => (
                                  <View key={k} style={styles.breakdownRow}>
                                    <Text style={styles.breakdownLabel}>{k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())} (Incentive)</Text>
                                    <Text style={[styles.breakdownVal, { color: '#16A34A' }]}>₹{Number(v).toLocaleString('en-IN')}</Text>
                                  </View>
                                ))}
                                <View style={[styles.breakdownRow, { borderTopWidth: 1, borderTopColor: '#EFF2F7', paddingTop: 6, marginTop: 4 }]}>
                                  <Text style={[styles.breakdownLabel, { fontFamily: 'Inter_700Bold' }]}>Gross Earnings</Text>
                                  <Text style={[styles.breakdownVal, { color: '#16A34A', fontFamily: 'Inter_700Bold' }]}>₹{Number(totalEarnVal).toLocaleString('en-IN')}</Text>
                                </View>
                              </View>

                              <Text style={[styles.sectionSubtitle, { marginTop: 14, textAlign: 'left' }]}>Deductions Breakdown</Text>
                              <View style={styles.breakdownContainer}>
                                {Object.entries(pd).map(([k, v]) => (
                                  <View key={k} style={styles.breakdownRow}>
                                    <Text style={styles.breakdownLabel}>{k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</Text>
                                    <Text style={[styles.breakdownVal, { color: '#DC2626' }]}>-₹{Number(v).toLocaleString('en-IN')}</Text>
                                  </View>
                                ))}
                                <View style={[styles.breakdownRow, { borderTopWidth: 1, borderTopColor: '#EFF2F7', paddingTop: 6, marginTop: 4 }]}>
                                  <Text style={[styles.breakdownLabel, { fontFamily: 'Inter_700Bold' }]}>Total Deductions</Text>
                                  <Text style={[styles.breakdownVal, { color: '#DC2626', fontFamily: 'Inter_700Bold' }]}>-₹{Number(totalDedVal).toLocaleString('en-IN')}</Text>
                                </View>
                              </View>
                            </View>
                          );
                        })()
                      ) : (
                        <View style={styles.emptyBox}>
                          <Ionicons name="wallet-outline" size={32} color="#9CA3AF" />
                          <Text style={styles.emptyText}>No Payroll Record</Text>
                          <Text style={styles.emptySub}>No payroll sheet has been generated for this employee in {salaryMonth.format('MMMM YYYY')}.</Text>
                        </View>
                      )}
                    </>
                  )}
                </View>
              )}

              {/* TAB: SALARY STRUCTURE */}
              {modalActiveTab === 'salaryStructure' && (() => {
                const sv = selectedStaff ? extractSV(selectedStaff) : { earnings: {}, deductions: {} };
                const staffTplId = selectedStaff?.profile?.salaryTemplateId || selectedStaff?.salaryTemplateId;
                const tpl = salaryTemplates.find(t => t.id === staffTplId);

                let tplEarnKeys = null;
                let tplDedKeys = null;
                const norm = (s = '') => s.toLowerCase().replace(/[_\s]/g, '');

                if (tpl) {
                  try {
                    const parse = (v) => typeof v === 'string' ? JSON.parse(v) : (v || []);
                    tplEarnKeys = parse(tpl.earnings).map(it => it.name || it.key).filter(Boolean).filter(k => !norm(k).includes('employer'));
                    tplDedKeys = parse(tpl.deductions).map(it => it.name || it.key).filter(Boolean).filter(k => !norm(k).includes('employer')).map(k => {
                      const nk = norm(k);
                      if (nk === 'providentfundemployee' || nk === 'providentfund') return 'provident_fund';
                      if (nk === 'esiemployee' || nk === 'esi') return 'esi';
                      if (nk === 'professionaltax') return 'professional_tax';
                      return k;
                    });
                  } catch (e) { }
                }

                const allTplKeys = [...(tplEarnKeys || []), ...(tplDedKeys || [])];

                const earningsEntries = orderByPref(toEntries(sv.earnings), prefEarn, tplEarnKeys).filter(([k, v]) => {
                  const nk = norm(k);
                  const inTpl = tplEarnKeys ? tplEarnKeys.some(tk => norm(tk) === nk) : false;
                  const inPref = !tplEarnKeys && prefEarn.includes(k);
                  return Number(v) !== 0 || inTpl || inPref;
                });
                const deductionEntries = orderByPref(toEntries(sv.deductions), prefDed, tplDedKeys).filter(([k, v]) => {
                  const nk = norm(k);
                  const inTpl = tplDedKeys ? tplDedKeys.some(tk => norm(tk) === nk) : false;
                  const inPref = !tplDedKeys && prefDed.includes(k);
                  return Number(v) !== 0 || inTpl || inPref;
                });

                const gross = earningsEntries.reduce((sumVal, [, v]) => sumVal + (Number(v) || 0), 0);
                const totalDed = deductionEntries.reduce((sumVal, [, v]) => sumVal + (Number(v) || 0), 0);
                const net = gross - totalDed;

                return (
                  <View style={styles.detailsSection}>
                    <Text style={styles.sectionSubtitle}>Earnings</Text>
                    {earningsEntries.map(([k, v]) => (
                      <SalaryDetailRow 
                        key={k} 
                        label={labelize(k, allTplKeys)} 
                        value={v} 
                        isBase={norm(k) === 'basicsalary' || norm(k) === 'basic_salary'} 
                      />
                    ))}
                    
                    {/* Gross Earnings Summary Row */}
                    <View style={[styles.salaryRow, { backgroundColor: '#F8FAFD', borderStyle: 'dashed', borderWidth: 1, borderColor: '#D1D5DB' }]}>
                      <Text style={[styles.salaryLabel, { fontFamily: 'Inter_700Bold', color: '#111827' }]}>Gross Earnings</Text>
                      <Text style={[styles.salaryValueText, { color: '#16A34A', fontFamily: 'Inter_700Bold' }]}>
                        ₹{gross.toLocaleString('en-IN')}
                      </Text>
                    </View>

                    <Text style={[styles.sectionSubtitle, { marginTop: 18 }]}>Deductions</Text>
                    {deductionEntries.length === 0 ? (
                      <Text style={styles.emptyTabText}>No deductions configured.</Text>
                    ) : (
                      deductionEntries.map(([k, v]) => (
                        <SalaryDetailRow 
                          key={k} 
                          label={labelize(k, allTplKeys)} 
                          value={v} 
                          isBase={false} 
                          isDeduct={true} 
                        />
                      ))
                    )}

                    {/* Total Deductions Summary Row */}
                    <View style={[styles.salaryRow, { backgroundColor: '#F8FAFD', borderStyle: 'dashed', borderWidth: 1, borderColor: '#D1D5DB' }]}>
                      <Text style={[styles.salaryLabel, { fontFamily: 'Inter_700Bold', color: '#111827' }]}>Total Deductions</Text>
                      <Text style={[styles.salaryValueText, { color: '#DC2626', fontFamily: 'Inter_700Bold' }]}>
                        -₹{totalDed.toLocaleString('en-IN')}
                      </Text>
                    </View>

                    {/* Net Calculated Base */}
                    <View style={styles.netSalaryCard}>
                      <Text style={styles.netSalaryLabel}>Net Payable Amount (Gross Earnings - Total Deductions)</Text>
                      <Text style={styles.netSalaryVal}>
                        ₹{net.toLocaleString('en-IN')} / month
                      </Text>
                    </View>
                  </View>
                );
              })()}

              {/* TAB: EDUCATION & EXPERIENCE */}
              {modalActiveTab === 'educationExperience' && (
                <View style={styles.detailsSection}>
                  <Text style={styles.sectionSubtitle}>Education</Text>
                  {(() => {
                    const parseJSON = (val) => {
                      if (!val) return [];
                      if (typeof val === 'string') {
                        try { const p = JSON.parse(val); return Array.isArray(p) ? p : []; } catch (e) { return []; }
                      }
                      return Array.isArray(val) ? val : [];
                    };
                    const edu = parseJSON(selectedStaff?.profile?.education || selectedStaff?.education);
                    if (edu.length === 0) {
                      return <Text style={styles.emptyTabText}>No education details set.</Text>;
                    }
                    return edu.map((item, idx) => (
                      <View key={idx} style={styles.bgCard}>
                        <View style={styles.cardHeader}>
                          <Ionicons name="school" size={16} color="#0F3B8C" style={{ marginRight: 8 }} />
                          <Text style={styles.cardTitleText}>{item.degree || 'Degree'}</Text>
                        </View>
                        <Text style={styles.cardBodyText}>Institution: {item.institution || '--'}</Text>
                        <Text style={styles.cardBodyText}>Year: {item.year || '--'}</Text>
                      </View>
                    ));
                  })()}

                  <Text style={[styles.sectionSubtitle, { marginTop: 14 }]}>Experience</Text>
                  {(() => {
                    const parseJSON = (val) => {
                      if (!val) return [];
                      if (typeof val === 'string') {
                        try { const p = JSON.parse(val); return Array.isArray(p) ? p : []; } catch (e) { return []; }
                      }
                      return Array.isArray(val) ? val : [];
                    };
                    const exp = parseJSON(selectedStaff?.profile?.experience || selectedStaff?.experience);
                    if (exp.length === 0) {
                      return <Text style={styles.emptyTabText}>No experience details set.</Text>;
                    }
                    return exp.map((item, idx) => (
                      <View key={idx} style={styles.bgCard}>
                        <View style={styles.cardHeader}>
                          <Ionicons name="briefcase" size={16} color="#0F3B8C" style={{ marginRight: 8 }} />
                          <Text style={styles.cardTitleText}>{item.company || 'Company'}</Text>
                        </View>
                        <Text style={styles.cardBodyText}>Designation: {item.designation || '--'}</Text>
                        <Text style={styles.cardBodyText}>Duration: {item.duration || '--'}</Text>
                      </View>
                    ));
                  })()}
                </View>
              )}

              {/* TAB: LEAVE(S) */}
              {modalActiveTab === 'leaves' && (
                <View style={styles.detailsSection}>
                  <Text style={styles.sectionSubtitle}>Leave History & Requests</Text>
                  {leavesLoading ? (
                    <ActivityIndicator size="small" color="#0F3B8C" style={{ marginVertical: 20 }} />
                  ) : leavesList.length === 0 ? (
                    <Text style={styles.emptyTabText}>No leaves requested yet.</Text>
                  ) : (
                    leavesList.map((item) => {
                      let badgeBg = '#FFF7ED';
                      let badgeText = '#F97316';
                      if (item.status === 'APPROVED') { badgeBg = '#ECFDF5'; badgeText = '#10B981'; }
                      else if (item.status === 'REJECTED') { badgeBg = '#FEF2F2'; badgeText = '#EF4444'; }

                      return (
                        <View key={item.id} style={styles.leaveExpenseCard}>
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                            <View style={[styles.logStatusBadge, { backgroundColor: badgeBg }]}>
                              <Text style={[styles.logStatusText, { color: badgeText }]}>{item.status}</Text>
                            </View>
                            <Text style={styles.leaveDaysText}>{item.days} Days</Text>
                          </View>

                          <Text style={styles.leaveDurationText}>
                            {dayjs(item.startDate).format('DD MMM YYYY')} - {dayjs(item.endDate).format('DD MMM YYYY')}
                          </Text>
                          <Text style={styles.leaveTypeText}>Type: {item.leaveType || item.categoryKey || 'Casual'}</Text>
                          <Text style={styles.leaveReasonText}>Reason: {item.reason || '--'}</Text>
                          {item.note ? <Text style={styles.adminNoteText}>Admin Note: {item.note}</Text> : null}

                           {item.status === 'PENDING' && (
                             <View style={styles.cardActionsRow}>
                               <TouchableOpacity
                                 style={[styles.actionBtn, styles.actionBtnApprove]}
                                 onPress={() => {
                                   if (Platform.OS === 'web') {
                                     if (window.confirm('Are you sure you want to approve this leave request?')) {
                                       handleApproveLeave(item.id);
                                     }
                                   } else {
                                     Alert.alert(
                                       'Approve Leave',
                                       'Are you sure you want to approve this leave request?',
                                       [
                                         { text: 'Cancel', style: 'cancel' },
                                         { text: 'Approve', onPress: () => handleApproveLeave(item.id) }
                                       ]
                                     );
                                   }
                                 }}
                               >
                                 <Ionicons name="checkmark-circle-outline" size={14} color="#FFFFFF" style={{ marginRight: 4 }} />
                                 <Text style={styles.actionBtnText}>Approve</Text>
                               </TouchableOpacity>
 
                               <TouchableOpacity
                                 style={[styles.actionBtn, styles.actionBtnReject]}
                                 onPress={() => {
                                   if (Platform.OS === 'web') {
                                     if (window.confirm('Are you sure you want to reject this leave request?')) {
                                       setLeaveToReject(item);
                                       setLeaveRejectionModalVisible(true);
                                     }
                                   } else {
                                     Alert.alert(
                                       'Reject Leave',
                                       'Are you sure you want to reject this leave request?',
                                       [
                                         { text: 'Cancel', style: 'cancel' },
                                         {
                                           text: 'Reject',
                                           style: 'destructive',
                                           onPress: () => {
                                             setLeaveToReject(item);
                                             setLeaveRejectionModalVisible(true);
                                           }
                                         }
                                       ]
                                     );
                                   }
                                 }}
                               >
                                 <Ionicons name="close-circle-outline" size={14} color="#FFFFFF" style={{ marginRight: 4 }} />
                                 <Text style={styles.actionBtnText}>Reject</Text>
                               </TouchableOpacity>
                             </View>
                           )}
                        </View>
                      );
                    })
                  )}
                </View>
              )}

              {/* TAB: EXPENSES */}
              {modalActiveTab === 'expenses' && (
                <View style={styles.detailsSection}>
                  <Text style={styles.sectionSubtitle}>Expense Claims</Text>
                  {expensesLoading ? (
                    <ActivityIndicator size="small" color="#0F3B8C" style={{ marginVertical: 20 }} />
                  ) : expensesList.length === 0 ? (
                    <Text style={styles.emptyTabText}>No expense claims filed yet.</Text>
                  ) : (
                    expensesList.map((item) => {
                      const isPending = item.status === 'pending';
                      let badgeBg = '#FFF7ED';
                      let badgeText = '#F97316';
                      if (item.status === 'approved') { badgeBg = '#ECFDF5'; badgeText = '#10B981'; }
                      else if (item.status === 'rejected') { badgeBg = '#FEF2F2'; badgeText = '#EF4444'; }

                      return (
                        <View key={item.id} style={styles.leaveExpenseCard}>
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                            <View style={[styles.logStatusBadge, { backgroundColor: badgeBg }]}>
                              <Text style={[styles.logStatusText, { color: badgeText, textTransform: 'uppercase' }]}>{item.status}</Text>
                            </View>
                            <Text style={styles.expenseAmountText}>₹{Number(item.amount || 0).toLocaleString('en-IN')}</Text>
                          </View>

                          <Text style={styles.expenseTypeText}>Type: {item.expenseType || 'Other'}</Text>
                          <Text style={styles.expenseDateText}>Date: {dayjs(item.expenseDate).format('DD MMM YYYY')}</Text>
                          <Text style={styles.expenseDescText}>Description: {item.description || '--'}</Text>

                          {item.approvedAmount ? (
                            <Text style={styles.approvedAmountText}>Approved Amount: ₹{Number(item.approvedAmount).toLocaleString('en-IN')}</Text>
                          ) : null}

                          {item.attachmentUrl ? (
                            <TouchableOpacity
                              style={styles.viewAttachmentBtn}
                              onPress={() => Linking.openURL(getFullUrl(item.attachmentUrl))}
                            >
                              <Ionicons name="document-attach-outline" size={14} color="#0F3B8C" style={{ marginRight: 4 }} />
                              <Text style={styles.viewAttachmentText}>View Attachment</Text>
                            </TouchableOpacity>
                          ) : null}

                          {isPending && (
                            <View style={styles.cardActionsRow}>
                              <TouchableOpacity
                                style={[styles.actionBtn, styles.actionBtnApprove]}
                                onPress={() => {
                                  if (Platform.OS === 'web') {
                                    if (window.confirm('Are you sure you want to approve this expense claim?')) {
                                      handleApproveExpense(item);
                                    }
                                  } else {
                                    Alert.alert(
                                      'Approve Expense',
                                      'Are you sure you want to approve this expense claim?',
                                      [
                                        { text: 'Cancel', style: 'cancel' },
                                        { text: 'Approve', onPress: () => handleApproveExpense(item) }
                                      ]
                                    );
                                  }
                                }}
                              >
                                <Ionicons name="checkmark-circle-outline" size={14} color="#FFFFFF" style={{ marginRight: 4 }} />
                                <Text style={styles.actionBtnText}>Approve</Text>
                              </TouchableOpacity>

                              <TouchableOpacity
                                style={[styles.actionBtn, styles.actionBtnReject]}
                                onPress={() => {
                                  if (Platform.OS === 'web') {
                                    if (window.confirm('Are you sure you want to reject this expense claim?')) {
                                      handleRejectExpense(item.id);
                                    }
                                  } else {
                                    Alert.alert(
                                      'Reject Expense',
                                      'Are you sure you want to reject this expense claim?',
                                      [
                                        { text: 'Cancel', style: 'cancel' },
                                        { text: 'Reject', style: 'destructive', onPress: () => handleRejectExpense(item.id) }
                                      ]
                                    );
                                  }
                                }}
                              >
                                <Ionicons name="close-circle-outline" size={14} color="#FFFFFF" style={{ marginRight: 4 }} />
                                <Text style={styles.actionBtnText}>Reject</Text>
                              </TouchableOpacity>
                            </View>
                          )}
                        </View>
                      );
                    })
                  )}
                </View>
              )}

              {/* TAB: DOCUMENTS */}
              {modalActiveTab === 'documents' && (
                <View style={styles.detailsSection}>
                  <Text style={styles.sectionSubtitle}>Uploaded Documents</Text>
                  {docsLoading ? (
                    <ActivityIndicator size="small" color="#0F3B8C" style={{ marginVertical: 20 }} />
                  ) : documentsList.length === 0 ? (
                    <Text style={styles.emptyTabText}>No documents uploaded yet.</Text>
                  ) : (
                    documentsList.map((item) => (
                      <View key={item.id} style={styles.documentCard}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.documentTitle}>{item.fileName || item.title || 'Document'}</Text>
                          <Text style={styles.documentMeta}>Type: {item.docType || 'General'}</Text>
                          {item.expiresAt ? <Text style={styles.documentMeta}>Expires: {dayjs(item.expiresAt).format('DD MMM YYYY')}</Text> : null}
                          <Text style={styles.documentMeta}>Status: {item.status || 'SUBMITTED'}</Text>
                        </View>

                        {item.fileUrl ? (
                          <TouchableOpacity
                            style={styles.docViewBtn}
                            onPress={() => Linking.openURL(getFullUrl(item.fileUrl))}
                          >
                            <Ionicons name="eye-outline" size={16} color="#0F3B8C" />
                          </TouchableOpacity>
                        ) : null}
                      </View>
                    ))
                  )}
                </View>
              )}
              <View style={{ height: 40 }} />
            </ScrollView>
          </Animated.View>
          </View>
        </View>
      </Modal>

      {/* Leave Rejection Modal Overlay */}
      <Modal
        visible={leaveRejectionModalVisible}
        animationType="fade"
        transparent={true}
        onRequestClose={() => {
          setLeaveRejectionModalVisible(false);
          setLeaveToReject(null);
          setLeaveRejectionNote('');
        }}
      >
        <View style={styles.overlayCenter}>
          <View style={styles.rejectionModalBox}>
            <Text style={styles.rejectionModalTitle}>Reject Leave Request</Text>
            <Text style={styles.rejectionModalSubtitle}>
              Please enter a reason/note for rejecting this leave request.
            </Text>

            <TextInput
              style={styles.rejectionInput}
              placeholder="E.g. Operational requirement, staff shortage..."
              value={leaveRejectionNote}
              onChangeText={setLeaveRejectionNote}
              multiline={true}
              numberOfLines={4}
              placeholderTextColor="#9CA3AF"
            />

            <View style={styles.rejectionActionsRow}>
              <TouchableOpacity
                style={[styles.rejActionBtn, { backgroundColor: '#F3F4F6', borderWidth: 1, borderColor: '#E5E7EB' }]}
                onPress={() => {
                  setLeaveRejectionModalVisible(false);
                  setLeaveToReject(null);
                  setLeaveRejectionNote('');
                }}
              >
                <Text style={{ color: '#4B5563', fontFamily: 'Inter_600SemiBold', fontSize: 13 }}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.rejActionBtn, { backgroundColor: '#DC2626' }]}
                onPress={handleRejectConfirmLeave}
              >
                <Text style={{ color: '#FFFFFF', fontFamily: 'Inter_600SemiBold', fontSize: 13 }}>Reject</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Add Employee Modal */}
      <Modal
        visible={addModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setAddModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxHeight: '90%' }]}>
            {/* Modal Header */}
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderTitleGroup}>
                <Text style={styles.modalTitle}>Add New Employee</Text>
                <Text style={styles.modalSubtitle}>Create a new employee profile in your organization</Text>
              </View>
              <TouchableOpacity style={styles.closeModalBtn} onPress={() => setAddModalVisible(false)}>
                <Ionicons name="close" size={24} color="#4B5563" />
              </TouchableOpacity>
            </View>

            {/* Scroll Form */}
            <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
              
              <Text style={styles.formSectionTitle}>Personal Info</Text>
              
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Employee Name *</Text>
                <TextInput
                  style={styles.formInput}
                  placeholder="Enter full name"
                  value={addName}
                  onChangeText={setAddName}
                  placeholderTextColor="#9CA3AF"
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Phone Number (10 digits) *</Text>
                <TextInput
                  style={styles.formInput}
                  placeholder="Enter 10-digit mobile number"
                  value={addPhone}
                  onChangeText={setAddPhone}
                  keyboardType="phone-pad"
                  maxLength={10}
                  placeholderTextColor="#9CA3AF"
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Email Address</Text>
                <TextInput
                  style={styles.formInput}
                  placeholder="Enter email address"
                  value={addEmail}
                  onChangeText={setAddEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  placeholderTextColor="#9CA3AF"
                />
              </View>

              <Text style={styles.formSectionTitle}>Employment Details</Text>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Staff ID / Card ID</Text>
                <TextInput
                  style={styles.formInput}
                  placeholder="e.g. EMP102"
                  value={addStaffId}
                  onChangeText={setAddStaffId}
                  placeholderTextColor="#9CA3AF"
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Department</Text>
                <TextInput
                  style={styles.formInput}
                  placeholder="e.g. Sales, Operations, IT"
                  value={addDepartment}
                  onChangeText={setAddDepartment}
                  placeholderTextColor="#9CA3AF"
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Designation</Text>
                <TextInput
                  style={styles.formInput}
                  placeholder="e.g. Executive, Manager"
                  value={addDesignation}
                  onChangeText={setAddDesignation}
                  placeholderTextColor="#9CA3AF"
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Date of Joining (YYYY-MM-DD)</Text>
                <TextInput
                  style={styles.formInput}
                  placeholder="YYYY-MM-DD"
                  value={addDateOfJoining}
                  onChangeText={setAddDateOfJoining}
                  placeholderTextColor="#9CA3AF"
                />
              </View>

              {/* Staff Type Select */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Staff Salary Type</Text>
                <View style={styles.pillRow}>
                  {['monthly', 'daily', 'hourly', 'weekly'].map((type) => {
                    const isSelected = addStaffType === type;
                    return (
                      <TouchableOpacity
                        key={type}
                        style={[styles.formPill, isSelected && styles.formPillActive]}
                        onPress={() => setAddStaffType(type)}
                        activeOpacity={0.8}
                      >
                        <Text style={[styles.formPillText, isSelected && styles.formPillTextActive]}>
                          {type.charAt(0).toUpperCase() + type.slice(1)}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {/* Shift Select */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Assign Shift</Text>
                <View style={styles.pillRow}>
                  {['Standard Shift', 'Morning Shift', 'Night Shift'].map((shift) => {
                    const isSelected = addShiftSelection === shift;
                    return (
                      <TouchableOpacity
                        key={shift}
                        style={[styles.formPill, isSelected && styles.formPillActive]}
                        onPress={() => setAddShiftSelection(shift)}
                        activeOpacity={0.8}
                      >
                        <Text style={[styles.formPillText, isSelected && styles.formPillTextActive]}>
                          {shift}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              <Text style={styles.formSectionTitle}>Permissions</Text>

              {/* Mobile Punch Toggle */}
              <View style={styles.formToggleCard}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.toggleCardTitle}>Mobile Punching Access</Text>
                  <Text style={styles.toggleCardDesc}>Allow checking in/out from personal mobile.</Text>
                </View>
                <TouchableOpacity
                  onPress={() => setAddMobilePunchEnabled(!addMobilePunchEnabled)}
                  style={[
                    styles.toggleSwitch,
                    addMobilePunchEnabled ? styles.toggleSwitchOn : styles.toggleSwitchOff
                  ]}
                  activeOpacity={0.8}
                >
                  <View style={[
                    styles.toggleKnob,
                    addMobilePunchEnabled ? styles.toggleKnobOn : styles.toggleKnobOff
                  ]} />
                </TouchableOpacity>
              </View>

              {/* QR Code Punch Toggle */}
              <View style={styles.formToggleCard}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.toggleCardTitle}>QR Code Punching Access</Text>
                  <Text style={styles.toggleCardDesc}>Allow scanning workplace QR codes.</Text>
                </View>
                <TouchableOpacity
                  onPress={() => setAddQrPunchEnabled(!addQrPunchEnabled)}
                  style={[
                    styles.toggleSwitch,
                    addQrPunchEnabled ? styles.toggleSwitchOn : styles.toggleSwitchOff
                  ]}
                  activeOpacity={0.8}
                >
                  <View style={[
                    styles.toggleKnob,
                    addQrPunchEnabled ? styles.toggleKnobOn : styles.toggleKnobOff
                  ]} />
                </TouchableOpacity>
              </View>

              <Text style={styles.formSectionTitle}>Education & Experience</Text>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Education</Text>
                <TextInput
                  style={styles.formInput}
                  placeholder="e.g. MBA, B.Tech, High School"
                  value={addEducation}
                  onChangeText={setAddEducation}
                  placeholderTextColor="#9CA3AF"
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Experience Details</Text>
                <TextInput
                  style={styles.formInput}
                  placeholder="e.g. 2 years at TechCorp"
                  value={addExperience}
                  onChangeText={setAddExperience}
                  placeholderTextColor="#9CA3AF"
                />
              </View>

              <View style={{ height: 40 }} />
            </ScrollView>

            {/* Sticky Modal Footer for Add */}
            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={[styles.modalFooterBtn, { borderColor: '#9CA3AF', borderWidth: 1, backgroundColor: '#F3F4F6' }]}
                onPress={() => setAddModalVisible(false)}
                activeOpacity={0.8}
              >
                <Text style={[styles.modalFooterBtnText, { color: '#4B5563' }]}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modalFooterBtn, { backgroundColor: '#0F3B8C' }]}
                onPress={handleAddStaff}
                activeOpacity={0.8}
              >
                <Ionicons name="checkmark-outline" size={14} color="#FFFFFF" style={{ marginRight: 4 }} />
                <Text style={[styles.modalFooterBtnText, { color: '#FFFFFF' }]}>Add Employee</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// Sub-component: Profile details rows
function ProfileDetailRow({ icon, label, value, capital }) {
  return (
    <View style={styles.detailRow}>
      <View style={styles.detailRowIconWrap}>
        <Ionicons name={icon} size={15} color="#0F3B8C" />
      </View>
      <View style={styles.detailRowTextWrap}>
        <Text style={styles.detailRowLabel}>{label}</Text>
        <Text style={[styles.detailRowValue, capital && { textTransform: 'capitalize' }]}>
          {value || '--'}
        </Text>
      </View>
    </View>
  );
}

// Sub-component: Salary component rows
function SalaryDetailRow({ label, value, isBase, isDeduct }) {
  const val = Number(value || 0);
  if (val === 0 && !isBase) return null; // Hide if not configured and not basic

  return (
    <View style={styles.salaryRow}>
      <Text style={styles.salaryLabel}>{label}</Text>
      <Text style={[styles.salaryValueText, isDeduct ? { color: '#DC2626' } : { color: '#16A34A' }]}>
        {isDeduct ? '-' : ''}₹{val.toLocaleString('en-IN')}
      </Text>
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
  headerRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  addStaffBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#0F3B8C',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  addStaffText: { fontFamily: 'Inter_600SemiBold', fontSize: 11, color: '#FFFFFF' },
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

  summaryCardsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 8,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderLeftWidth: 4,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
  },
  summaryCardLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 10,
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  summaryCardValue: {
    fontFamily: 'Inter_700Bold',
    fontSize: 18,
    marginTop: 2,
  },

  // Department Filters & Search
  filterWrapper: {
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

  // Staff Cards
  staffCard: {
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
  staffCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarBox: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    color: '#0F3B8C',
  },
  staffCardMeta: {
    flex: 1,
    marginLeft: 12,
  },
  staffName: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    color: '#111827',
  },
  staffDesigText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    color: '#6B7280',
    marginTop: 2,
  },
  staffIdText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 10,
    color: '#9CA3AF',
    marginTop: 2,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statusBadgeText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 9,
  },
  divider: {
    height: 1,
    backgroundColor: '#F3F4F6',
    marginVertical: 12,
  },
  staffCardBody: {
    gap: 8,
  },
  cardInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardInfoText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: '#4B5563',
  },
  shortcutBadgesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 12,
  },
  shortcutBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  shortcutBadgeText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 9,
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
    flex: 1,
  },
  modalTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 16,
    color: '#111827',
  },
  modalSubtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    color: '#6B7280',
    lineHeight: 14,
  },
  closeModalBtn: {
    padding: 4,
    marginLeft: 8,
  },
  modalScroll: {
    paddingHorizontal: 20,
    paddingTop: 16,
  },

  // Modal Sub-Tabs
  modalTabsContainer: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    backgroundColor: '#F9FAFB',
    paddingHorizontal: 10,
  },
  modalTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    gap: 4,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  modalTabActive: {
    borderBottomColor: '#0F3B8C',
  },
  modalTabLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    color: '#6B7280',
  },
  modalTabLabelActive: {
    fontFamily: 'Inter_600SemiBold',
    color: '#0F3B8C',
  },

  detailsSection: {
    paddingTop: 4,
    gap: 12,
  },
  sectionSubtitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 13,
    color: '#374151',
    marginBottom: 4,
    marginTop: 6,
  },

  // Form Field Styles
  formSectionTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 11,
    color: '#0F3B8C',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 18,
    marginBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E9F0',
    paddingBottom: 4,
  },
  inputGroup: {
    marginBottom: 14,
  },
  inputLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    color: '#374151',
    marginBottom: 6,
  },
  formInput: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    paddingHorizontal: 12,
    height: 40,
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: '#111827',
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 2,
  },
  formPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  formPillActive: {
    backgroundColor: '#E6F0FA',
    borderColor: '#0F3B8C',
  },
  formPillText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    color: '#4B5563',
  },
  formPillTextActive: {
    color: '#0F3B8C',
    fontFamily: 'Inter_600SemiBold',
  },
  formToggleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#F0F3F7',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },

  // Toggle Switch & Knob Styles
  toggleSwitch: {
    width: 44,
    height: 24,
    borderRadius: 12,
    padding: 2,
    justifyContent: 'center',
  },
  toggleSwitchOn: {
    backgroundColor: '#10B981',
  },
  toggleSwitchOff: {
    backgroundColor: '#D1D5DB',
  },
  toggleKnob: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 1.5,
  },
  toggleKnobOn: {
    alignSelf: 'flex-end',
  },
  toggleKnobOff: {
    alignSelf: 'flex-start',
  },

  // Detail Row Styles
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#F0F3F7',
    borderRadius: 10,
    padding: 10,
  },
  detailRowIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EFF6FF',
  },
  detailRowTextWrap: {
    marginLeft: 12,
    flex: 1,
  },
  detailRowLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 9,
    color: '#9CA3AF',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  detailRowValue: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    color: '#111827',
    marginTop: 1,
  },

  // Settings Cards
  settingToggleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#F0F3F7',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  toggleCardTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    color: '#111827',
  },
  toggleCardDesc: {
    fontFamily: 'Inter_400Regular',
    fontSize: 10,
    color: '#6B7280',
    marginTop: 2,
    paddingRight: 12,
    lineHeight: 14,
  },

  // Salary Component Rows
  salaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#F0F3F7',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  salaryLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    color: '#4B5563',
  },
  salaryValueText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 12,
  },
  netSalaryCard: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  netSalaryLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    color: '#0F3B8C',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  netSalaryVal: {
    fontFamily: 'Inter_700Bold',
    fontSize: 18,
    color: '#0F3B8C',
    marginTop: 4,
  },

  // Sticky modal footer
  modalFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    backgroundColor: '#FFFFFF',
    gap: 12,
  },
  modalFooterBtn: {
    flex: 1,
    height: 40,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  modalFooterBtnText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
  },
  modalTabsScrollContent: {
    paddingHorizontal: 10,
    gap: 8,
  },
  modalTabScrollable: {
    flexShrink: 0,
    flexGrow: 0,
    flexBasis: 'auto',
    paddingHorizontal: 16,
  },
  monthSelectorBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E9F0',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  monthSelectorBtn: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: '#F3F4F6',
  },
  monthSelectorText: {
    flex: 1,
    textAlign: 'center',
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
    color: '#111827',
  },
  statsGrid: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#EFF2F7',
  },
  statValue: {
    fontFamily: 'Inter_700Bold',
    fontSize: 16,
  },
  statLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 10,
    color: '#6B7280',
    marginTop: 2,
  },
  attendanceLogCard: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#EFF2F7',
    alignItems: 'center',
  },
  logCardLeft: {
    width: 60,
    alignItems: 'center',
    borderRightWidth: 1,
    borderRightColor: '#F3F4F6',
    paddingRight: 8,
  },
  logDateText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 13,
    color: '#111827',
  },
  logDayText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    color: '#9CA3AF',
    marginTop: 1,
  },
  logCardMiddle: {
    flex: 1,
    paddingHorizontal: 12,
    alignItems: 'flex-start',
  },
  logStatusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  logStatusText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 9,
  },
  logCardRight: {
    alignItems: 'flex-end',
  },
  logPunchTime: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    color: '#4B5563',
  },
  logDurationText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 10,
    color: '#9CA3AF',
    marginTop: 2,
  },
  payrollSummaryCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#EFF2F7',
  },
  payrollSummaryTitle: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  payrollSummaryAmount: {
    fontFamily: 'Inter_700Bold',
    fontSize: 22,
    color: '#0F3B8C',
    textAlign: 'center',
    marginTop: 4,
  },
  breakdownContainer: {
    backgroundColor: '#F9FAFB',
    borderRadius: 10,
    padding: 12,
    marginTop: 6,
    gap: 8,
  },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  breakdownLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    color: '#4B5563',
  },
  breakdownVal: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
  },
  bgCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#EFF2F7',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  cardTitleText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    color: '#111827',
  },
  cardBodyText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: '#4B5563',
    marginTop: 2,
  },
  leaveExpenseCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#EFF2F7',
    gap: 4,
  },
  leaveDaysText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 12,
    color: '#0F3B8C',
  },
  leaveDurationText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    color: '#111827',
    marginTop: 4,
  },
  leaveTypeText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    color: '#6B7280',
  },
  leaveReasonText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: '#374151',
    marginTop: 2,
  },
  adminNoteText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    color: '#DC2626',
    backgroundColor: '#FEF2F2',
    padding: 6,
    borderRadius: 6,
    marginTop: 4,
  },
  expenseAmountText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
    color: '#111827',
  },
  expenseTypeText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    color: '#4B5563',
    marginTop: 4,
  },
  expenseDateText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    color: '#6B7280',
  },
  expenseDescText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: '#374151',
    marginTop: 2,
  },
  approvedAmountText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
    color: '#16A34A',
    backgroundColor: '#F0FDF4',
    padding: 6,
    borderRadius: 6,
    marginTop: 4,
  },
  viewAttachmentBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    paddingVertical: 4,
  },
  viewAttachmentText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
    color: '#0F3B8C',
    textDecorationLine: 'underline',
  },
  cardActionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  actionBtn: {
    flex: 1,
    height: 32,
    borderRadius: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnApprove: {
    backgroundColor: '#10B981',
  },
  actionBtnReject: {
    backgroundColor: '#EF4444',
  },
  actionBtnText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
    color: '#FFFFFF',
  },
  documentCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#EFF2F7',
  },
  documentTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    color: '#111827',
  },
  documentMeta: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    color: '#6B7280',
    marginTop: 2,
  },
  docViewBtn: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: '#EFF6FF',
  },
  overlayCenter: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  rejectionModalBox: {
    width: '90%',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
  },
  rejectionModalTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 16,
    color: '#111827',
  },
  rejectionModalSubtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: '#6B7280',
    marginTop: 4,
    lineHeight: 16,
  },
  rejectionInput: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    padding: 10,
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: '#111827',
    textAlignVertical: 'top',
    height: 80,
    marginTop: 14,
  },
  rejectionActionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 16,
  },
  rejActionBtn: {
    paddingHorizontal: 16,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTabText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: '#9CA3AF',
    textAlign: 'center',
    marginVertical: 20,
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

export default StaffScreen;
