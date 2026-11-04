import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { api } from '../api';
import { colors, radius, spacing, STATUS_LABELS } from '../theme';

const THRESHOLD_STEP = 5;

function PlantCard({ plant, imagesVersion, onPress, onChangeThreshold }) {
  const [imageFailed, setImageFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const status = plant.status || 'unknown';
  const imageUrl = plant.type_id
    ? api.imageUrl(plant.type_id, status, imagesVersion)
    : null;
  const showImage = imageUrl && !imageFailed;

  const humidityLabel = plant.humidity != null ? `${Math.round(plant.humidity)}%` : 'Sin datos';
  const thresholdLabel =
    plant.min_humidity != null ? `${Math.round(plant.min_humidity)}%` : '-';

  const changeThreshold = async (delta) => {
    if (busy || plant.min_humidity == null) return;
    setBusy(true);
    try {
      const next = Math.min(100, Math.max(0, plant.min_humidity + delta));
      await onChangeThreshold(plant.id, next);
    } catch (e) {
      console.warn(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        plant.needs_water && styles.cardNeedsWater,
        pressed && styles.cardPressed,
      ]}
    >
      <View style={styles.imageWrap}>
        {showImage ? (
          <Image
            source={{ uri: imageUrl }}
            style={styles.image}
            resizeMode="cover"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <View style={styles.imageFallback}>
            <Text style={styles.imageFallbackText}>🪴</Text>
          </View>
        )}
        {plant.needs_water && (
          <View style={styles.waterDot}>
            <Text style={styles.waterDotText}>💧</Text>
          </View>
        )}
      </View>

      <View style={styles.info}>
        <View style={styles.titleRow}>
          <Text style={styles.name} numberOfLines={1}>
            {plant.name}
          </Text>
          <View style={[styles.statusChip, { backgroundColor: statusBadgeBg(status) }]}>
            <Text style={styles.statusChipText}>{STATUS_LABELS[status]}</Text>
          </View>
        </View>

        <Text style={styles.type} numberOfLines={1}>
          {plant.type || 'Sin tipo'}
        </Text>

        <View style={styles.humidityRow}>
          <Text style={styles.humidity}>{humidityLabel}</Text>
          <Text style={styles.muted}>umbral {thresholdLabel}</Text>
        </View>

        <View style={styles.thresholdRow}>
          <Text style={styles.muted}>Ajustar umbral:</Text>
          <Pressable
            onPress={() => changeThreshold(-THRESHOLD_STEP)}
            disabled={busy}
            style={({ pressed }) => [styles.stepBtn, pressed && styles.stepBtnPressed]}
          >
            <Text style={styles.stepBtnText}>−</Text>
          </Pressable>
          <Pressable
            onPress={() => changeThreshold(THRESHOLD_STEP)}
            disabled={busy}
            style={({ pressed }) => [styles.stepBtn, pressed && styles.stepBtnPressed]}
          >
            <Text style={styles.stepBtnText}>+</Text>
          </Pressable>
        </View>
      </View>
    </Pressable>
  );
}

function statusBadgeBg(status) {
  switch (status) {
    case 'superhappy':
      return colors.superhappy;
    case 'happy':
      return colors.happy;
    case 'sad':
      return colors.sad;
    case 'supersad':
      return colors.supersad;
    default:
      return colors.unknown;
  }
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing(3),
    marginHorizontal: spacing(3),
    marginVertical: spacing(1),
    position: 'relative',
    alignSelf: 'stretch',
    minHeight: 128,
  },
  cardNeedsWater: {
    borderColor: colors.danger,
  },
  cardPressed: {
    opacity: 0.85,
  },
  imageWrap: {
    width: 96,
    height: 96,
    marginRight: spacing(3),
    borderRadius: radius,
    backgroundColor: colors.primaryLight,
    alignSelf: 'center',
    position: 'relative',
  },
  image: {
    width: '100%',
    height: '100%',
    borderRadius: radius,
    backgroundColor: colors.primaryLight,
  },
  imageFallback: {
    width: '100%',
    height: '100%',
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageFallbackText: {
    fontSize: 28,
  },
  waterDot: {
    position: 'absolute',
    right: spacing(1),
    top: spacing(1),
    backgroundColor: colors.danger,
    borderRadius: 12,
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  waterDotText: {
    fontSize: 11,
  },
  info: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  name: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    flexShrink: 1,
    marginRight: spacing(2),
  },
  statusChip: {
    paddingHorizontal: spacing(2),
    paddingVertical: 2,
    borderRadius: 20,
  },
  statusChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.surface,
  },
  type: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  humidityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing(2),
  },
  humidity: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  muted: {
    fontSize: 12,
    color: colors.textMuted,
  },
  thresholdRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing(1),
    gap: spacing(2),
  },
  stepBtn: {
    backgroundColor: colors.primaryLight,
    borderRadius: 8,
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnPressed: {
    opacity: 0.6,
  },
  stepBtnText: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.primary,
    lineHeight: 22,
  },
});

export default PlantCard;