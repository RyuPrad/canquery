const { ingestLimits } = require('../config/ingest');
const limits = ingestLimits();

// Excel formats get a smaller cap than CSV: conversion is isolated and bounded,
// but XLSX shared strings/styles and legacy XLS parsing still expand in memory
// inside that child process.
const ingestCapBytesFor = (format) => {
    const normalized = String(format || '').toUpperCase();
    if (normalized === 'CSV') return limits.maxFileBytes;
    if (normalized === 'XLSX' || normalized === 'XLS') return limits.maxXlsxBytes;
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
    // A CSV label can describe a ZIP distribution (notably Statistics Canada).
    // The CSV loader accepts a text stream, not an archive. Existing loaded
    // tables and active upstream datastores are still classified first below.
    if (String(row?.format || '').toUpperCase() === 'CSV') {
        try {
            if (/\.zip$/i.test(new URL(row.url).pathname)) return false;
        } catch { /* URL admission is owned by the download layer. */ }
    }
    const cap = ingestCapBytesFor(row && row.format);
    const recordCount = knownRecordCount(row);
    const fieldCount = knownFieldCount(row);
    return cap !== null &&
        (row.size_bytes == null || Number(row.size_bytes) <= cap) &&
        (recordCount == null || recordCount <= limits.maxRows) &&
        (fieldCount == null || fieldCount <= limits.maxCols);
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
