export function getPage(items, requestedPage = 1, pageSize = 20) {
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.max(1, Math.min(pageCount, Math.floor(Number(requestedPage) || 1)));
  const startIndex = (page - 1) * pageSize;
  return { items: items.slice(startIndex, startIndex + pageSize), page, pageCount, total, startIndex, endIndex: Math.min(startIndex + pageSize, total) };
}
