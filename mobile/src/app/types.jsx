import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { usePlants } from "../hooks/usePlants";
import TypeFormModal from "../components/TypeFormModal";
import { confirmDeleteType } from "../components/ConfirmDialog";
import { api } from "../api";
import { colors, spacing } from "../theme";

function TypesScreen() {
  const {
    types,
    loading,
    imagesVersionOf,
    refresh,
    createType,
    uploadTypeImages,
    deleteType,
  } = usePlants();
  const [modal, setModal] = useState(null);
  const [failed, setFailed] = useState({});

  const openCreate = () => setModal({ mode: "create" });
  const openEdit = (type) => setModal({ mode: "edit", type });

  const handleSaved = useCallback(async () => {
    await refresh();
    setModal(null);
  }, [refresh]);

  const handleDelete = (type) => {
    confirmDeleteType(type.name, async () => {
      try {
        await deleteType(type.id);
      } catch (err) {
        Alert.alert("No se pudo eliminar", err.message);
      }
    });
  };

  const renderItem = ({ item }) => {
    const version = imagesVersionOf(item.id);
    const src = api.frameImageUrl(item.id, "happy", 0, version);
    const showThumb = src && !failed[item.id];
    return (
      <View style={styles.card}>
        <View style={styles.thumb}>
          {showThumb && (
            <Image
              source={{ uri: src }}
              style={styles.thumbImg}
              resizeMode="cover"
              onError={() =>
                setFailed((prev) => ({ ...prev, [item.id]: true }))
              }
            />
          )}
        </View>
        <View style={styles.cardInfo}>
          <Text style={styles.cardName}>{item.name}</Text>
          <Text style={styles.cardMeta}>
            {item.images_updated_at ? "con imágenes" : "nuevo"}
          </Text>
          <View style={styles.cardActions}>
            <Pressable style={styles.editBtn} onPress={() => openEdit(item)}>
              <Text style={styles.editBtnText}>Editar imágenes</Text>
            </Pressable>
            <Pressable style={styles.deleteBtn} onPress={() => handleDelete(item)}>
              <Text style={styles.deleteBtnText}>Eliminar</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.safe}>
      {loading && types.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.centerText}>Cargando tipos…</Text>
        </View>
      ) : (
        <FlatList
          data={types}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            <Pressable style={styles.newBtn} onPress={openCreate}>
              <Ionicons name="add" size={18} color={colors.surface} />
              <Text style={styles.newBtnText}>Nuevo tipo</Text>
            </Pressable>
          }
        />
      )}

      {modal && (
        <TypeFormModal
          visible
          onClose={() => setModal(null)}
          type={modal.mode === "edit" ? modal.type : null}
          imagesVersion={
            modal.mode === "edit" ? imagesVersionOf(modal.type.id) : null
          }
          onCreateType={createType}
          onUploadTypeImages={uploadTypeImages}
          onSaved={handleSaved}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  listContent: {
    padding: spacing(3),
    paddingBottom: spacing(10),
    gap: spacing(3),
  },
  center: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing(20),
    gap: spacing(3),
  },
  centerText: {
    fontSize: 14,
    color: colors.textMuted,
  },
  newBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing(2),
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: spacing(3),
  },
  newBtnText: {
    color: colors.surface,
    fontSize: 15,
    fontWeight: "700",
  },
  card: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
  },
  thumb: {
    width: 88,
    height: 88,
    backgroundColor: colors.background,
    marginLeft: spacing(2),
    overflow: "hidden",
  },
  thumbImg: {
    width: 88,
    height: 88,
  },

  cardInfo: {
    flex: 1,
    padding: spacing(3),
    gap: 2,
  },
  cardName: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.text,
  },
  cardMeta: {
    fontSize: 12,
    color: colors.textMuted,
  },
  cardActions: {
    flexDirection: "row",
    gap: spacing(2),
    marginTop: spacing(1),
  },
  editBtn: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 8,
    paddingHorizontal: spacing(3),
    paddingVertical: spacing(1),
  },
  editBtnText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.primary,
  },
  deleteBtn: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: 8,
    paddingHorizontal: spacing(3),
    paddingVertical: spacing(1),
  },
  deleteBtnText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.danger,
  },
});

export default TypesScreen;
