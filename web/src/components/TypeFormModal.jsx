import { useEffect, useRef, useState } from 'react';
import './TypeFormModal.css';

const API_BASE = import.meta.env.VITE_API_URL;

const STATES = [
  { key: 'superhappy', label: 'Muy feliz' },
  { key: 'happy', label: 'Feliz' },
  { key: 'sad', label: 'Triste' },
  { key: 'supersad', label: 'Muy triste' },
];

const FRAME_LABELS = ['Base', 'Animación 1', 'Animación 2'];
const FRAME_SUFFIX = ['', '_change1', '_change2'];

function TypeFormModal({ open, onClose, type, imagesVersion, onCreate, onUpload, onSaved }) {
  const [name, setName] = useState(type ? type.name : '');
  const [picked, setPicked] = useState({});
  const [failed, setFailed] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const inputRefs = useRef({});
  const urlRef = useRef({});

  const editMode = Boolean(type);

  useEffect(
    () => () => {
      Object.values(urlRef.current).forEach((url) => URL.revokeObjectURL(url));
    },
    [],
  );

  const revokeUrl = (key) => {
    const url = urlRef.current[key];
    if (url) {
      URL.revokeObjectURL(url);
      delete urlRef.current[key];
    }
  };

  const slotKey = (stateKey, frameIdx) => `${stateKey}${FRAME_SUFFIX[frameIdx]}`;

  const pickFile = (key) => (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    revokeUrl(key);
    const url = URL.createObjectURL(file);
    urlRef.current[key] = url;
    setFailed((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setPicked((prev) => ({ ...prev, [key]: { file, url } }));
  };

  const clearPicked = (key) => {
    revokeUrl(key);
    setPicked((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setFailed((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    if (inputRefs.current[key]) inputRefs.current[key].value = '';
  };

  const storedSrc = (stateKey, frameIdx) => {
    if (!editMode) return null;
    const versionQs = imagesVersion ? `&v=${encodeURIComponent(String(imagesVersion))}` : '';
    return `${API_BASE}/types/${type.id}/images/${stateKey}/png?frame=${frameIdx}${versionQs}`;
  };

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Indica un nombre para el tipo.');
      return;
    }
    const files = Object.values(picked);
    try {
      setBusy(true);
      setError(null);

      let id = type ? type.id : null;
      if (!id && files.length === 0) {
        await onCreate(trimmed);
        onSaved();
        return;
      }
      if (!id) {
        const created = await onCreate(trimmed);
        id = created.id;
      }

      const fd = new FormData();
      fd.append('name', trimmed);
      for (const [key, item] of Object.entries(picked)) {
        fd.append(key, item.file, item.file.name);
      }
      await onUpload(id, fd);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div className="tm-overlay" onClick={onClose}>
      <div className="tm-card" onClick={(e) => e.stopPropagation()}>
        <div className="tm-header">
          <h2 className="tm-title">{editMode ? `Editar tipo: ${type.name}` : 'Nuevo tipo de planta'}</h2>
          <button className="tm-close" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </div>

        <div className="tm-body">
          <label className="tm-label" htmlFor="type-name">
            Nombre
          </label>
          <input
            id="type-name"
            className="tm-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ej: Monstera"
          />

          <p className="tm-hint">
            Las imágenes se recortan a 240×240 automáticamente. Si no eliges «Animación»,
            ese frame queda sin imagen (NULL).
          </p>

          {STATES.map((state) => (
            <fieldset className="tm-state" key={state.key}>
              <legend className="tm-state-title">{state.label}</legend>
              <div className="tm-slots">
                {[0, 1, 2].map((frameIdx) => {
                  const key = slotKey(state.key, frameIdx);
                  const pickedItem = picked[key];
                  const src = pickedItem ? pickedItem.url : storedSrc(state.key, frameIdx);
                  const showSrc = src && !failed[key];
                  return (
                    <div className="tm-slot" key={key}>
                      <div className="tm-slot-preview">
                        {showSrc && (
                          <img
                            className="tm-slot-img"
                            src={src}
                            alt={`${state.label} · ${FRAME_LABELS[frameIdx]}`}
                            onError={() =>
                              setFailed((prev) => ({ ...prev, [key]: true }))
                            }
                          />
                        )}
                        <span className="tm-slot-ph">—</span>
                      </div>
                      <span className="tm-slot-label">{FRAME_LABELS[frameIdx]}</span>
                      <input
                        ref={(el) => {
                          inputRefs.current[key] = el;
                        }}
                        type="file"
                        accept="image/*"
                        className="tm-file-input"
                        onChange={pickFile(key)}
                      />
                      <div className="tm-slot-actions">
                        <button
                          type="button"
                          className="tm-slot-btn"
                          onClick={() => inputRefs.current[key] && inputRefs.current[key].click()}
                        >
                          {pickedItem ? 'Sustituir' : 'Seleccionar'}
                        </button>
                        {pickedItem && (
                          <button type="button" className="tm-slot-clear" onClick={() => clearPicked(key)}>
                            Quitar
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </fieldset>
          ))}

          {error && <div className="tm-error">{error}</div>}
        </div>

        <div className="tm-footer">
          <button className="tm-cancel" onClick={onClose}>
            Cancelar
          </button>
          <button className="tm-save" onClick={handleSave} disabled={busy}>
            {busy ? 'Guardando…' : editMode ? 'Guardar' : 'Crear'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default TypeFormModal;