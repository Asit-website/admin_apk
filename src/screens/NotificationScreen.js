import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  SafeAreaView,
  Platform,
  StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { getAdminNotifications, markNotificationAsRead, markAllNotificationsAsRead } from '../config/api';

dayjs.extend(relativeTime);

export default function NotificationScreen({ navigation }) {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 10;

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await getAdminNotifications();
      if (res?.success) {
        setNotifications(res.data || []);
      }
    } catch (err) {
      console.log('Error fetching notifications:', err);
    }
  }, []);

  const loadData = async () => {
    setLoading(true);
    await fetchNotifications();
    setCurrentPage(1);
    setLoading(false);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchNotifications();
    setCurrentPage(1);
    setRefreshing(false);
  };

  const paginatedNotifications = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return notifications.slice(start, start + PAGE_SIZE);
  }, [notifications, currentPage]);

  const totalPages = Math.max(1, Math.ceil(notifications.length / PAGE_SIZE));

  useEffect(() => {
    loadData();
  }, []);

  const handleMarkAsRead = async (id, isRead) => {
    if (isRead) return; // Already read
    
    // Optimistic update
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, isRead: true } : n))
    );

    try {
      await markNotificationAsRead(id);
    } catch (err) {
      console.log('Error marking notification as read:', err);
      // Revert if API fails
      await fetchNotifications();
    }
  };

  const handleMarkAllRead = async () => {
    // Check if there are any unread notifications
    const hasUnread = notifications.some((n) => !n.isRead);
    if (!hasUnread) return;

    // Optimistic update
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));

    try {
      await markAllNotificationsAsRead();
    } catch (err) {
      console.log('Error marking all as read:', err);
      await fetchNotifications();
    }
  };

  const getNotifConfig = (type) => {
    switch (type) {
      case 'late':
        return {
          icon: 'time',
          iconColor: '#F59E0B', // Amber
          bgColor: '#FEF3C7',
          borderColor: '#F59E0B',
        };
      case 'leave_request':
        return {
          icon: 'calendar',
          iconColor: '#8B5CF6', // Purple
          bgColor: '#EDE9FE',
          borderColor: '#8B5CF6',
        };
      case 'missing_attendance':
        return {
          icon: 'close-circle',
          iconColor: '#EF4444', // Red
          bgColor: '#FEE2E2',
          borderColor: '#EF4444',
        };
      case 'birthday':
        return {
          icon: 'gift',
          iconColor: '#EC4899', // Pink
          bgColor: '#FCE7F3',
          borderColor: '#EC4899',
        };
      case 'anniversary':
        return {
          icon: 'ribbon',
          iconColor: '#3B82F6', // Blue
          bgColor: '#DBEAFE',
          borderColor: '#3B82F6',
        };
      default:
        return {
          icon: 'notifications',
          iconColor: '#6B7280', // Gray
          bgColor: '#F3F4F6',
          borderColor: '#6B7280',
        };
    }
  };

  const renderItem = ({ item }) => {
    const cfg = getNotifConfig(item.type);
    const isUnread = !item.isRead;

    return (
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={() => handleMarkAsRead(item.id, item.isRead)}
        style={[
          styles.card,
          isUnread && styles.unreadCard,
          { borderLeftColor: cfg.borderColor },
        ]}
      >
        <View style={[styles.iconContainer, { backgroundColor: cfg.bgColor }]}>
          <Ionicons name={cfg.icon} size={22} color={cfg.iconColor} />
        </View>

        <View style={styles.contentContainer}>
          <View style={styles.cardHeader}>
            <Text style={[styles.title, isUnread && styles.unreadText]}>
              {item.title}
            </Text>
            {isUnread && <View style={styles.unreadDot} />}
          </View>
          <Text style={[styles.message, isUnread && styles.unreadMessageText]}>
            {item.message}
          </Text>
          <Text style={styles.timeText}>
            {dayjs(item.createdAt).fromNow()}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

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
        
        <Text style={styles.headerTitle}>Notifications</Text>
        
        <TouchableOpacity
          onPress={handleMarkAllRead}
          disabled={!notifications.some(n => !n.isRead)}
          style={styles.markAllButton}
        >
          <Text
            style={[
              styles.markAllText,
              !notifications.some(n => !n.isRead) && styles.disabledMarkAll,
            ]}
          >
            Mark all read
          </Text>
        </TouchableOpacity>
      </View>

      {/* List */}
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#4F46E5" />
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          <FlatList
            data={paginatedNotifications}
            keyExtractor={(item) => String(item.id)}
            renderItem={renderItem}
            contentContainerStyle={styles.listContainer}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
                colors={['#4F46E5']}
                tintColor="#4F46E5"
              />
            }
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <View style={styles.emptyIconCircle}>
                  <Ionicons name="notifications-off-outline" size={48} color="#9CA3AF" />
                </View>
                <Text style={styles.emptyTitle}>You're all caught up!</Text>
                <Text style={styles.emptySub}>
                  We will notify you here when leaves are applied, staff arrive late, or have birthdays.
                </Text>
              </View>
            }
          />

          {!loading && notifications.length > PAGE_SIZE && (
            <View style={styles.paginationCard}>
              <TouchableOpacity
                style={[styles.pageNavButton, currentPage === 1 && styles.pageNavButtonDisabled]}
                onPress={() => setCurrentPage(page => Math.max(1, page - 1))}
                disabled={currentPage === 1}
                activeOpacity={0.8}
              >
                <Ionicons name="chevron-back" size={18} color={currentPage === 1 ? '#CBD5E1' : '#4F46E5'} />
              </TouchableOpacity>

              <View style={styles.pageInfo}>
                <Text style={styles.pageInfoTitle}>Page {currentPage} of {totalPages}</Text>
                <Text style={styles.pageInfoSub}>
                  {((currentPage - 1) * PAGE_SIZE) + 1}-{Math.min(currentPage * PAGE_SIZE, notifications.length)} of {notifications.length}
                </Text>
              </View>

              <TouchableOpacity
                style={[styles.pageNavButton, currentPage === totalPages && styles.pageNavButtonDisabled]}
                onPress={() => setCurrentPage(page => Math.min(totalPages, page + 1))}
                disabled={currentPage === totalPages}
                activeOpacity={0.8}
              >
                <Ionicons name="chevron-forward" size={18} color={currentPage === totalPages ? '#CBD5E1' : '#4F46E5'} />
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 1,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1F2937',
    fontFamily: 'Inter_700Bold',
  },
  markAllButton: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  markAllText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#4F46E5',
    fontFamily: 'Inter_600SemiBold',
  },
  disabledMarkAll: {
    color: '#9CA3AF',
  },
  listContainer: {
    padding: 16,
    flexGrow: 1,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    flexDirection: 'row',
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderLeftWidth: 4,
    // Soft shadow
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.03,
        shadowRadius: 3,
      },
      android: {
        elevation: 1,
      },
    }),
  },
  unreadCard: {
    backgroundColor: '#EEF2FF', // extremely soft tinted blue for unread
  },
  iconContainer: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  contentContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  title: {
    fontSize: 15,
    fontWeight: '500',
    color: '#4B5563',
    fontFamily: 'Inter_500Medium',
    flex: 1,
    marginRight: 8,
  },
  unreadText: {
    fontWeight: '700',
    color: '#111827',
    fontFamily: 'Inter_700Bold',
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#3B82F6',
  },
  message: {
    fontSize: 14,
    color: '#6B7280',
    fontFamily: 'Inter_400Regular',
    lineHeight: 20,
    marginBottom: 6,
  },
  unreadMessageText: {
    color: '#374151',
  },
  timeText: {
    fontSize: 12,
    color: '#9CA3AF',
    fontFamily: 'Inter_400Regular',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingTop: 100,
  },
  emptyIconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#374151',
    fontFamily: 'Inter_700Bold',
    marginBottom: 8,
  },
  emptySub: {
    fontSize: 14,
    color: '#6B7280',
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    lineHeight: 20,
  },
  paginationCard: {
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#EAEFF8',
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
  },
  pageNavButton: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EEF2FF',
    borderWidth: 1,
    borderColor: '#E0E7FF',
  },
  pageNavButtonDisabled: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E5E7EB',
  },
  pageInfo: {
    alignItems: 'center',
  },
  pageInfoTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 12,
    color: '#1F2937',
  },
  pageInfoSub: {
    fontFamily: 'Inter_500Medium',
    fontSize: 10,
    color: '#6B7280',
    marginTop: 2,
  },
});
