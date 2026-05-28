import React from 'react';
import { View, TouchableOpacity, Image, Text, StyleSheet, Platform } from 'react-native';

const TABS = [
  { key: 'Dashboard',   label: 'Home',        icon: require('../assets/tab3.png'),       route: 'Dashboard' },
  { key: 'Attendance',  label: 'Attendance',   icon: require('../assets/clocks.png'),     route: 'Attendance' },
  { key: 'Staff',       label: 'Staff',        icon: require('../assets/person-circle.png'), route: 'Staff' },
  { key: 'Leave',       label: 'Leave',        icon: require('../assets/leave1.png'),     route: 'Leave' },
  { key: 'Reports',     label: 'Reports',      icon: require('../assets/bar-chart-line.png'), route: 'Reports' },
  { key: 'Profile',     label: 'Profile',      icon: require('../assets/setting1.png'),      route: 'Profile' },
];

export default function BottomNav({ navigation, activeKey = 'Dashboard' }) {
  const onPressTab = (t) => {
    if (navigation && t.route) {
      try { navigation.navigate(t.route); } catch (e) { }
    }
  };

  return (
    <View style={[styles.wrap, Platform.OS === 'web' ? styles.wrapWeb : styles.wrapNative]}>
      {TABS.map((t) => {
        const active = activeKey === t.key;
        return (
          <TouchableOpacity key={t.key} style={styles.item} onPress={() => onPressTab(t)} activeOpacity={0.85}>
            <Image
              source={t.icon}
              style={{ width: 20, height: 20, opacity: active ? 1 : 0.8, tintColor: active ? '#FFFFFF' : '#BFD6FF' }}
            />
            <Text style={[styles.label, active && styles.labelActive]}>{t.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    left: 0, right: 0, bottom: 0,
    width: '100%',
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 14,
    backgroundColor: '#0F3B8C', flexDirection: 'row', justifyContent: 'space-between',
    borderTopLeftRadius: 16, borderTopRightRadius: 16,
    shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 6, elevation: 20,
    zIndex: 999,
  },
  wrapNative: { position: 'absolute' },
  wrapWeb: { position: 'fixed' },
  item: { flex: 1, alignItems: 'center', gap: 4 },
  label: { color: '#BFD6FF', fontSize: 10, fontFamily: 'Inter_400Regular' },
  labelActive: { color: '#FFFFFF', fontFamily: 'Inter_600SemiBold' },
});
