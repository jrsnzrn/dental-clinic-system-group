import RecordPagination from "./RecordPagination";
import useRecordPagination from "../hooks/useRecordPagination";

export default function PaginatedRecords({ items, children, resetKey = "", tableColumns, list = false, label = "records", hideSinglePageControls = false }) {
  const pagination = useRecordPagination(items, resetKey);
  const controls = hideSinglePageControls && pagination.pageCount === 1 ? null : <RecordPagination pagination={pagination} label={label} />;
  return <>
    {pagination.items.map((item, index) => children(item, pagination.startIndex + index))}
    {tableColumns ? <tr><td colSpan={tableColumns}>{controls}</td></tr> : list ? <li className="recordPaginationListItem">{controls}</li> : controls}
  </>;
}
