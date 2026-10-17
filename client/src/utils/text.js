// Replace {name}-style placeholders in a translated string. Missing values
// become empty strings rather than leaking the placeholder.
export function fill(template, values = {}) {
  return String(template).replace(/\{(\w+)\}/g, (_, key) => (values[key] === undefined || values[key] === null ? '' : String(values[key])));
}
