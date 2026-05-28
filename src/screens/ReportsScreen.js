import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  SafeAreaView,
  Platform,
  StatusBar,
  Linking,
  Modal,
  Alert,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import dayjs from 'dayjs';
import BottomNav from '../components/BottomNav';
import api, { API_BASE_URL } from '../config/api';
import notify from '../utils/notify';

const MONTHS_GRID = [
  { label: 'Jan', val: '01' },
  { label: 'Feb', val: '02' },
  { label: 'Mar', val: '03' },
  { label: 'Apr', val: '04' },
  { label: 'May', val: '05' },
  { label: 'Jun', val: '06' },
  { label: 'Jul', val: '07' },
  { label: 'Aug', val: '08' },
  { label: 'Sep', val: '09' },
  { label: 'Oct', val: '10' },
  { label: 'Nov', val: '11' },
  { label: 'Dec', val: '12' },
];

const REPORT_TYPES = [
  {
    key: 'monthly-attendance',
    title: 'Monthly Attendance Report',
    subtitle: 'Detailed Excel Sheet with detailed check-in, check-out and status',
    icon: 'calendar-outline',
    color: '#0F3B8C',
    bgColor: '#EFF6FF',
    endpoint: '/admin/reports/monthly-attendance',
  },
  {
    key: 'salary-register',
    title: 'Salary Register Report',
    subtitle: 'Detailed Salary Register (Designation / Department / Template wise)',
    icon: 'document-text-outline',
    color: '#DC2626',
    bgColor: '#FEF2F2',
    endpoint: '/admin/payroll/salary-register-excel-by-month',
  },
  {
    key: 'ot-impact',
    title: 'Overtime (OT Impact Report)',
    subtitle: 'Detailed Overtime impact, minutes, and overtime earnings analysis',
    icon: 'time-outline',
    color: '#0D9488',
    bgColor: '#F0FDFA',
    endpoint: '/admin/reports/ot-impact',
  },
  {
    key: 'monthly-summary',
    title: 'Payroll Summary',
    subtitle: 'Monthly salary register summary (Designation / Department wise)',
    icon: 'cash-outline',
    color: '#7C3AED',
    bgColor: '#F5F3FF',
    endpoint: '/admin/payroll/monthly-summary-excel',
  },
];

export default function ReportsScreen({ navigation }) {
  const [downloading, setDownloading] = useState(false);
  const [selectedReport, setSelectedReport] = useState('monthly-attendance');
  const [selectedMonth, setSelectedMonth] = useState(dayjs().format('YYYY-MM'));
  const [groupBy, setGroupBy] = useState('designation'); // 'designation', 'department' or 'template'
  const [token, setToken] = useState(null);
  const [subInfo, setSubInfo] = useState(null);
  
  // Custom Month Picker states
  const [showPickerModal, setShowPickerModal] = useState(false);
  const [pickerYear, setPickerYear] = useState(dayjs().year());

  const fetchSubscriptionInfo = async () => {
    try {
      const res = await api.get('/subscription/subscription-info');
      if (res?.data?.success && res.data.subscriptionInfo) {
        setSubInfo(res.data.subscriptionInfo);
      }
    } catch (err) {
      console.log('Error fetching subscription info:', err);
    }
  };

  const visibleReports = React.useMemo(() => {
    if (!subInfo) return REPORT_TYPES;
    return REPORT_TYPES.filter((report) => {
      if (report.key === 'salary-register') {
        return subInfo.salaryRegisterEnabled !== false;
      }
      if (report.key === 'ot-impact') {
        return subInfo.otImpactEnabled !== false;
      }
      if (report.key === 'monthly-summary') {
        return subInfo.monthlySummaryEnabled !== false;
      }
      return true;
    });
  }, [subInfo]);

  React.useEffect(() => {
    if (subInfo) {
      const isSelectedVisible = visibleReports.some((r) => r.key === selectedReport);
      if (!isSelectedVisible && visibleReports.length > 0) {
        setSelectedReport(visibleReports[0].key);
      }
    }
  }, [visibleReports, selectedReport, subInfo]);

  // Reset groupBy when report type changes to prevent invalid selections
  useEffect(() => {
    setGroupBy('designation');
  }, [selectedReport]);

  // Generate last 12 months for selector
  const months = React.useMemo(() => {
    const list = [];
    for (let i = 0; i < 12; i++) {
      const d = dayjs().subtract(i, 'month');
      list.push({
        key: d.format('YYYY-MM'),
        label: d.format('MMMM YYYY'),
        month: d.month() + 1,
        year: d.year(),
      });
    }
    return list;
  }, []);

  const loadToken = async () => {
    try {
      const savedToken = await AsyncStorage.getItem('auth_token');
      setToken(savedToken);
    } catch (e) {
      console.log('Error loading token:', e);
    }
  };

  useEffect(() => {
    loadToken();
    fetchSubscriptionInfo();
  }, []);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      fetchSubscriptionInfo();
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

  const handleDownload = async () => {
    if (downloading) return;
    setDownloading(true);

    try {
      const activeToken = token || (await AsyncStorage.getItem('auth_token'));
      if (!activeToken) {
        notify.show('Error', 'Session expired, please login again.', 'error');
        setDownloading(false);
        return;
      }

      const reportConfig = REPORT_TYPES.find((r) => r.key === selectedReport);
      if (!reportConfig) {
        notify.show('Error', 'Invalid report selected', 'error');
        setDownloading(false);
        return;
      }

      const parts = selectedMonth.split('-');
      const yearVal = parseInt(parts[0], 10);
      const monthVal = parseInt(parts[1], 10);
      if (isNaN(yearVal) || isNaN(monthVal)) {
        notify.show('Error', 'Invalid month selected', 'error');
        setDownloading(false);
        return;
      }

      // Resolve endpoint dynamically based on selections
      let endpoint = reportConfig.endpoint;
      if (selectedReport === 'salary-register') {
        if (groupBy === 'template') {
          endpoint = '/admin/payroll/salary-register-template-wise-excel';
        } else {
          endpoint = '/admin/payroll/salary-register-excel-by-month';
        }
      }

      // Build url parameters
      const baseUrl = API_BASE_URL.replace(/\/$/, '');
      const queryParams = [
        `token=${encodeURIComponent(activeToken)}`,
        `month=${monthVal}`,
        `year=${yearVal}`,
        `format=excel`,
        `monthKey=${selectedMonth}`,
      ];

      if (selectedReport === 'monthly-summary' || selectedReport === 'salary-register') {
        queryParams.push(`groupBy=${groupBy}`);
      }

      const downloadUrl = `${baseUrl}${endpoint}?${queryParams.join('&')}`;

      console.log('[Reports] Triggering download via:', downloadUrl);
      
      const supported = await Linking.canOpenURL(downloadUrl);
      if (supported || Platform.OS === 'web') {
        await Linking.openURL(downloadUrl);
        notify.show('Success', 'Download triggered in browser!', 'success');
      } else {
        notify.show('Error', 'Cannot open download link on this device', 'error');
      }
    } catch (err) {
      console.error('[Reports] Download failed:', err);
      notify.show('Error', 'Failed to generate Excel download.', 'error');
    } finally {
      setTimeout(() => {
        setDownloading(false);
      }, 1500);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />

      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Reports</Text>
        </View>
        <View style={styles.headerRight}>
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
      >
        {/* 1. Report Type Card Selector */}
        <Text style={styles.sectionLabel}>Select Report Type</Text>
        <View style={styles.reportList}>
          {visibleReports.map((report) => {
            const isSelected = selectedReport === report.key;
            return (
              <TouchableOpacity
                key={report.key}
                activeOpacity={0.8}
                onPress={() => setSelectedReport(report.key)}
                style={[
                  styles.reportCard,
                  isSelected && {
                    borderColor: report.color,
                    backgroundColor: report.bgColor,
                    borderWidth: 2,
                  },
                ]}
              >
                <View style={[styles.iconBox, { backgroundColor: isSelected ? '#ffffff' : report.bgColor }]}>
                  <Ionicons name={report.icon} size={22} color={report.color} />
                </View>
                <View style={styles.reportInfo}>
                  <Text style={[styles.reportTitle, isSelected && { color: report.color, fontWeight: '700' }]}>
                    {report.title}
                  </Text>
                  <Text style={styles.reportSubtitle}>{report.subtitle}</Text>
                </View>
                <View style={checkboxStyles(isSelected, report.color).checkboxContainer}>
                  {isSelected ? (
                    <Ionicons name="checkmark-circle" size={24} color={report.color} />
                  ) : (
                    <View style={styles.checkboxOutline} />
                  )}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* 2. Group By Options (If Payroll Summary or Salary Register is selected) */}
        {(selectedReport === 'monthly-summary' || selectedReport === 'salary-register') && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Group By Summary Option</Text>
            <View style={styles.toggleRow}>
              {/* Designation Wise */}
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={() => setGroupBy('designation')}
                style={[
                  styles.toggleBtn,
                  groupBy === 'designation' && styles.toggleBtnActive,
                ]}
              >
                <Ionicons
                  name="id-card-outline"
                  size={18}
                  color={groupBy === 'designation' ? '#ffffff' : '#0F3B8C'}
                  style={{ marginRight: 10 }}
                />
                <Text style={[styles.toggleText, groupBy === 'designation' && styles.toggleTextActive]}>
                  Designation Wise
                </Text>
                {groupBy === 'designation' && (
                  <Ionicons name="checkmark-circle" size={18} color="#ffffff" style={{ marginLeft: 'auto' }} />
                )}
              </TouchableOpacity>

              {/* Department Wise */}
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={() => setGroupBy('department')}
                style={[
                  styles.toggleBtn,
                  groupBy === 'department' && styles.toggleBtnActive,
                ]}
              >
                <Ionicons
                  name="business-outline"
                  size={18}
                  color={groupBy === 'department' ? '#ffffff' : '#0D9488'}
                  style={{ marginRight: 10 }}
                />
                <Text style={[styles.toggleText, groupBy === 'department' && styles.toggleTextActive]}>
                  Department Wise
                </Text>
                {groupBy === 'department' && (
                  <Ionicons name="checkmark-circle" size={18} color="#ffffff" style={{ marginLeft: 'auto' }} />
                )}
              </TouchableOpacity>

              {/* Template Wise (only for salary-register) */}
              {selectedReport === 'salary-register' && (
                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={() => setGroupBy('template')}
                  style={[
                    styles.toggleBtn,
                    groupBy === 'template' && styles.toggleBtnActive,
                  ]}
                >
                  <Ionicons
                    name="document-attach-outline"
                    size={18}
                    color={groupBy === 'template' ? '#ffffff' : '#7C3AED'}
                    style={{ marginRight: 10 }}
                  />
                  <Text style={[styles.toggleText, groupBy === 'template' && styles.toggleTextActive]}>
                    Template Wise
                  </Text>
                  {groupBy === 'template' && (
                    <Ionicons name="checkmark-circle" size={18} color="#ffffff" style={{ marginLeft: 'auto' }} />
                  )}
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}

        {/* 3. Month Picker (Premium custom month-year picker card & Modal) */}
        <Text style={styles.sectionLabel}>Select Month</Text>
        
        <TouchableOpacity
          activeOpacity={0.855}
          onPress={() => {
            const parts = selectedMonth.split('-');
            setPickerYear(parseInt(parts[0], 10) || dayjs().year());
            setShowPickerModal(true);
          }}
          style={styles.customPickerCard}
        >
          <View style={styles.customPickerLeft}>
            <View style={styles.customCalendarIcon}>
              <Ionicons name="calendar-outline" size={24} color="#0F3B8C" />
            </View>
            <View style={{ marginLeft: 14 }}>
              <Text style={styles.customPickerMonth}>
                {dayjs(selectedMonth).format('MMMM YYYY')}
              </Text>
              <Text style={styles.customPickerSub}>Tap to change month or year</Text>
            </View>
          </View>
          <View style={styles.customPickerRight}>
            <Ionicons name="chevron-down" size={20} color="#9CA3AF" />
          </View>
        </TouchableOpacity>

        {/* Modal for month selection */}
        <Modal
          visible={showPickerModal}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setShowPickerModal(false)}
        >
          <View style={styles.modalBackdrop}>
            <TouchableOpacity 
              style={styles.modalOverlayClose} 
              activeOpacity={1} 
              onPress={() => setShowPickerModal(false)} 
            />
            
            <View style={styles.pickerModalContainer}>
              <View style={styles.pickerModalHeader}>
                <Text style={styles.pickerModalTitle}>Select Month & Year</Text>
                <TouchableOpacity 
                  onPress={() => setShowPickerModal(false)}
                  style={styles.closeBtn}
                >
                  <Ionicons name="close-circle" size={26} color="#9CA3AF" />
                </TouchableOpacity>
              </View>

              {/* Year Selector */}
              <View style={styles.yearSelectorRow}>
                <TouchableOpacity 
                  onPress={() => setPickerYear(prev => prev - 1)}
                  style={styles.yearArrow}
                  activeOpacity={0.7}
                >
                  <Ionicons name="chevron-back" size={22} color="#0F3B8C" />
                </TouchableOpacity>
                
                <Text style={styles.yearText}>{pickerYear}</Text>
                
                <TouchableOpacity 
                  onPress={() => setPickerYear(prev => prev + 1)}
                  style={styles.yearArrow}
                  activeOpacity={0.7}
                >
                  <Ionicons name="chevron-forward" size={22} color="#0F3B8C" />
                </TouchableOpacity>
              </View>

              {/* Months Grid */}
              <View style={styles.monthsGrid}>
                {MONTHS_GRID.map((m) => {
                  const monthKey = `${pickerYear}-${m.val}`;
                  const isSelected = selectedMonth === monthKey;
                  return (
                    <TouchableOpacity
                      key={m.val}
                      activeOpacity={0.8}
                      onPress={() => {
                        setSelectedMonth(monthKey);
                        setShowPickerModal(false);
                      }}
                      style={[
                        styles.gridMonthCell,
                        isSelected && styles.gridMonthCellActive
                      ]}
                    >
                      <Text style={[
                        styles.gridMonthText,
                        isSelected && styles.gridMonthTextActive
                      ]}>
                        {m.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Quick Select Shortcuts */}
              <View style={styles.modalDivider} />
              <Text style={styles.quickSelectTitle}>Quick Select</Text>
              <View style={styles.quickButtonsRow}>
                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={() => {
                    setSelectedMonth(dayjs().format('YYYY-MM'));
                    setShowPickerModal(false);
                  }}
                  style={styles.quickBtn}
                >
                  <Text style={styles.quickBtnText}>This Month</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={() => {
                    setSelectedMonth(dayjs().subtract(1, 'month').format('YYYY-MM'));
                    setShowPickerModal(false);
                  }}
                  style={styles.quickBtn}
                >
                  <Text style={styles.quickBtnText}>Last Month</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* 4. Action Card */}
        <View style={styles.actionCard}>
          <View style={styles.actionHeader}>
            <View style={styles.excelIconCircle}>
              <Ionicons name="document-text" size={32} color="#16A34A" />
            </View>
            <View style={{ flex: 1, marginLeft: 16 }}>
              <Text style={styles.actionTitle}>Ready for export</Text>
              <Text style={styles.actionDesc}>
                Will download an optimized `.xlsx` spreadsheet matching your selections.
              </Text>
            </View>
          </View>

          <TouchableOpacity
            activeOpacity={0.85}
            onPress={handleDownload}
            disabled={downloading}
            style={[styles.downloadBtn, downloading && styles.downloadBtnDisabled]}
          >
            {downloading ? (
              <ActivityIndicator color="#ffffff" size="small" />
            ) : (
              <>
                <Ionicons name="download-outline" size={20} color="#ffffff" style={{ marginRight: 8 }} />
                <Text style={styles.downloadBtnText}>Download Excel Report</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        <View style={{ height: 20 }} />
      </ScrollView>

      <BottomNav navigation={navigation} activeKey="Reports" />
    </SafeAreaView>
  );
}

const checkboxStyles = (isSelected, color) => StyleSheet.create({
  checkboxContainer: {
    padding: 4,
  }
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFD',
  },
  header: {
    backgroundColor: '#FFFFFF',
    paddingTop: 16,
    paddingBottom: 16,
    paddingHorizontal: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E9F0',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
    fontFamily: 'Inter_700Bold',
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#6B7280',
    fontFamily: 'Inter_400Regular',
    marginTop: 2,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  premiumBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  premiumBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#D97706',
    fontFamily: 'Inter_600SemiBold',
  },

  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 90,
  },

  sectionLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#4B5563',
    fontFamily: 'Inter_600SemiBold',
    marginBottom: 10,
    marginTop: 6,
  },

  reportList: {
    marginBottom: 20,
  },
  reportCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#E5E7EB',
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.02,
        shadowRadius: 2,
      },
      android: {
        elevation: 1,
      },
    }),
  },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reportInfo: {
    flex: 1,
    marginLeft: 14,
    paddingRight: 8,
  },
  reportTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1F2937',
    fontFamily: 'Inter_600SemiBold',
  },
  reportSubtitle: {
    fontSize: 12,
    color: '#6B7280',
    fontFamily: 'Inter_400Regular',
    marginTop: 4,
    lineHeight: 16,
  },
  checkboxOutline: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#D1D5DB',
  },

  section: {
    marginBottom: 20,
  },
  toggleRow: {
    flexDirection: 'column',
    gap: 8,
  },
  toggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.02,
        shadowRadius: 1,
      },
      android: {
        elevation: 1,
      },
    }),
  },
  toggleBtnActive: {
    backgroundColor: '#0F3B8C',
    borderColor: '#0F3B8C',
  },
  toggleText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#4B5563',
    fontFamily: 'Inter_600SemiBold',
  },
  toggleTextActive: {
    color: '#ffffff',
  },

  customPickerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#ffffff',
    borderColor: '#E5E7EB',
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    marginBottom: 24,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.02,
        shadowRadius: 2,
      },
      android: {
        elevation: 1,
      },
    }),
  },
  customPickerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  customCalendarIcon: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  customPickerMonth: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1F2937',
    fontFamily: 'Inter_700Bold',
  },
  customPickerSub: {
    fontSize: 12,
    color: '#9CA3AF',
    fontFamily: 'Inter_400Regular',
    marginTop: 2,
  },
  customPickerRight: {
    padding: 4,
  },

  // Modal Styles
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalOverlayClose: {
    ...StyleSheet.absoluteFillObject,
  },
  pickerModalContainer: {
    backgroundColor: '#ffffff',
    width: '90%',
    maxWidth: 400,
    borderRadius: 24,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 10,
  },
  pickerModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  pickerModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    fontFamily: 'Inter_700Bold',
  },
  closeBtn: {
    padding: 2,
  },

  // Year Selector
  yearSelectorRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 16,
    marginBottom: 20,
  },
  yearArrow: {
    padding: 8,
  },
  yearText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    fontFamily: 'Inter_700Bold',
  },

  // Months Grid
  monthsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 20,
  },
  gridMonthCell: {
    width: '30%',
    aspectRatio: 1.6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridMonthCellActive: {
    backgroundColor: '#0F3B8C',
    borderColor: '#0F3B8C',
  },
  gridMonthText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#4B5563',
    fontFamily: 'Inter_600SemiBold',
  },
  gridMonthTextActive: {
    color: '#ffffff',
  },

  // Quick Select
  modalDivider: {
    height: 1,
    backgroundColor: '#E5E7EB',
    marginBottom: 16,
  },
  quickSelectTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#9CA3AF',
    fontFamily: 'Inter_600SemiBold',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  quickButtonsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  quickBtn: {
    flex: 1,
    backgroundColor: '#EFF6FF',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickBtnText: {
    color: '#0F3B8C',
    fontSize: 13,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
  },

  actionCard: {
    backgroundColor: '#ffffff',
    borderColor: '#E5E7EB',
    borderWidth: 1,
    borderRadius: 16,
    padding: 20,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.05,
        shadowRadius: 6,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  actionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  excelIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#DCFCE7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1F2937',
    fontFamily: 'Inter_700Bold',
  },
  actionDesc: {
    fontSize: 12,
    color: '#6B7280',
    fontFamily: 'Inter_400Regular',
    marginTop: 4,
    lineHeight: 18,
  },
  downloadBtn: {
    flexDirection: 'row',
    backgroundColor: '#16A34A',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 2,
    shadowColor: '#16A34A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
  },
  downloadBtnDisabled: {
    backgroundColor: '#86EFAC',
  },
  downloadBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
    fontFamily: 'Inter_700Bold',
  },
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
  logoutText: { 
    fontFamily: 'Inter_600SemiBold', 
    fontSize: 11, 
    color: '#DC2626' 
  },
});
