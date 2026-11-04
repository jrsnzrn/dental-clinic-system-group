export default function LoadingIndicator({ children = "Loading…" }) {
  return <span className="actionLoadingIndicator" role="status" aria-live="polite">
    <span className="actionLoadingSpinner" aria-hidden="true" />
    <span>{children}</span>
  </span>;
}
