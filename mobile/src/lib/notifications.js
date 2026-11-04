import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { api } from '../api';

// Tiene que coincidir con el channelId que manda la API, si no Android
// descarta la notificación entera.
const CHANNEL_ID = 'riego';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function registerForPushNotifications() {
  try {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Riego',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#2E7D32',
    });

    const { status: current } = await Notifications.getPermissionsAsync();
    let status = current;
    if (status !== 'granted') {
      status = (await Notifications.requestPermissionsAsync()).status;
    }
    if (status !== 'granted') return false;

    const projectId =
      Constants?.expoConfig?.extra?.eas?.projectId ??
      Constants?.easConfig?.projectId;
    if (!projectId) return false;

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await api.registerPushToken(token);
    return true;
  } catch (_) {
    // Sin push la app sigue funcionando, solo pierde los avisos en segundo
    // plano. La campana de dentro ya avisa de lo mismo.
    return false;
  }
}
