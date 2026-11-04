import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { usePlants } from '../hooks/usePlants';
import NotificationBell, { useNotifications } from '../components/NotificationBell';
import FilterBar from '../components/FilterBar';
import PlantCard from '../components/PlantCard';
import PlantFormModal from '../components/PlantFormModal';
import { colors, spacing } from '../theme';

const DEFAULT_FILTERS = {
  query: '',
  typeId: null,
  humMin: '',
  humMax: '',
  needWater: false,
  sort: 'humidity_asc',
};

function HomeScreen() {
  const {
    plants,
    types,
    lastUpdate,
    loading,
    refreshing,
    error,
    refresh,
    imagesVersionOf,
    createPlant,
    createType,
    updatePlant,
    updateThreshold,
    deletePlant,
  } = usePlants();

  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingPlant, setEditingPlant] = useState(null);
  const [showBanner, setShowBanner] = useState(true);

  const needyPlants = useMemo(() => plants.filter((p) => p.needs_water), [plants]);
  const { pending, dismiss } = useNotifications(needyPlants);

  const visiblePlants = useMemo(() => {
    const list = plants.filter((plant) => {
      const query = filters.query.trim().toLowerCase();
      if (query && !plant.name.toLowerCase().includes(query)) return false;
      if (filters.typeId != null && plant.type_id !== filters.typeId) return false;
      const min = parseFloat(filters.humMin);
      if (!Number.isNaN(min) && (plant.humidity == null || plant.humidity < min)) return false;
      const max = parseFloat(filters.humMax);
      if (!Number.isNaN(max) && (plant.humidity == null || plant.humidity > max)) return false;
      if (filters.needWater && !plant.needs_water) return false;
      return true;
    });

    list.sort((a, b) => {
      if (filters.sort === 'name') return a.name.localeCompare(b.name);
      if (filters.sort === 'humidity_desc') {
        return (b.humidity ?? -Infinity) - (a.humidity ?? -Infinity);
      }
      return (a.humidity ?? Infinity) - (b.humidity ?? Infinity);
    });
    return list;
  }, [plants, filters]);

  const lastUpdatedLabel = lastUpdate
    ? `Última lectura: ${new Date(lastUpdate).toLocaleString()}`
    : 'Sin mediciones todavía';

  const openCreate = () => {
    setEditingPlant(null);
    setModalVisible(true);
  };

  const openEdit = (plant) => {
    setEditingPlant(plant);
    setModalVisible(true);
  };

  const handleSubmit = async (payload) => {
    if (editingPlant) {
      await updatePlant(editingPlant.id, payload);
    } else {
      await createPlant(payload);
    }
  };

  const handleCreateType = (typeName) => createType({ name: typeName });

  const handleChangeThreshold = async (id, value) => {
    await updateThreshold(id, value);
  };

  const handleDelete = async (id) => {
    await deletePlant(id);
  };

  const renderCard = ({ item }) => (
    <PlantCard
      plant={item}
      imagesVersion={imagesVersionOf(item.type_id)}
      onPress={() => openEdit(item)}
      onChangeThreshold={handleChangeThreshold}
    />
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <StatusBar style="dark" />

      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>Plantagochi</Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {lastUpdatedLabel}
          </Text>
        </View>
        <View style={styles.headerActions}>
          <NotificationBell pending={pending} onPress={() => setShowBanner((s) => !s)} />
          <Pressable onPress={() => router.push('/types')} style={styles.iconBtn} hitSlop={8}>
            <Ionicons name="grid" size={20} color={colors.text} />
          </Pressable>
          <Pressable
            onPress={refresh}
            disabled={refreshing}
            style={styles.iconBtn}
            hitSlop={8}
          >
            <Ionicons
              name="refresh"
              size={22}
              color={refreshing ? colors.textMuted : colors.text}
            />
          </Pressable>
        </View>
      </View>

      {showBanner && pending.length > 0 && (
        <View style={styles.banner}>
          {pending.map((plant) => (
            <View key={plant.id} style={styles.bannerRow}>
              <Ionicons name="water" size={14} color={colors.danger} />
              <Text style={styles.bannerText} numberOfLines={1}>
                {plant.name}
              </Text>
              <Pressable onPress={() => dismiss(plant.id)} hitSlop={8}>
                <Ionicons name="close" size={16} color={colors.danger} />
              </Pressable>
            </View>
          ))}
        </View>
      )}

      {error && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <FilterBar filters={filters} types={types} onChange={setFilters} />

      {loading && plants.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.centerText}>Cargando plantas…</Text>
        </View>
      ) : (
        <FlatList
          data={visiblePlants}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderCard}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.centerText}>No hay plantas que cumplan los filtros.</Text>
            </View>
          }
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />
          }
        />
      )}

      <Pressable style={styles.fab} onPress={openCreate} accessibilityLabel="Nueva planta">
        <Ionicons name="add" size={28} color={colors.surface} />
      </Pressable>

      <PlantFormModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        plant={editingPlant}
        types={types}
        onSubmit={handleSubmit}
        onCreateType={handleCreateType}
        onDelete={handleDelete}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing(3),
    paddingVertical: spacing(3),
  },
  headerText: {
    flexShrink: 1,
    marginRight: spacing(2),
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.text,
  },
  subtitle: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(2),
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  banner: {
    marginHorizontal: spacing(3),
    marginBottom: spacing(1),
    backgroundColor: colors.dangerLight,
    borderRadius: 12,
    padding: spacing(2),
  },
  bannerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(2),
    paddingVertical: 2,
  },
  bannerText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: colors.danger,
  },
  errorBox: {
    marginHorizontal: spacing(3),
    marginBottom: spacing(1),
    backgroundColor: colors.warningLight,
    borderRadius: 12,
    padding: spacing(2),
  },
  errorText: {
    fontSize: 13,
    color: colors.warning,
  },
  listContent: {
    paddingTop: spacing(1),
    paddingBottom: spacing(16),
    flexGrow: 0,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing(20),
    gap: spacing(3),
  },
  centerText: {
    fontSize: 14,
    color: colors.textMuted,
  },
  fab: {
    position: 'absolute',
    right: spacing(4),
    bottom: spacing(6),
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: colors.primaryDark,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
  },
});

export default HomeScreen;