import { useState, useEffect, useCallback } from "react";
import PlantCard from "./components/PlantCard";
import TypeFormModal from "./components/TypeFormModal";
import "./App.css";

const API_BASE = import.meta.env.VITE_API_URL;
const API_URL = `${API_BASE}${import.meta.env.VITE_API_ALL_PART}`;
const TYPES_URL = `${API_BASE}/types`;

function App() {
  const [plants, setPlants] = useState([]);
  const [types, setTypes] = useState([]);
  const [tab, setTab] = useState("plants");
  const [typeModal, setTypeModal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [typeError, setTypeError] = useState(null);

  const loadData = useCallback(async () => {
    const [plantsRes, typesRes] = await Promise.all([
      fetch(API_URL),
      fetch(TYPES_URL),
    ]);
    if (!plantsRes.ok) {
      throw new Error(`HTTP error! status: ${plantsRes.status}`);
    }
    if (!typesRes.ok) {
      throw new Error(`HTTP error! status: ${typesRes.status}`);
    }
    const [plantsData, typesData] = await Promise.all([
      plantsRes.json(),
      typesRes.json(),
    ]);
    setPlants(plantsData);
    setTypes(typesData);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        await loadData();
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [loadData]);

  const imagesVersionOf = (typeId) => {
    const t = types.find((x) => x.id === typeId);
    return t && t.images_updated_at ? String(t.images_updated_at) : null;
  };

  const createType = async (name) => {
    const res = await fetch(`${API_BASE}/types`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      throw new Error((await res.text()) || `HTTP ${res.status}`);
    }
    return res.json();
  };

  const uploadTypeImages = async (typeId, formData) => {
    const res = await fetch(`${API_BASE}/types/${typeId}/images`, {
      method: "POST",
      body: formData,
    });
    if (!res.ok) {
      throw new Error((await res.text()) || `HTTP ${res.status}`);
    }
    return res.json();
  };

  const deleteType = async (typeId) => {
    const res = await fetch(`${API_BASE}/types/${typeId}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        if (body && body.detail) detail = body.detail;
      } catch {
        // keep fallback message
      }
      throw new Error(detail);
    }
    return res.json();
  };

  const handleDeleteType = async (type) => {
    if (
      !window.confirm(
        `¿Seguro que quieres eliminar el tipo "${type.name}"? Esta acción no se puede deshacer.`,
      )
    ) {
      return;
    }
    try {
      setTypeError(null);
      await deleteType(type.id);
      await loadData();
    } catch (err) {
      setTypeError(err.message);
    }
  };

  const handleTypeSaved = async () => {
    try {
      setLoading(true);
      await loadData();
      setTypeModal(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app">
      <header className="header">
        <h1>Plantagochi</h1>
        <nav className="tabs">
          <button
            className={`tab ${tab === "plants" ? "tab-active" : ""}`}
            onClick={() => setTab("plants")}
          >
            Plantas
          </button>
          <button
            className={`tab ${tab === "types" ? "tab-active" : ""}`}
            onClick={() => setTab("types")}
          >
            Tipos de planta
          </button>
        </nav>
      </header>

      {loading && (
        <div className="loading">
          <div className="spinner"></div>
          <p>Loading…</p>
        </div>
      )}

      {error && (
        <div className="error">
          <p>Failed to load: {error}</p>
        </div>
      )}

      {!loading && !error && tab === "plants" && (
        <div className="plant-grid">
          {plants.map((plant) => (
            <PlantCard
              key={plant.id}
              name={plant.name}
              image={plant.image}
              imagesVersion={imagesVersionOf(plant.type_id)}
              status={plant.status}
              humidity={plant.humidity}
              minHumidity={plant.min_humidity}
              needsWater={plant.needs_water}
              type={plant.type}
            />
          ))}
        </div>
      )}

      {!loading && !error && tab === "types" && (
        <div className="types-view">
          <div className="types-toolbar">
            <h2>Tipos de planta</h2>
            <button
              className="primary-btn"
              onClick={() => setTypeModal({ mode: "create" })}
            >
              + Nuevo tipo
            </button>
          </div>
          {typeError && <div className="types-error">{typeError}</div>}
          <div className="type-grid">
            {types.map((t) => {
              const versionQs = t.images_updated_at
                ? `?v=${encodeURIComponent(String(t.images_updated_at))}`
                : "";
              return (
                <div className="type-card" key={t.id}>
                  <img
                    className="type-thumb"
                    src={`${API_BASE}/types/${t.id}/images/happy/png${versionQs}`}
                    alt={t.name}
                    onError={(e) => {
                      e.target.style.display = "none";
                    }}
                  />
                  <div className="type-card-info">
                    <span className="type-card-name">{t.name}</span>
                    <span className="type-card-meta">
                      {t.images_updated_at ? "con imágenes" : "nuevo"}
                    </span>
                    <div className="type-card-actions">
                      <button
                        className="type-edit-btn"
                        onClick={() => setTypeModal({ mode: "edit", type: t })}
                      >
                        Editar imágenes
                      </button>
                      <button
                        className="type-delete-btn"
                        onClick={() => handleDeleteType(t)}
                      >
                        Eliminar
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {typeModal && (
        <TypeFormModal
          key={typeModal.mode === "edit" ? typeModal.type.id : "create"}
          open
          onClose={() => setTypeModal(null)}
          type={typeModal.mode === "edit" ? typeModal.type : null}
          imagesVersion={
            typeModal.mode === "edit" ? typeModal.type.images_updated_at : null
          }
          onCreate={createType}
          onUpload={uploadTypeImages}
          onSaved={handleTypeSaved}
        />
      )}
    </div>
  );
}

export default App;
