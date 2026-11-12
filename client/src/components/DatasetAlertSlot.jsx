import { hostedPart } from '../extensions.js';

// The hosted edition offers "email me when new files are added" on dataset,
// resource and guide pages, and "email me the new amounts" on the pages of a
// dataset's hub (the OAS benefit amounts). The community edition renders
// nothing here.
const { DatasetAlert } = hostedPart(import.meta.glob('../enterprise/alerts.jsx', { eager: true }), {});

/** @param {{ datasetId: string, datasetTitle?: string, variant: 'dataset' | 'resource' | 'guide' | 'hub' }} props */
export default function DatasetAlertSlot(props) {
  return DatasetAlert && props.datasetId ? <DatasetAlert {...props} /> : null;
}
