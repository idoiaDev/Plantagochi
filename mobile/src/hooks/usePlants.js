import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';

const POLL_INTERVAL_MS = 15 * 60 * 1000;

function signatureOf(data) {
  // last_state_time, no last_state_id: plant_state ahora tiene una fila por
  // planta, así que no hay un id que incremente. created_at sí avanza en cada
  // lectura, que es lo que mantiene viva la etiqueta "Última lectura".
  return [
    data.last_state_time,
    data.last_plant_id,
    data.last_plant_update,
  ].join('|');
}

export function usePlants() {
  const [plants, setPlants] = useState([]);
  const [types, setTypes] = useState([]);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const lastSigRef = useRef(null);

  const loadAll = useCallback(async () => {
    const [plantsData, typesData, lastUpdateData] = await Promise.all([
      api.listAll(),
      api.getTypes(),
      api.getLastUpdate(),
    ]);
    if (lastUpdateData) {
      lastSigRef.current = signatureOf(lastUpdateData);
    }
    setPlants(plantsData);
    setTypes(typesData);
    setLastUpdate(lastUpdateData ? lastUpdateData.last_state_time : null);
    setError(null);
    return true;
  }, []);

  const imagesVersionOf = useCallback(
    (typeId) => {
      const t = types.find((x) => x.id === typeId);
      return t && t.images_updated_at ? String(t.images_updated_at) : null;
    },
    [types],
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setRefreshing(false);
    }
  }, [loadAll]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        await loadAll();
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    const interval = setInterval(async () => {
      try {
        const data = await api.getLastUpdate();
        if (data && signatureOf(data) !== lastSigRef.current) {
          await loadAll();
        }
      } catch (_) {
        // silencio: reintentará en el siguiente ciclo
      }
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [loadAll]);

  const createPlant = useCallback(
    async (body) => {
      await api.createPlant(body);
      await loadAll();
    },
    [loadAll],
  );

  const createType = useCallback(
    async (body) => {
      const newType = await api.createType(body);
      await loadAll();
      return newType;
    },
    [loadAll],
  );

  const uploadTypeImages = useCallback(
    async (id, formData) => {
      const res = await api.uploadTypeImages(id, formData);
      await loadAll();
      return res;
    },
    [loadAll],
  );

  const deleteType = useCallback(
    async (id) => {
      await api.deleteType(id);
      await loadAll();
    },
    [loadAll],
  );

  const updatePlant = useCallback(
    async (id, body) => {
      await api.updatePlant(id, body);
      await loadAll();
    },
    [loadAll],
  );

  const updateThreshold = useCallback(
    async (id, minHumidity) => {
      await api.updateThreshold(id, minHumidity);
      await loadAll();
    },
    [loadAll],
  );

  const deletePlant = useCallback(
    async (id) => {
      await api.deletePlant(id);
      await loadAll();
    },
    [loadAll],
  );

  return {
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
    deleteType,
    uploadTypeImages,
  };
}