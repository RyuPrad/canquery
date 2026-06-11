function pickTranslated(obj, fallback) {
    if (!obj) {
        return { en: null, fr: null };
    }
    const en = obj.en !== undefined ? String(obj.en).trim() : null;
    const fr = obj.fr !== undefined ? String(obj.fr).trim() : null;
    const resultEn = en !== null && en !== '' ? en : (fallback ? String(fallback).trim() : null);
    const resultFr = fr !== null && fr !== '' ? fr : null;
    return { en: resultEn, fr: resultFr };
}

function normalizeOrganization(org) {
    if (!org) {
        return null;
    }
    const separator = ' | ';
    const title = org.title ? String(org.title).trim() : '';
    const separatorIndex = title.indexOf(separator);
    let titleEn, titleFr;
    if (separatorIndex === -1) {
        titleEn = title;
        titleFr = title;
    } else {
        titleEn = title.substring(0, separatorIndex).trim();
        titleFr = title.substring(separatorIndex + separator.length).trim();
    }
    return {
        id: org.id,
        name: org.name,
        titleEn,
        titleFr
    };
}

function normalizeResource(resource, datasetId) {
    const nameTranslated = pickTranslated(resource.name_translated, resource.name);
    const sizeBytes = resource.size !== undefined && resource.size !== null && !isNaN(Number(resource.size)) ? Number(resource.size) : null;
    const datastoreActive = resource.datastore_active === true;
    
    let language;
    if (Array.isArray(resource.language)) {
        language = resource.language.join(', ');
    } else if (resource.language !== undefined && resource.language !== null) {
        language = String(resource.language);
    } else {
        language = null;
    }

    const lastModified = resource.last_modified || resource.metadata_modified || resource.created || null;

    let format = null;
    if (resource.format !== undefined && resource.format !== null) {
        format = String(resource.format).trim().toUpperCase();
        if (format === '') {
            format = null;
        }
    }

    return {
        id: resource.id,
        datasetId,
        nameEn: nameTranslated.en,
        nameFr: nameTranslated.fr,
        format,
        url: resource.url || null,
        sizeBytes,
        datastoreActive,
        language,
        lastModified,
        raw: resource
    };
}

function normalizePackage(pkg) {
    const titleTranslated = pickTranslated(pkg.title_translated, pkg.title);
    const notesTranslated = pickTranslated(pkg.notes_translated, pkg.notes);

    const raw = { ...pkg };
    delete raw.resources;

    return {
        organization: normalizeOrganization(pkg.organization),
        dataset: {
            id: pkg.id,
            name: pkg.name,
            titleEn: titleTranslated.en,
            titleFr: titleTranslated.fr,
            notesEn: notesTranslated.en,
            notesFr: notesTranslated.fr,
            orgId: pkg.owner_org || null,
            keywordsEn: (pkg.keywords && pkg.keywords.en) || [],
            keywordsFr: (pkg.keywords && pkg.keywords.fr) || [],
            metadataModified: pkg.metadata_modified || null,
            raw
        },
        resources: (pkg.resources || []).map(r => normalizeResource(r, pkg.id))
    };
}

module.exports = { normalizePackage, normalizeOrganization, normalizeResource, pickTranslated };
