// Talks to the server's /planets routes, which store planets in MongoDB.

// JSON.stringify turns typed arrays (Float32Array...) into {"0":..} objects,
// so turn them into plain arrays first.
function toJson(value) {
  return JSON.stringify(value, (key, v) => (ArrayBuffer.isView(v) ? Array.from(v) : v));
}

async function request(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`${url} failed with status ${res.status}`);
  return res.json();
}

export function savePlanet(song, features, blueprint) {
  return request('/planets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: toJson({ song, features, blueprint }),
  });
}

export function listPlanets() {
  return request('/planets');
}

export function getPlanet(id) {
  return request(`/planets/${encodeURIComponent(id)}`);
}

// The newest planets WITH features and blueprint, to draw them (the start page's galaxy).
export function listFullPlanets(limit = 8) {
  return request(`/planets?full=1&limit=${encodeURIComponent(limit)}`);
}
