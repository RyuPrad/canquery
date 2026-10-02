import { memo, useMemo } from 'react';
import { useLang } from '../i18n.jsx';

const isNumType = (type) => /int|numeric|float|double|money/i.test(type || '');
const isDateType = (type) => /date|time/i.test(type || '');

function typeChipClass(type) {
  if (isNumType(type)) return 'cq-type cq-type-num';
  if (isDateType(type)) return 'cq-type cq-type-date';
  return 'cq-type cq-type-text';
}

// Draft search/filter changes update their controls immediately without
// rebuilding up to 6,000 unchanged cells before the debounced query returns.
const TableBody = memo(function TableBody({ fields, records }) {
  const { t } = useLang();
  const columns = useMemo(() => fields.map(field => ({
    id: field.id, className: isNumType(field.type) ? 'cq-td-num' : '',
  })), [fields]);
  return <tbody>
    {records.length === 0 ? <tr>
      <td colSpan={fields.length}>
        <div className="py-12 text-center space-y-1">
          <p className="text-base-content/60">{t('table.no_rows')}</p>
          <p className="text-xs text-base-content/40">{t('table.no_rows_hint')}</p>
        </div>
      </td>
    </tr> : records.map((row, index) => <tr key={index}>
      {columns.map(field => {
        const value = row[field.id];
        const text = value == null ? undefined : String(value);
        return <td key={field.id} className={field.className} title={text}>
          {value == null ? <span className="cq-null">{'∅'}</span> : text}
        </td>;
      })}
    </tr>)}
  </tbody>;
});

function DataTable({
  fields,
  records,
  sort,
  onSortChange,
  columnFilters,
  onColumnFilterChange,
}) {
  const { t } = useLang();
  const sortValue = sort?.trim();
  const exactSort = fields.some(field => field.id === sortValue);
  const sortMatch = exactSort ? null : /^([\s\S]+?)\s+(asc|desc)$/i.exec(sortValue || '');

  const handleSort = (fieldId) => {
    const direction = getSortDirection(fieldId);
    if (direction === 'asc') {
      onSortChange(`${fieldId} desc`);
    } else if (direction === 'desc') {
      onSortChange(null);
    } else {
      onSortChange(`${fieldId} asc`);
    }
  };

  const getSortDirection = (fieldId) => {
    if (exactSort) return sortValue === fieldId ? 'asc' : null;
    return sortMatch?.[1] === fieldId ? sortMatch[2].toLowerCase() : null;
  };

  return (
    <div className="cq-table-wrap">
      <table className="cq-table">
        <thead>
          <tr>
            {fields.map((field) => {
              const dir = getSortDirection(field.id);
              return (
                <th key={field.id} scope="col" aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none'}>
                  <button type="button" onClick={() => handleSort(field.id)} className="inline-flex items-center gap-1.5 text-left cursor-pointer">
                    {field.id}
                    <span className={typeChipClass(field.type)}>{field.type}</span>
                    {dir && (
                      <span className="cq-fg-red font-bold" aria-hidden="true">
                        {dir === 'asc' ? '↑' : '↓'}
                      </span>
                    )}
                  </button>
                </th>
              );
            })}
          </tr>
          <tr>
            {fields.map((field) => (
              <th key={field.id}>
                {field.id === '_id' ? (
                  <span />
                ) : (
                  <input
                    className="cq-filter-input"
                    placeholder={t('table.filter')}
                    title={t('table.filter_tip')}
                    aria-label={field.id + ' · ' + t('table.filter')}
                    value={columnFilters[field.id] || ''}
                    onChange={(e) => onColumnFilterChange(field.id, e.target.value)}
                  />
                )}
              </th>
            ))}
          </tr>
        </thead>
        <TableBody fields={fields} records={records} />
      </table>
    </div>
  );
}

export default memo(DataTable);
