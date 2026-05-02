import { useEffect, useRef } from "react";

export default function CursorAura() {
  const auraRef = useRef(null);
  const primaryRef = useRef(null);
  const secondaryRef = useRef(null);
  const coreRef = useRef(null);
  const trailRefs = useRef([]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) return undefined;

    const auraNode = auraRef.current;
    const primaryNode = primaryRef.current;
    const secondaryNode = secondaryRef.current;
    const coreNode = coreRef.current;
    const trailNodes = trailRefs.current.filter(Boolean);

    if (!auraNode || !primaryNode || !secondaryNode || !coreNode || !trailNodes.length) {
      return undefined;
    }

    const state = {
      targetX: window.innerWidth * 0.5,
      targetY: window.innerHeight * 0.35,
      primaryX: window.innerWidth * 0.5,
      primaryY: window.innerHeight * 0.35,
      secondaryX: window.innerWidth * 0.5,
      secondaryY: window.innerHeight * 0.35,
      coreX: window.innerWidth * 0.5,
      coreY: window.innerHeight * 0.35,
      active: false,
      touchActive: false,
    };

    const trail = Array.from({ length: trailNodes.length }, () => ({
      x: state.primaryX,
      y: state.primaryY,
    }));

    let frameId = 0;
    let touchTimer = 0;

    function setAuraVisibility(nextActive) {
      state.active = nextActive;
      auraNode.style.setProperty("--auraOpacity", nextActive ? "1" : "0");
    }

    function updateTarget(clientX, clientY, isTouch = false) {
      state.targetX = clientX;
      state.targetY = clientY;
      state.touchActive = isTouch;
      setAuraVisibility(true);

      if (touchTimer) window.clearTimeout(touchTimer);
      if (isTouch) {
        touchTimer = window.setTimeout(() => {
          state.touchActive = false;
          setAuraVisibility(false);
        }, 900);
      }
    }

    function animate() {
      state.primaryX += (state.targetX - state.primaryX) * 0.16;
      state.primaryY += (state.targetY - state.primaryY) * 0.16;
      state.secondaryX += (state.targetX - state.secondaryX) * 0.11;
      state.secondaryY += (state.targetY - state.secondaryY) * 0.11;
      state.coreX += (state.targetX - state.coreX) * 0.24;
      state.coreY += (state.targetY - state.coreY) * 0.24;

      primaryNode.style.transform = `translate3d(${state.primaryX}px, ${state.primaryY}px, 0) translate(-50%, -50%)`;
      secondaryNode.style.transform = `translate3d(${state.secondaryX}px, ${state.secondaryY}px, 0) translate(-50%, -50%)`;
      coreNode.style.transform = `translate3d(${state.coreX}px, ${state.coreY}px, 0) translate(-50%, -50%)`;

      trail[0].x += (state.primaryX - trail[0].x) * 0.22;
      trail[0].y += (state.primaryY - trail[0].y) * 0.22;

      for (let index = 1; index < trail.length; index += 1) {
        trail[index].x += (trail[index - 1].x - trail[index].x) * 0.24;
        trail[index].y += (trail[index - 1].y - trail[index].y) * 0.24;
      }

      trailNodes.forEach((node, index) => {
        const scale = 1 - index * 0.12;
        const opacity = state.active ? Math.max(0.12, 0.34 - index * 0.06) : 0;
        node.style.transform = `translate3d(${trail[index].x}px, ${trail[index].y}px, 0) translate(-50%, -50%) scale(${scale})`;
        node.style.opacity = `${opacity}`;
      });

      frameId = window.requestAnimationFrame(animate);
    }

    function onPointerMove(event) {
      if (event.pointerType === "touch") return;
      updateTarget(event.clientX, event.clientY);
    }

    function onPointerLeave() {
      if (state.touchActive) return;
      setAuraVisibility(false);
    }

    function onTouch(event) {
      const touch = event.touches[0];
      if (!touch) return;
      updateTarget(touch.clientX, touch.clientY, true);
    }

    frameId = window.requestAnimationFrame(animate);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerleave", onPointerLeave, { passive: true });
    window.addEventListener("touchstart", onTouch, { passive: true });
    window.addEventListener("touchmove", onTouch, { passive: true });

    return () => {
      if (frameId) window.cancelAnimationFrame(frameId);
      if (touchTimer) window.clearTimeout(touchTimer);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerleave", onPointerLeave);
      window.removeEventListener("touchstart", onTouch);
      window.removeEventListener("touchmove", onTouch);
    };
  }, []);

  return (
    <div ref={auraRef} className="homeCursorAura" aria-hidden="true">
      <div ref={secondaryRef} className="homeCursorAuraLayer homeCursorAuraLayerSecondary" />
      <div ref={primaryRef} className="homeCursorAuraLayer homeCursorAuraLayerPrimary" />
      <div ref={coreRef} className="homeCursorAuraCore" />
      {[0, 1, 2, 3].map((index) => (
        <span
          key={index}
          ref={(node) => {
            trailRefs.current[index] = node;
          }}
          className="homeCursorAuraTrail"
        />
      ))}
    </div>
  );
}
