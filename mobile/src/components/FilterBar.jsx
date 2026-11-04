import { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing } from '../theme';

const SORT_OPTIONS = [
  { key: 'humidity_asc', label: '↑ Humedad' },
  { key: 'humidity_desc', label: '↓ Humedad' },
  { key: 'name', label: 'A-Z' },
];

function FilterBar({ filters, types, onChange }) {
  const [open, setOpen] = useState(false);

  const activeCount = [
    filters.query.trim(),
    filters.typeId != null,
    filters.humMin.trim(),
    filters.humMax.trim(),
    filters.needWater,
  ].filter(Boolean).length;

  const update = (patch) => onChange({ ...filters, ...patch });

  const setType = (id) => update({ typeId: id });

  return (
    <View style={styles.container}>
      <Pressable style={styles.header} onPress={() => setOpen((o) => !o)}>
        <Ionicons name="funnel-outline" size={16} color={colors.primary} />
        <Text style={styles.headerText}>Filtros</Text>
        {activeCount > 0 && (
          <View style={styles.countBadge}>
            <Text style={styles.countText}>{activeCount}</Text>
          </View>
        )}
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={16}
          color={colors.textMuted}
        />
      </Pressable>

      {open && (
        <View style={styles.body}>
          <TextInput
            style={styles.input}
            placeholder="Buscar por nombre…"
            placeholderTextColor={colors.textMuted}
            value={filters.query}
            onChangeText={(value) => update({ query: value })}
            autoCapitalize="none"
          />

          <Text style={styles.label}>Tipo de planta</Text>
          <View style={styles.chips}>
            <Chip label="Todos" active={filters.typeId == null} onPress={() => setType(null)} />
            {types.map((type) => (
              <Chip
                key={type.id}
                label={type.name}
                active={filters.typeId === type.id}
                onPress={() => setType(type.id)}
              />
            ))}
          </View>

          <Text style={styles.label}>Humedad (%)</Text>
          <View style={styles.rangeRow}>
            <TextInput
              style={[styles.input, styles.rangeInput]}
              placeholder="Mín"
              placeholderTextColor={colors.textMuted}
              keyboardType="numeric"
              value={filters.humMin}
              onChangeText={(value) => update({ humMin: value.replace(/[^0-9.]/g, '') })}
            />
            <Text style={styles.muted}>a</Text>
            <TextInput
              style={[styles.input, styles.rangeInput]}
              placeholder="Máx"
              placeholderTextColor={colors.textMuted}
              keyboardType="numeric"
              value={filters.humMax}
              onChangeText={(value) => update({ humMax: value.replace(/[^0-9.]/g, '') })}
            />
          </View>

          <View style={styles.switchRow}>
            <Text style={styles.label}>Solo necesitan agua</Text>
            <Switch
              value={filters.needWater}
              onValueChange={(value) => update({ needWater: value })}
              trackColor={{ true: colors.primary }}
            />
          </View>

          <Text style={styles.label}>Ordenar</Text>
          <View style={styles.chips}>
            {SORT_OPTIONS.map((opt) => (
              <Chip
                key={opt.key}
                label={opt.label}
                active={filters.sort === opt.key}
                onPress={() => update({ sort: opt.key })}
              />
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

function Chip({ label, active, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, active && styles.chipActive]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    marginHorizontal: spacing(3),
    marginVertical: spacing(1),
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(2),
    padding: spacing(3),
  },
  headerText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    flex: 1,
  },
  countBadge: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  countText: {
    color: colors.surface,
    fontSize: 11,
    fontWeight: '700',
  },
  body: {
    paddingHorizontal: spacing(3),
    paddingBottom: spacing(3),
    gap: spacing(1),
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: spacing(3),
    paddingVertical: spacing(2),
    fontSize: 14,
    color: colors.text,
    backgroundColor: colors.background,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
    marginTop: spacing(2),
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing(1),
    marginTop: spacing(1),
  },
  chip: {
    paddingHorizontal: spacing(3),
    paddingVertical: spacing(1),
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipText: {
    fontSize: 13,
    color: colors.text,
  },
  chipTextActive: {
    color: colors.surface,
    fontWeight: '600',
  },
  rangeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(2),
    marginTop: spacing(1),
  },
  rangeInput: {
    flex: 1,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing(1),
  },
  muted: {
    fontSize: 12,
    color: colors.textMuted,
  },
});

export default FilterBar;