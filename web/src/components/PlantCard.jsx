import './PlantCard.css';

const API_BASE = import.meta.env.VITE_API_URL;

const STATUS_LABELS = {
  superhappy: 'Súper feliz',
  happy: 'Feliz',
  sad: 'Triste',
  supersad: 'Súper triste',
  unknown: 'Sin datos',
};

function PlantCard({ name, image, imagesVersion, status, humidity, minHumidity, needsWater, type }) {
  const displayStatus = status === 'unknown' ? 'happy' : status;
  const versionQs = imagesVersion ? `?v=${encodeURIComponent(imagesVersion)}` : '';
  const imageSrc = image ? `${API_BASE}/${image}/${displayStatus}/png${versionQs}` : null;

  const handleImageError = (e) => {
    e.target.style.display = 'none';
  };

  const humidityLabel = humidity != null ? `${Math.round(humidity)}%` : 'Sin datos';

  return (
    <div className={`plant-card ${needsWater ? 'card-needs-water' : ''}`}>
      <div className="card-image-container">
        {imageSrc && (
          <img
            src={imageSrc}
            alt={`${name} - ${status}`}
            className="card-image"
            onError={handleImageError}
          />
        )}
      </div>
      <div className="card-content">
        <h3 className="card-name">{name}</h3>
        <span className="card-type">{type || 'Sin tipo'}</span>

        <div className="card-humidity-row">
          <span className="card-humidity">{humidityLabel}</span>
          <span className="card-threshold">
            umbral {minHumidity != null ? `${Math.round(minHumidity)}%` : '-'}
          </span>
        </div>

        <span className={`card-status ${status}`}>
          {STATUS_LABELS[status] || STATUS_LABELS.unknown}
        </span>
        {needsWater && <span className="card-needs-water-badge">¡Necesita agua!</span>}
      </div>
    </div>
  );
}

export default PlantCard;