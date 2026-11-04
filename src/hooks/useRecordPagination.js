import { useCallback, useState } from "react";
import { getPage } from "../utils/pagination";

export default function useRecordPagination(items, resetKey = "", pageSize = 20) {
  const [navigation, setNavigation] = useState({ key: resetKey, page: 1 });
  const result = getPage(items, navigation.key === resetKey ? navigation.page : 1, pageSize);
  if (navigation.key !== resetKey || navigation.page !== result.page) {
    setNavigation({ key: resetKey, page: result.page });
  }
  const setPage = useCallback(page => setNavigation(current =>
    current.key === resetKey && current.page === page ? current : { key: resetKey, page }
  ), [resetKey]);
  return { ...result, setPage };
}
