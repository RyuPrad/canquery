/**
 * Text for matching: lowercase with accents removed, so "Sébaste" matches "sebaste".
 * Browser-only on purpose (the \p{M} class); the mobile app does not share this module.
 * @param {unknown} value
 * @returns {string}
 */
export const fold = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase();
