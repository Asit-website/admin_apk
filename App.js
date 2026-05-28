import React, { useEffect, useState, useRef } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useFonts, Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';

import LoginScreen from './src/screens/LoginScreen';
import OTPScreen from './src/screens/OTPScreen';
import SelectOrgScreen from './src/screens/SelectOrgScreen';
import DashboardScreen from './src/screens/DashboardScreen';
import AttendanceScreen from './src/screens/AttendanceScreen';
import StaffScreen from './src/screens/StaffScreen';
import LeaveScreen from './src/screens/LeaveScreen';
import NotificationScreen from './src/screens/NotificationScreen';
import ReportsScreen from './src/screens/ReportsScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import ToastHost from './src/components/ToastHost';
import AndroidNotification from './src/components/AndroidNotification';
import { setNotificationRef } from './src/utils/notify';

const Stack = createNativeStackNavigator();

export default function App() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  const [initialRoute, setInitialRoute] = useState(null);
  const [notification, setNotification] = useState({ visible: false, title: '', message: '', type: 'success' });
  const notificationRef = useRef();

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const token = await AsyncStorage.getItem('auth_token');
        if (mounted) setInitialRoute(token ? 'Dashboard' : 'Login');
      } catch (e) {
        if (mounted) setInitialRoute('Login');
      }
    })();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    notificationRef.current = {
      show: (title, message, type) => {
        setNotification({ visible: true, title, message, type });
      }
    };
    setNotificationRef(notificationRef.current);
  }, []);

  const handleNotificationClose = () => {
    setNotification({ visible: false, title: '', message: '', type: 'success' });
  };

  if (!fontsLoaded || !initialRoute) return null;

  return (
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1, backgroundColor: '#ffffff' }} edges={['top', 'bottom']}>
        <NavigationContainer>
          <ToastHost />
          <AndroidNotification
            visible={notification.visible}
            title={notification.title}
            message={notification.message}
            type={notification.type}
            onClose={handleNotificationClose}
          />
          <Stack.Navigator initialRouteName={initialRoute} screenOptions={{ animation: 'fade' }}>
            {/* Auth Screens */}
            <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
            <Stack.Screen name="OTP" component={OTPScreen} options={{ headerShown: false }} />
            <Stack.Screen name="SelectOrg" component={SelectOrgScreen} options={{ headerShown: false }} />

            {/* Main App Screens (with BottomNav inside each screen) */}
            <Stack.Screen name="Dashboard" component={DashboardScreen} options={{ headerShown: false }} />
            <Stack.Screen name="Attendance" component={AttendanceScreen} options={{ headerShown: false }} />
            <Stack.Screen name="Staff" component={StaffScreen} options={{ headerShown: false }} />
            <Stack.Screen name="Leave" component={LeaveScreen} options={{ headerShown: false }} />
            <Stack.Screen name="Notification" component={NotificationScreen} options={{ headerShown: false }} />
            <Stack.Screen name="Reports" component={ReportsScreen} options={{ headerShown: false }} />
            <Stack.Screen name="Profile" component={ProfileScreen} options={{ headerShown: false }} />
          </Stack.Navigator>
        </NavigationContainer>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
