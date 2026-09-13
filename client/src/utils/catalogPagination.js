export const PAGE_SIZE = 50;

export function pageNumber(params) {
  const values = params.getAll('page');
  if (!values.length) return 1;
  if (values.length !== 1 || !/^[1-9]\d*$/.test(values[0])) return null;
  const page = Number(values[0]);
  return Number.isSafeInteger(page) && page <= Math.floor(Number.MAX_SAFE_INTEGER / PAGE_SIZE) ? page : null;
}

export function pagePath(path, page) {
  return path + (page > 1 ? '?page=' + page : '');
}
