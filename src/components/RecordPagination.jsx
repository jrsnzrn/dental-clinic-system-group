export default function RecordPagination({ pagination, label = "records" }) {
  const { page, pageCount, total, startIndex, endIndex, setPage } = pagination;
  if (!total) return null;
  return (
    <nav className="recordPagination" aria-label={`${label} pagination`}>
      <span role="status">Showing {startIndex + 1}–{endIndex} of {total} {label}</span>
      <div className="recordPaginationControls">
        <button type="button" className="btn secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button>
        <label>Page <select className="input" value={page} onChange={event => setPage(Number(event.target.value))} aria-label={`Select ${label} page`}>
          {Array.from({ length: pageCount }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}
        </select> of {pageCount}</label>
        <button type="button" className="btn secondary" disabled={page === pageCount} onClick={() => setPage(page + 1)}>Next</button>
      </div>
    </nav>
  );
}
