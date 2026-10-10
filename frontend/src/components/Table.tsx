import { Empty } from './States';

export interface Column<T> {
  key: string;
  header: string;
  /** Right-align numeric columns so digits line up. */
  numeric?: boolean;
  /** Legacy alias for `numeric`. */
  align?: 'left' | 'right';
  render: (row: T) => React.ReactNode;
}

function isNumeric<T>(c: Column<T>) {
  return c.numeric || c.align === 'right';
}

/**
 * Table: columns come from the data, not a template. Numeric cells use tabular
 * figures so a column of numbers can be scanned and compared.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  emptyLabel = 'No rows.',
  emptyHint,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey?: (row: T, i: number) => string;
  emptyLabel?: string;
  emptyHint?: string;
}) {
  if (!rows.length) {
    return (
      <div className="rf-table-wrap">
        <Empty label={emptyLabel} hint={emptyHint} />
      </div>
    );
  }
  return (
    <div className="rf-table-wrap">
      <table className="rf-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} data-numeric={isNumeric(c) || undefined}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={rowKey ? rowKey(row, i) : i}>
              {columns.map((c) => (
                <td key={c.key} data-numeric={isNumeric(c) || undefined}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Alias so both import styles work. */
export const Table = DataTable;
