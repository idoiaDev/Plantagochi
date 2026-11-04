import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors } from '../theme';

const PREFIX = 'needs-water:';
const keyOf = (id) => `${PREFIX}${id}`;

export function useNotifications(needyPlants) {
  const [dismissed, setDismissed] = useState(() => new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const keys = await AsyncStorage.getAllKeys();
        const stored = new Set(
          keys.filter((k) => k.startsWith(PREFIX)).map((k) => Number(k.slice(PREFIX.length))),
        );
        if (!cancelled) setDismissed(stored);
      } catch (_) {
        // sin almacenamiento: no hay descartes
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const needy = new Set(needyPlants.map((p) => p.id));
    const stale = [...dismissed].filter((id) => !needy.has(id));
    if (stale.length === 0) return undefined;

    AsyncStorage.multiRemove(stale.map(keyOf)).catch(() => {});
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      setDismissed((prev) => {
        const next = new Set(prev);
        stale.forEach((id) => next.delete(id));
        return next;
      });
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [dismissed, needyPlants]);

  const dismiss = useCallback((id) => {
    setDismissed((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      AsyncStorage.setItem(keyOf(id), '1').catch(() => {});
      return next;
    });
  }, []);

  const pending = needyPlants.filter((p) => !dismissed.has(p.id));
  return { pending, dismiss };
}

function NotificationBell({ pending, onPress }) {
  const count = pending.length;
  return (
    <Pressable
      onPress={onPress}
      style={styles.bell}
      hitSlop={10}
      accessibilityLabel="Notificaciones de riego"
    >
      <Ionicons
        name={count > 0 ? 'notifications' : 'notifications-outline'}
        size={22}
        color={colors.text}
      />
      {count > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{count > 9 ? '9+' : count}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bell: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    right: -2,
    top: -2,
    backgroundColor: colors.danger,
    borderRadius: 9,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: colors.surface,
    fontSize: 10,
    fontWeight: '700',
  },
});

export default NotificationBell;