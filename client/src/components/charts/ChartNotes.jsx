import { useLang } from '../../i18n.jsx';
import { chartNotes } from './chartText.js';

// What a chart left out or assumed: the note that matters most in one line,
// the rest behind a disclosure, so a reader sees at once whether a figure is
// complete and can check every step on request.
export default function ChartNotes({ chart }) {
  const { t, lang } = useLang();
  const notes = chartNotes(chart, t, lang);
  if (!notes.length) return null;
  const [first, ...rest] = notes;
  return (
    <div className="text-xs space-y-1">
      <p className={first.caution ? 'text-warning' : 'text-base-content/60'}>{first.text}</p>
      {rest.length > 0 && (
        <details className="text-base-content/60">
          <summary className="cursor-pointer select-none">{t('chart.notes_title')}</summary>
          <ul className="mt-1 space-y-0.5 list-disc pl-4">
            {rest.map((note) => (
              <li key={note.code} className={note.caution ? 'text-warning' : undefined}>
                {note.text}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
