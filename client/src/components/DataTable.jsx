import { useLang } from '../i18n.jsx';

const isNumType = (type) => /int|numeric|float|double|money/i.test(type || '');
const isDateType = (type) => /date|time/i.test(type || '');

function typeChipClass(type) {
  if (isNumType(type)) return 'cq-type cq-type-num';
  if (isDateType(type)) return 'cq-type cq-type-date';
  return 'cq-type cq-type-text';
}

function DataTable({
  fields,
  records,
  sort,
  onSortChange,
  columnFilters,
  onColumnFilterChange,
}) {
  const { t } = useLang();

  const handleSort = (fieldId) => {
    if (sort === `${fieldId} asc`) {
      onSortChange(`${fieldId} desc`);
    } else if (sort === `${fieldId} desc`) {
      onSortChange(null);
    } else {
      onSortChange(`${fieldId} asc`);
    }
  };

  const getSortDirection = (fieldId) => {
    if (sort === `${fieldId} asc`) return 'asc';
    if (sort === `${fieldId} desc`) return 'desc';
    return null;
  };

  return (
    <div className="cq-table-wrap">
      <table className="cq-table">
        <thead>
          <tr>
            {fields.map((field) => {
              const dir = getSortDirection(field.id);
              return (
                <th key={field.id} onClick={() => handleSort(field.id)}>
                  <span className="inline-flex items-center gap-1.5">
                    {field.id}
                    <span className={typeChipClass(field.type)}>{field.type}</span>
                    {dir && (
                      <span className="cq-fg-red font-bold">
                        {dir === 'asc' ? '↑' : '↓'}
                      </span>
                    )}
                  </span>
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
                    value={columnFilters[field.id] || ''}
                    onChange={(e) => onColumnFilterChange(field.id, e.target.value)}
                  />
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {records.length === 0 ? (
            <tr>
              <td colSpan={fields.length}>
                <div className="py-12 text-center space-y-1">
                  <p className="text-base-content/60">{t('table.no_rows')}</p>
                  <p className="text-xs text-base-content/40">{t('table.no_rows_hint')}</p>
                </div>
              </td>
            </tr>
          ) : (
            records.map((row, i) => (
              <tr key={i}>
                {fields.map((field) => {
                  const v = row[field.id];
                  return (
                    <td
                      key={field.id}
                      className={isNumType(field.type) ? 'cq-td-num' : ''}
                      title={v === null || v === undefined ? undefined : String(v)}
                    >
                      {v === null || v === undefined ? (
                        <span className="cq-null">{'∅'}</span>
                      ) : (
                        String(v)
                      )}
                    </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export default DataTable;
