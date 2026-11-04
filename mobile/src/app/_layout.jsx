import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { colors } from '../theme';
import { registerForPushNotifications } from '../lib/notifications';

export default function RootLayout() {
  useEffect(() => {
    // Al montar y en cada arranque: es cuando la app puede pedir permiso y
    // sacar su token de push.
    registerForPushNotifications();
  }, []);

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: '700' },
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="types" options={{ title: 'Tipos de planta' }} />
    </Stack>
  );
}