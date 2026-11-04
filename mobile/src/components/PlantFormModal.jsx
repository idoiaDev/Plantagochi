import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing } from '../theme';
import { confirmDelete } from './ConfirmDialog';

function PlantFormModal({ visible, onClose, plant, types, onSubmit, onCreateType, onDelete }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [selectedTypeId, setSelectedTypeId] = useState(null);
  const [newTypeMode, setNewTypeMode] = useState(false);
  const [newTypeName, setNewTypeName] = useState('');
  const [minHumidity, setMinHumidity] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const handleShow = () => {
    setName(plant ? plant.name : '');
    setDescription(plant && plant.description ? plant.description : '');
    setDeviceId(plant ? plant.device_id : '');
    setSelectedTypeId(plant ? plant.type_id : null);
    setNewTypeMode(false);
    setNewTypeName('');
    setMinHumidity(plant && plant.min_humidity != null ? String(plant.min_humidity) : '30');
    setError(null);
    setSubmitting(false);
  };

  const handleCreateType = async () => {
    const typeName = newTypeName.trim();
    if (!typeName) {
      setError('Indica un nombre para el nuevo tipo.');
      return;
    }
    try {
      setSubmitting(true);
      const created = await onCreateType(typeName);
      setSelectedTypeId(created.id);
      setNewTypeMode(false);
      setNewTypeName('');
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const validate = () => {
    if (!name.trim()) return 'El nombre es obligatorio.';
    if (!deviceId.trim()) return 'El device_id es obligatorio y único.';
    if (newTypeMode) return 'Crea el nuevo tipo antes de guardar.';
    if (selectedTypeId == null) return 'Selecciona un tipo de planta.';
    const hum = parseFloat(minHumidity);
    if (minHumidity.trim() === '' || Number.isNaN(hum)) return 'Indica un umbral de humedad.';
    if (hum < 0 || hum > 100) return 'El umbral debe estar entre 0 y 100.';
    return null;
  };

  const handleSubmit = async () => {
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      device_id: deviceId.trim(),
      type_id: selectedTypeId,
      min_humidity: parseFloat(minHumidity),
    };
    try {
      setSubmitting(true);
      setError(null);
      await onSubmit(payload);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = () => {
    confirmDelete(plant.name, async () => {
      try {
        setSubmitting(true);
        await onDelete(plant.id);
        onClose();
      } catch (err) {
        setError(err.message);
        setSubmitting(false);
      }
    });
  };

  const editMode = Boolean(plant);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
      onShow={handleShow}
    >
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.title}>{editMode ? 'Editar planta' : 'Nueva planta'}</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={22} color={colors.textMuted} />
            </Pressable>
          </View>

          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 40 }}
          >
            <Text style={styles.label}>Nombre</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="Ej: Monstera"
              placeholderTextColor={colors.textMuted}
            />

            <Text style={styles.label}>Descripción</Text>
            <TextInput
              style={[styles.input, styles.inputMultiline]}
              value={description}
              onChangeText={setDescription}
              placeholder="Ej: Planta de interior con hojas grandes, necesita poca luz"
              placeholderTextColor={colors.textMuted}
              multiline
              numberOfLines={4}
            />
            <Text style={styles.hint}>
              Se usa para encontrar la planta por búsqueda semántica.
            </Text>

            <Text style={styles.label}>device_id (único)</Text>
            <TextInput
              style={styles.input}
              value={deviceId}
              onChangeText={setDeviceId}
              placeholder="Ej: esp32-salon-01"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Text style={styles.label}>Tipo de planta</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.typeRow}>
              {types.map((type) => (
                <Pressable
                  key={type.id}
                  onPress={() => {
                    setSelectedTypeId(type.id);
                    setNewTypeMode(false);
                  }}
                  style={[styles.typeChip, selectedTypeId === type.id && styles.typeChipActive]}
                >
                  <Text
                    style={[
                      styles.typeChipText,
                      selectedTypeId === type.id && styles.typeChipTextActive,
                    ]}
                  >
                    {type.name}
                  </Text>
                </Pressable>
              ))}
              <Pressable
                onPress={() => {
                  setSelectedTypeId(null);
                  setNewTypeMode(true);
                }}
                style={[styles.typeChip, newTypeMode && styles.typeChipActive]}
              >
                <Text style={[styles.typeChipText, newTypeMode && styles.typeChipTextActive]}>
                  + Nuevo…
                </Text>
              </Pressable>
            </ScrollView>

            {newTypeMode && (
              <View style={styles.newTypeRow}>
                <TextInput
                  style={[styles.input, styles.newTypeInput]}
                  value={newTypeName}
                  onChangeText={setNewTypeName}
                  placeholder="Nombre del tipo nuevo"
                  placeholderTextColor={colors.textMuted}
                />
                <Pressable style={styles.createTypeBtn} onPress={handleCreateType} disabled={submitting}>
                  <Text style={styles.createTypeBtnText}>Crear</Text>
                </Pressable>
              </View>
            )}

            <Text style={styles.label}>Umbral de riego (%)</Text>
            <TextInput
              style={styles.input}
              value={minHumidity}
              onChangeText={(value) => setMinHumidity(value.replace(/[^0-9.]/g, ''))}
              placeholder="30"
              placeholderTextColor={colors.textMuted}
              keyboardType="numeric"
            />
            <Text style={styles.hint}>
              Si la humedad baja del umbral, la planta se marca como «necesita agua».
            </Text>

            {error && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <View style={styles.actions}>
              {editMode && (
                <Pressable style={styles.deleteBtn} onPress={handleDelete} disabled={submitting}>
                  <Text style={styles.deleteBtnText}>Eliminar</Text>
                </Pressable>
              )}
              <Pressable style={styles.saveBtn} onPress={handleSubmit} disabled={submitting}>
                {submitting ? (
                  <ActivityIndicator color={colors.surface} />
                ) : (
                  <Text style={styles.saveBtnText}>{editMode ? 'Guardar' : 'Crear'}</Text>
                )}
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
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
  inputMultiline: {
    minHeight: 88,
    textAlignVertical: 'top',
  },
  typeRow: {
    gap: spacing(1),
    paddingRight: spacing(2),
  },
  typeChip: {
    paddingHorizontal: spacing(3),
    paddingVertical: spacing(2),
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  typeChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  typeChipText: {
    fontSize: 13,
    color: colors.text,
  },
  typeChipTextActive: {
    color: colors.surface,
    fontWeight: '600',
  },
  newTypeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(2),
    marginTop: spacing(2),
  },
  newTypeInput: {
    flex: 1,
  },
  createTypeBtn: {
    backgroundColor: colors.primaryLight,
    borderRadius: 10,
    paddingHorizontal: spacing(3),
    paddingVertical: spacing(2),
  },
  createTypeBtnText: {
    color: colors.primary,
    fontWeight: '600',
  },
  hint: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: spacing(1),
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
    gap: spacing(2),
    marginTop: spacing(4),
  },
  deleteBtn: {
    flex: 1,
    backgroundColor: colors.dangerLight,
    borderRadius: 12,
    paddingVertical: spacing(3),
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteBtnText: {
    color: colors.danger,
    fontWeight: '700',
  },
  saveBtn: {
    flex: 2,
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

export default PlantFormModal;