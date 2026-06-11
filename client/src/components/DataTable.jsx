

function DataTable({
  fields,
  records,
  sort,
  onSortChange,
  columnFilters,
  onColumnFilterChange,
}) {
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
    <div className="overflow-x-auto border border-base-300 rounded-lg">
      <table className="table table-sm table-zebra">
        <thead>
          <tr>
            {fields.map((field) => (
              <th
                key={field.id}
                className="cursor-pointer select-none whitespace-nowrap"
                onClick={() => handleSort(field.id)}
              >
                {field.id}
                <span className="opacity-40 text-xs ml-1">{field.type}</span>
                {getSortDirection(field.id) && (
                  <span className="text-[#d52b1e]"> {getSortDirection(field.id)}</span>
                )}
              </th>
            ))}
          </tr>
          <tr>
            {fields.map((field) => (
              <th key={field.id}>
                {field.id === '_id' ? (
                  <span />
                ) : (
                  <input
                    className="input input-xs input-bordered w-full min-w-24 font-normal"
                    placeholder="filter..."
                    value={columnFilters[field.id] || ''}
                    onChange={(e) => onColumnFilterChange(field.id, e.target.value)}
                  />
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {records.map((row, i) => (
            <tr key={i}>
              {fields.map((field) => (
                <td
                  key={field.id}
                  className="whitespace-nowrap max-w-xs overflow-hidden text-ellipsis"
                >
                  {String(row[field.id] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default DataTable;
