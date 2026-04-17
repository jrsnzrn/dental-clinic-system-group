export default function EmptyState({ title, message, compact = false }) {
  return (
    <div className={`emptyEditorState ${compact ? "compact" : ""}`}>
      <strong>{title}</strong>
      <p>{message}</p>
    </div>
  );
}
