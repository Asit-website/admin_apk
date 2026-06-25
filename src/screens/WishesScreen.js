import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  SafeAreaView,
  StatusBar,
  Linking,
  Alert,
  Dimensions,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import api from '../config/api';

const { width } = Dimensions.get('window');

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

export default function WishesScreen({ navigation }) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [birthdays, setBirthdays] = useState([]);
  const [anniversaries, setAnniversaries] = useState([]);
  const [activeTab, setActiveTab] = useState('birthdays'); // birthdays or anniversaries

  const fetchWishes = useCallback(async () => {
    try {
      const res = await api.get('/admin/wishes');
      if (res?.data?.success) {
        setBirthdays(res.data.birthdays || []);
        setAnniversaries(res.data.anniversaries || []);
      }
    } catch (err) {
      console.log('Error fetching wishes:', err);
    }
  }, []);

  const loadData = async () => {
    setLoading(true);
    await fetchWishes();
    setLoading(false);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchWishes();
    setRefreshing(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const getYearsOfService = (dateOfJoining) => {
    if (!dateOfJoining) return 0;
    const joinDate = new Date(dateOfJoining);
    const today = new Date();
    let years = today.getFullYear() - joinDate.getFullYear();
    const m = today.getMonth() - joinDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < joinDate.getDate())) {
      years--;
    }
    return Math.max(0, years);
  };

  const getTurningAge = (dob) => {
    if (!dob) return 0;
    const birthDate = new Date(dob);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    return Math.max(0, age + 1); // Turning age next/this birthday
  };

  const handleSendWhatsApp = (item, type) => {
    let rawPhone = item.phone || '';
    let cleanPhone = rawPhone.replace(/\D/g, '');
    
    if (!cleanPhone) {
      Alert.alert('Error', 'Phone number not available for this staff member!');
      return;
    }
    
    if (cleanPhone.length === 10) {
      cleanPhone = '91' + cleanPhone;
    }
    
    let defaultMsg = '';
    if (type === 'birthday') {
      defaultMsg = `🎉 Happy Birthday, ${item.name}! Wishing you a wonderful day filled with joy, and a fantastic year ahead. Thank you for being such an important part of our team! 🎂✨`;
    } else {
      const years = getYearsOfService(item.dateOfJoining);
      const yearText = years > 0 ? ` completed ${years} year${years > 1 ? 's' : ''} of service` : ' work anniversary';
      defaultMsg = `💼 Happy Work Anniversary, ${item.name}! Congratulations on your${yearText} with us. Thank you for your dedication, hard work, and support! 🌟👏`;
    }
    
    const encodedText = encodeURIComponent(defaultMsg);
    const whatsappUrl = `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodedText}`;
    
    Linking.openURL(whatsappUrl).catch(() => {
      Alert.alert('Error', 'Failed to open WhatsApp. Please check if it is installed.');
    });
  };

  const renderCurrentMonthHighlights = () => {
    const currentMonthNum = new Date().getMonth() + 1;
    const currentDayNum = new Date().getDate();
    const items = activeTab === 'birthdays' ? birthdays : anniversaries;
    const thisMonthItems = items.filter(item => item.month === currentMonthNum);

    if (thisMonthItems.length === 0) {
      return (
        <View style={styles.emptyHighlights}>
          <Ionicons name="sparkles-outline" size={24} color="#94A3B8" />
          <Text style={styles.emptyHighlightsText}>
            No {activeTab === 'birthdays' ? 'birthdays' : 'anniversaries'} this month
          </Text>
        </View>
      );
    }

    return (
      <View style={styles.highlightsContainer}>
        <Text style={styles.sectionTitle}>
          {MONTH_NAMES[currentMonthNum - 1]} Highlights 🌟
        </Text>
        {thisMonthItems.map(item => {
          const isToday = item.day === currentDayNum;
          const years = activeTab === 'anniversaries' ? getYearsOfService(item.dateOfJoining) : 0;
          const age = activeTab === 'birthdays' ? getTurningAge(item.dob) : 0;

          return (
            <View 
              key={item.id} 
              style={[
                styles.highlightCard, 
                isToday && styles.highlightCardToday
              ]}
            >
              <View style={styles.highlightLeft}>
                <View style={styles.avatarWrap}>
                  {item.photoUrl ? (
                    <Image source={{ uri: item.photoUrl }} style={styles.avatar} />
                  ) : (
                    <View style={[styles.avatarFallback, { backgroundColor: isToday ? '#EF4444' : '#3B82F6' }]}>
                      <Text style={styles.avatarFallbackText}>
                        {item.name ? item.name.charAt(0).toUpperCase() : 'S'}
                      </Text>
                    </View>
                  )}
                  {isToday && (
                    <View style={styles.activeDot} />
                  )}
                </View>
                <View style={styles.highlightInfo}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                    <Text style={styles.highlightName}>{item.name}</Text>
                    {isToday && (
                      <View style={styles.todayTag}>
                        <Text style={styles.todayTagText}>TODAY</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.highlightSub}>{item.designation || 'Staff Member'}</Text>
                  <Text style={styles.highlightDate}>
                    {activeTab === 'birthdays' ? (
                      <Text style={{ color: '#2563EB', fontWeight: '500' }}>
                        🎂 {item.day} {MONTH_NAMES[item.month - 1].substring(0, 3)} (Turning {age})
                      </Text>
                    ) : (
                      <Text style={{ color: '#7C3AED', fontWeight: '500' }}>
                        💼 {item.day} {MONTH_NAMES[item.month - 1].substring(0, 3)} ({years === 0 ? 'Joined' : `${years} Year${years > 1 ? 's' : ''}`})
                      </Text>
                    )}
                  </Text>
                </View>
              </View>
              <TouchableOpacity 
                style={[styles.wishButton, isToday && styles.wishButtonToday]}
                onPress={() => handleSendWhatsApp(item, activeTab === 'birthdays' ? 'birthday' : 'anniversary')}
                activeOpacity={0.8}
              >
                <Ionicons name="logo-whatsapp" size={16} color="#FFFFFF" />
                <Text style={styles.wishButtonText}>Wish</Text>
              </TouchableOpacity>
            </View>
          );
        })}
      </View>
    );
  };

  const renderYearlyGrid = () => {
    const items = activeTab === 'birthdays' ? birthdays : anniversaries;
    
    const grouped = {};
    for (let m = 1; m <= 12; m++) {
      grouped[m] = [];
    }
    
    items.forEach(item => {
      if (item.month && grouped[item.month]) {
        grouped[item.month].push(item);
      }
    });

    const hasData = items.length > 0;
    if (!hasData) {
      return (
        <View style={styles.emptyGrid}>
          <Ionicons name="gift-outline" size={40} color="#94A3B8" />
          <Text style={styles.emptyGridText}>No milestone records available</Text>
        </View>
      );
    }

    return (
      <View style={styles.gridContainer}>
        <Text style={styles.sectionTitle}>Yearly Calendar</Text>
        {MONTH_NAMES.map((monthName, idx) => {
          const monthNum = idx + 1;
          const monthItems = grouped[monthNum];
          
          if (monthItems.length === 0) return null;

          return (
            <View key={monthName} style={styles.monthCard}>
              <View style={styles.monthHeader}>
                <Ionicons name="calendar" size={16} color="#4F46E5" />
                <Text style={styles.monthTitle}>{monthName}</Text>
                <View style={styles.countBadge}>
                  <Text style={styles.countBadgeText}>{monthItems.length}</Text>
                </View>
              </View>
              <View style={styles.monthBody}>
                {monthItems.map(item => {
                  const years = activeTab === 'anniversaries' ? getYearsOfService(item.dateOfJoining) : 0;
                  return (
                    <View key={item.id} style={styles.staffRow}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                        <AvatarSmall name={item.name} photoUrl={item.photoUrl} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.staffName} numberOfLines={1}>{item.name}</Text>
                          <Text style={styles.staffSub} numberOfLines={1}>{item.designation || '-'}</Text>
                        </View>
                      </View>
                      <View style={{ alignItems: 'flex-end', justifyContent: 'center' }}>
                        <Text style={styles.staffDate}>
                          {item.day} {monthName.substring(0, 3)}
                        </Text>
                        <Text style={styles.staffDetail}>
                          {activeTab === 'birthdays' ? (
                            item.dob.substring(0, 4)
                          ) : (
                            years === 0 ? 'Joined' : `${years} Yr${years > 1 ? 's' : ''}`
                          )}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
          );
        })}
      </View>
    );
  };

  if (loading && !refreshing) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator size="large" color="#4F46E5" />
        <Text style={styles.loadingText}>Loading milestones...</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
          hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
        >
          <Ionicons name="arrow-back" size={24} color="#1F2937" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Milestones & Wishes</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Tabs */}
      <View style={styles.tabBar}>
        <TouchableOpacity 
          style={[styles.tabItem, activeTab === 'birthdays' && styles.tabItemActive]}
          onPress={() => setActiveTab('birthdays')}
        >
          <Ionicons 
            name="gift" 
            size={18} 
            color={activeTab === 'birthdays' ? '#4F46E5' : '#6B7280'} 
          />
          <Text style={[styles.tabLabel, activeTab === 'birthdays' && styles.tabLabelActive]}>
            Birthdays
          </Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[styles.tabItem, activeTab === 'anniversaries' && styles.tabItemActive]}
          onPress={() => setActiveTab('anniversaries')}
        >
          <Ionicons 
            name="heart" 
            size={18} 
            color={activeTab === 'anniversaries' ? '#4F46E5' : '#6B7280'} 
          />
          <Text style={[styles.tabLabel, activeTab === 'anniversaries' && styles.tabLabelActive]}>
            Anniversaries
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#4F46E5" />}
      >
        {/* Highlights Section */}
        {renderCurrentMonthHighlights()}

        <View style={{ height: 16 }} />

        {/* Calendar Grid */}
        {renderYearlyGrid()}
      </ScrollView>
    </SafeAreaView>
  );
}

function AvatarSmall({ name, photoUrl }) {
  if (photoUrl) {
    return <Image source={{ uri: photoUrl }} style={styles.avatarSmall} />;
  }
  const initial = name ? name.charAt(0).toUpperCase() : 'S';
  return (
    <View style={styles.avatarSmallFallback}>
      <Text style={styles.avatarSmallFallbackText}>{initial}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F9FAFB' },
  loadingText: { marginTop: 12, fontSize: 13, color: '#6B7280', fontFamily: 'Inter_400Regular' },
  
  header: {
    height: 56,
    backgroundColor: '#ffffff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
  },
  backButton: { width: 40, height: 40, justifyContent: 'center', alignItems: 'flex-start' },
  headerTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', color: '#1F2937' },
  
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  tabItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    gap: 8,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabItemActive: {
    borderBottomColor: '#4F46E5',
  },
  tabLabel: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    color: '#6B7280',
  },
  tabLabelActive: {
    color: '#4F46E5',
    fontFamily: 'Inter_600SemiBold',
  },
  
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 40 },

  sectionTitle: {
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
    color: '#111827',
    marginBottom: 12,
  },

  emptyHighlights: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderStyle: 'dashed',
    gap: 8,
  },
  emptyHighlightsText: {
    fontSize: 13,
    color: '#6B7280',
    fontFamily: 'Inter_400Regular',
  },

  highlightsContainer: {
    marginBottom: 8,
  },
  highlightCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 2,
  },
  highlightCardToday: {
    borderColor: '#FCA5A5',
    backgroundColor: '#FEF2F2',
  },
  highlightLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 12,
  },
  avatarWrap: {
    position: 'relative',
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
  },
  avatarFallback: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarFallbackText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontFamily: 'Inter_600SemiBold',
  },
  activeDot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#EF4444',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  highlightInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  highlightName: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    color: '#1F2937',
  },
  todayTag: {
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#FCA5A5',
  },
  todayTagText: {
    color: '#EF4444',
    fontSize: 9,
    fontFamily: 'Inter_700Bold',
  },
  highlightSub: {
    fontSize: 12,
    color: '#6B7280',
    fontFamily: 'Inter_400Regular',
    marginTop: 2,
  },
  highlightDate: {
    fontSize: 12,
    marginTop: 4,
  },
  wishButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#10B981',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    marginLeft: 8,
  },
  wishButtonToday: {
    backgroundColor: '#EF4444',
  },
  wishButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
  },

  emptyGrid: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    gap: 10,
  },
  emptyGridText: {
    fontSize: 13,
    color: '#6B7280',
    fontFamily: 'Inter_400Regular',
  },

  gridContainer: {
    marginTop: 8,
  },
  monthCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    overflow: 'hidden',
  },
  monthHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#F9FAFB',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    gap: 8,
  },
  monthTitle: {
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
    color: '#1F2937',
    flex: 1,
  },
  countBadge: {
    backgroundColor: '#E5E7EB',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  countBadgeText: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: '#4B5563',
  },
  monthBody: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  staffRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  staffName: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: '#374151',
  },
  staffSub: {
    fontSize: 11,
    color: '#6B7280',
    fontFamily: 'Inter_400Regular',
    marginTop: 2,
  },
  staffDate: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: '#4B5563',
  },
  staffDetail: {
    fontSize: 11,
    color: '#9CA3AF',
    fontFamily: 'Inter_400Regular',
    marginTop: 2,
  },

  avatarSmall: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  avatarSmallFallback: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#9CA3AF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarSmallFallbackText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
  },
});
