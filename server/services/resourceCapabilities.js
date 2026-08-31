const MAX_FILE_MB = Number(process.env.MAX_FILE_MB) || 50;
const MAX_XLSX_MB = Number(process.env.MAX_XLSX_MB) || 20;
const MAX_ROWS = Number(process.env.MAX_ROWS) > 0 ? Number(process.env.MAX_ROWS) : 1_000_000;
const MAX_COLS = Number(process.env.MAX_COLS) > 0 ? Number(process.env.MAX_COLS) : 120;

const maxFileBytes = () => MAX_FILE_MB * 1024 * 1024;

// Excel formats get a smaller cap than CSV: conversion is isolated and bounded,
// but XLSX shared strings/styles and legacy XLS parsing still expand in memory
// inside that child process.
const ingestCapBytesFor = (format) => {
    const normalized = String(format || '').toUpperCase();
    if (normalized === 'CSV') return maxFileBytes();
    if (normalized === 'XLSX' || normalized === 'XLS') return MAX_XLSX_MB * 1024 * 1024;
    return null;
};

const knownRecordCount = (row) => {
    const raw = row && row.raw && typeof row.raw === 'object' && !Array.isArray(row.raw)
        ? row.raw : {};
    if (raw.record_count == null || raw.record_count === '') return null;
    const count = Number(raw.record_count);
    return Number.isFinite(count) && count >= 0 ? count : null;
};

const knownFieldCount = (row) => {
    const raw = row && row.raw && typeof row.raw === 'object' && !Array.isArray(row.raw)
        ? row.raw : {};
    if (raw.field_count == null || raw.field_count === '') return null;
    const count = Number(raw.field_count);
    return Number.isSafeInteger(count) && count >= 0 ? count : null;
};

const isIngestableFile = (row) => {
    const cap = ingestCapBytesFor(row && row.format);
    const recordCount = knownRecordCount(row);
    const fieldCount = knownFieldCount(row);
    return cap !== null &&
        (row.size_bytes == null || Number(row.size_bytes) <= cap) &&
        (recordCount == null || recordCount <= MAX_ROWS) &&
        (fieldCount == null || fieldCount <= MAX_COLS);
};

// `capability` drives truthful presentation copy. `queryMode` preserves the
// public API contract, where a map-only resource is still a file-only table.
const classifyResource = (row = {}) => {
    if (row.ingest_status === 'ready') return { capability: 'ingested', queryMode: 'ingested' };
    if (row.datastore_active) return { capability: 'datastore', queryMode: 'datastore' };
    if (isIngestableFile(row)) return { capability: 'ingestable', queryMode: 'ingestable' };
    if (row.map_provider || (row.map && row.map.available)) {
        return { capability: 'mapped', queryMode: 'file-only' };
    }
    return { capability: 'file-only', queryMode: 'file-only' };
};

const computeQueryMode = row => classifyResource(row).queryMode;

module.exports = {
    classifyResource,
    computeQueryMode,
    ingestCapBytesFor,
    knownRecordCount,
    knownFieldCount,
    isIngestableFile
};
