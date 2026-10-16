// Map tiles are addressed through the website's API prefix. Applied to every
// resource envelope the application receives, fetched or embedded in its HTML.
export function normalizeResource(data) {
  if (data?.map?.tiles) data.map.tiles = data.map.tiles.replace('/api/v1/', '/web-api/v1/');
  return data;
}
