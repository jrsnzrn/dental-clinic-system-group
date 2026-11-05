import LoadingIndicator from "./LoadingIndicator";

export function SkeletonBlock({ className = "" }) {
  return <div className={`skeletonBlock ${className}`.trim()} aria-hidden="true" />;
}

export function SkeletonList({ count = 3, cardClassName = "", label = "" }) {
  return (
    <div className="skeletonList">
      {label ? <LoadingIndicator>{label}</LoadingIndicator> : null}
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className={`skeletonCard ${cardClassName}`.trim()}>
          <SkeletonBlock className="skeletonTitle" />
          <SkeletonBlock className="skeletonLine" />
          <SkeletonBlock className="skeletonLine short" />
          <div className="skeletonGrid">
            <SkeletonBlock className="skeletonMini" />
            <SkeletonBlock className="skeletonMini" />
            <SkeletonBlock className="skeletonMini" />
          </div>
        </div>
      ))}
    </div>
  );
}
