import { hostedPart } from '../extensions.js';

// The hosted edition offers "email me when new files are added" on dataset,
// resource and guide pages. The community edition renders nothing here.
const { DatasetAlert } = hostedPart(import.meta.glob('../enterprise/alerts.jsx', { eager: true }), {});

/** @param {{ datasetId: string, datasetTitle?: string, variant: 'dataset' | 'resource' | 'guide' }} props */
export default function DatasetAlertSlot(props) {
  return DatasetAlert && props.datasetId ? <DatasetAlert {...props} /> : null;
}
