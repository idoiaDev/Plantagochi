import { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { File } from 'expo-file-system';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { api } from '../api';
import { colors, spacing } from '../theme';

const STATES = [
  { key: 'superhappy', label: 'Muy feliz' },
  { key: 'happy', label: 'Feliz' },
  { key: 'sad', label: 'Triste' },
  { key: 'supersad', label: 'Muy triste' },
];

const FRAME_LABELS = ['Base', 'Animación 1', 'Animación 2'];
const FRAME_SUFFIX = ['', '_change1', '_change2'];

function TypeFormModal({ visible, onClose, type, imagesVersion, onCreateType, onUploadTypeImages, onSaved }) {
  const [name, setName] = useState(type ? type.name : '');
  const [picked, setPicked] = useState({});
  const [failed, setFailed] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const editMode = Boolean(type);

  const slotKey = (stateKey, frameIdx) => `${stateKey}${FRAME_SUFFIX[frameIdx]}`;

  const handleShow = () => {
    setName(type ? type.name : '');
    setPicked({});
    setFailed({});
    setError(null);
    setBusy(false);
  };

  const pick = async (key) => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.9,
    });
    if (!result.canceled && result.assets.length > 0) {
      setFailed((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      setPicked((prev) => ({ ...prev, [key]: result.assets[0] }));
    }
  };

  const clearPicked = (key) => {
    setPicked((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const storedSrc = (stateKey, frameIdx) => {
    if (!editMode) return null;
    return api.frameImageUrl(type.id, stateKey, frameIdx, imagesVersion);
  };

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Indica un nombre para el tipo.');
      return;
    }
    const assets = Object.values(picked);
    try {
      setBusy(true);
      setError(null);

      let id = type ? type.id : null;
      if (!id && assets.length === 0) {
        await onCreateType({ name: trimmed });
        onSaved();
        return;
      }
      if (!id) {
        const created = await onCreateType({ name: trimmed });
        id = created.id;
      }

      const fd = new FormData();
      fd.append('name', trimmed);
      for (const key of Object.keys(picked)) {
        const asset = picked[key];
        if (Platform.OS === 'web' && asset.file) {
          fd.append(key, asset.file);
        } else {
          fd.append(key, new File(asset.uri));
        }
      }
      await onUploadTypeImages(id, fd);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
      onShow={handleShow}
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.title}>
              {editMode ? `Editar: ${type.name}` : 'Nuevo tipo'}
            </Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={22} color={colors.textMuted} />
            </Pressable>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" keyboardShouldDismissOnTap="handled">
            <Text style={styles.label}>Nombre</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="Ej: Monstera"
              placeholderTextColor={colors.textMuted}
            />

            <Text style={styles.hint}>
              Las imágenes se recortan a 240×240 automáticamente. Sin foto de
              animación, ese frame queda vacío (NULL).
            </Text>

            {STATES.map((state) => (
              <View key={state.key} style={styles.stateBox}>
                <Text style={styles.stateTitle}>{state.label}</Text>
                <View style={styles.slotsRow}>
                  {[0, 1, 2].map((frameIdx) => {
                    const key = slotKey(state.key, frameIdx);
                    const asset = picked[key];
                    const src = asset ? asset.uri : storedSrc(state.key, frameIdx);
                    const visibleImg = src && !failed[key];
                    return (
                      <View key={key} style={styles.slot}>
                        <View style={styles.preview}>
                          <Text style={styles.previewPh}>—</Text>
                          {visibleImg && (
                            <Image
                              source={{ uri: src }}
                              style={styles.previewImg}
                              resizeMode="cover"
                              onError={() =>
                                setFailed((prev) => ({ ...prev, [key]: true }))
                              }
                            />
                          )}
                        </View>
                        <Text style={styles.slotLabel}>{FRAME_LABELS[frameIdx]}</Text>
                        <Pressable style={styles.pickBtn} onPress={() => pick(key)}>
                          <Text style={styles.pickBtnText}>
                            {asset ? 'Sustituir' : 'Seleccionar'}
                          </Text>
                        </Pressable>
                        {asset && (
                          <Pressable style={styles.clearBtn} onPress={() => clearPicked(key)}>
                            <Text style={styles.clearBtnText}>Quitar</Text>
                          </Pressable>
                        )}
                      </View>
                    );
                  })}
                </View>
              </View>
            ))}

            {error && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <View style={styles.actions}>
              <Pressable style={styles.saveBtn} onPress={handleSave} disabled={busy}>
                {busy ? (
                  <ActivityIndicator color={colors.surface} />
                ) : (
                  <Text style={styles.saveBtnText}>{editMode ? 'Guardar' : 'Crear'}</Text>
                )}
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  card: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: spacing(4),
    paddingTop: spacing(3),
    paddingBottom: spacing(5),
    maxHeight: '92%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing(2),
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
    marginTop: spacing(2),
    marginBottom: spacing(1),
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
  hint: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: spacing(2),
    marginBottom: spacing(1),
  },
  stateBox: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: spacing(2),
    marginTop: spacing(3),
  },
  stateTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.primaryDark,
    marginBottom: spacing(2),
  },
  slotsRow: {
    flexDirection: 'row',
    gap: spacing(2),
  },
  slot: {
    flex: 1,
    gap: 4,
  },
  preview: {
    aspectRatio: 1,
    borderRadius: 10,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  previewImg: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: undefined,
    height: undefined,
  },
  previewPh: {
    color: colors.textMuted,
    fontSize: 20,
  },
  slotLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
  },
  pickBtn: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 6,
    alignItems: 'center',
    backgroundColor: colors.primaryLight,
  },
  pickBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.primary,
  },
  clearBtn: {
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: 8,
    paddingVertical: 4,
    alignItems: 'center',
  },
  clearBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.danger,
  },
  errorBox: {
    backgroundColor: colors.dangerLight,
    borderRadius: 10,
    padding: spacing(3),
    marginTop: spacing(3),
  },
  errorText: {
    color: colors.danger,
    fontSize: 13,
  },
  actions: {
    flexDirection: 'row',
    marginTop: spacing(4),
  },
  saveBtn: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: spacing(3),
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: {
    color: colors.surface,
    fontWeight: '700',
  },
});

export default TypeFormModal;