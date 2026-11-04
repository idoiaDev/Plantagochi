const BASE_URL = process.env.EXPO_PUBLIC_API_URL;

async function request(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (typeof body.detail === "string") {
        detail = body.detail;
      } else if (Array.isArray(body.detail)) {
        const msgs = body.detail
          .map((d) => d.msg)
          .filter(Boolean)
          .join("; ");
        if (msgs) detail = msgs;
      }
    } catch (_) {
      // keep fallback message
    }
    throw new Error(detail);
  }

  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export const api = {
  BASE_URL,

  request,

  listAll: () => request("/all"),

  getTypes: () => request("/types"),

  getLastUpdate: () => request("/last-update"),

  imageUrl: (typeId, status, version) => {
    const state = status === "unknown" ? "happy" : status;
    const qs = version ? `?v=${encodeURIComponent(version)}` : "";
    return `${BASE_URL}/types/${typeId}/images/${state}/png${qs}`;
  },

  frameImageUrl: (typeId, state, frame, version) => {
    const qs = version ? `&v=${encodeURIComponent(String(version))}` : "";
    return `${BASE_URL}/types/${typeId}/images/${state}/png?frame=${frame}${qs}`;
  },

  uploadTypeImages: async (id, formData) => {
    const res = await fetch(`${BASE_URL}/types/${id}/images`, {
      method: "POST",
      body: formData,
    });
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        if (typeof body.detail === "string") detail = body.detail;
      } catch (_) {
        // keep fallback message
      }
      throw new Error(detail);
    }
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  },

  createPlant: (body) =>
    request("", { method: "POST", body: JSON.stringify(body) }),

  createType: (body) =>
    request("/types", { method: "POST", body: JSON.stringify(body) }),

  updatePlant: (id, body) =>
    request(`/${id}`, { method: "PUT", body: JSON.stringify(body) }),

  updateThreshold: (id, minHumidity) =>
    request(`/${id}/threshold`, {
      method: "PATCH",
      body: JSON.stringify({ min_humidity: minHumidity }),
    }),

  deletePlant: (id) => request(`/${id}`, { method: "DELETE" }),

  deleteType: (id) => request(`/types/${id}`, { method: "DELETE" }),

  registerPushToken: (token) =>
    request("/push-token", { method: "POST", body: JSON.stringify({ token }) }),
};
