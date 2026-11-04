import { Alert } from 'react-native';

export function confirmDelete(plantName, onConfirm) {
  Alert.alert(
    'Eliminar planta',
    `¿Seguro que quieres eliminar "${plantName}"? Esta acción no se puede deshacer.`,
    [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Eliminar', style: 'destructive', onPress: onConfirm },
    ],
  );
}

export function confirmDeleteType(typeName, onConfirm) {
  Alert.alert(
    'Eliminar tipo de planta',
    `¿Seguro que quieres eliminar "${typeName}"? Esta acción no se puede deshacer.`,
    [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Eliminar', style: 'destructive', onPress: onConfirm },
    ],
  );
}