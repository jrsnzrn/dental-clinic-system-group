export function isTopmostModal(modal) {
  if (!modal) return false;

  const modals = Array.from(
    document.querySelectorAll(".confirmDialogOverlay, .appearanceModalOverlay, .globalSuccessOverlay")
  );
  const topmost = modals.reduce((currentTop, candidate) => {
    if (!currentTop) return candidate;

    const candidateZ = Number.parseInt(window.getComputedStyle(candidate).zIndex, 10) || 0;
    const currentTopZ = Number.parseInt(window.getComputedStyle(currentTop).zIndex, 10) || 0;
    const candidateFollowsTop = Boolean(
      currentTop.compareDocumentPosition(candidate) & Node.DOCUMENT_POSITION_FOLLOWING
    );

    return candidateZ > currentTopZ || (candidateZ === currentTopZ && candidateFollowsTop)
      ? candidate
      : currentTop;
  }, null);

  return topmost === modal;
}
