// Hosted-service parts live in src/enterprise when that directory is present.
// Each surface asks Vite for its own part with import.meta.glob, so the part
// stays in that surface's chunk; without the extension the community default
// applies and nothing hosted is bundled.
export function hostedPart(modules, fallback) {
  const module = Object.values(modules)[0];
  return module ? module.default : fallback;
}
