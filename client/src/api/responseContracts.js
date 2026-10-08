const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const field = value => record(value) && typeof value.id === 'string' && typeof value.type === 'string' &&
  (value.legacy_ids === undefined || (Array.isArray(value.legacy_ids) && value.legacy_ids.every(alias => typeof alias === 'string')));

export const resourceResponse = ({ data }) => record(data) && typeof data.id === 'string' &&
  ['ingested', 'datastore', 'ingestable', 'file-only'].includes(data.query_mode) && record(data.dataset) &&
  (data.ingestion?.fields === undefined || (Array.isArray(data.ingestion.fields) && data.ingestion.fields.every(field)));

export const queryResponse = ({ data, meta }) => record(data) && Array.isArray(data.fields) &&
  data.fields.every(field) && Array.isArray(data.records) && data.records.every(record) &&
  Number.isSafeInteger(data.total) && data.total >= 0 &&
  record(meta) && ['ingested', 'datastore'].includes(meta.query_mode);

export const listResponse = ({ data }) => Array.isArray(data) && data.every(record);

export const profileResponse = ({ data }) => record(data) && Array.isArray(data.columns) &&
  data.columns.every(field) && Number.isSafeInteger(data.row_count) && data.row_count >= 0;

export const jobResponse = ({ data }) => record(data) &&
  (typeof data.id === 'number' || typeof data.id === 'string') &&
  ['pending', 'running', 'done', 'failed'].includes(data.status);

export const preparationResponse = envelope => jobResponse(envelope) ||
  (record(envelope.data) && envelope.data.already_loaded === true && envelope.data.id == null);
