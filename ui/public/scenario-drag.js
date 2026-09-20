export function installScenarioDrag({ shelf, board, canvas, resolveSource, insert }) {
  let drag = null;
  let suppressClickUntil = 0;
  let frame = 0;
  let previousTime = 0;

  function hit() {
    const target = document.elementFromPoint(drag.x, drag.y);
    return target && canvas.contains(target) ? target : null;
  }

  function paint() {
    if (!drag?.ghost) return;
    const target = hit();
    const arrow = target?.closest('[data-insert-index]');
    board.querySelectorAll('.dropTarget').forEach(item => item.classList.toggle('dropTarget', item === arrow));
    arrow?.classList.add('dropTarget');
    canvas.classList.toggle('dragOver', Boolean(target));
    const rect = arrow?.getBoundingClientRect();
    const x = rect ? rect.left + rect.width / 2 : drag.x;
    const y = rect ? rect.top + rect.height / 2 : drag.y;
    drag.ghost.classList.toggle('isSnapped', Boolean(arrow));
    drag.ghost.style.transform = `translate3d(${x - drag.width / 2}px, ${y - drag.height / 2}px, 0) scale(${arrow ? 0.3 : 1})`;
  }

  function scrollFrame(time) {
    if (!drag?.ghost) return;
    const rect = board.getBoundingClientRect();
    const elapsed = previousTime ? Math.min(time - previousTime, 32) : 16;
    previousTime = time;
    if (drag.y >= rect.top && drag.y <= rect.bottom && drag.x >= rect.left && drag.x <= rect.right) {
      const edge = Math.min(48, rect.width / 4);
      const speed = drag.x < rect.left + edge ? -(rect.left + edge - drag.x) / edge
        : drag.x > rect.right - edge ? (drag.x - rect.right + edge) / edge : 0;
      board.scrollLeft += speed * elapsed * 0.7;
    }
    paint();
    frame = requestAnimationFrame(scrollFrame);
  }

  function finish(commit = false) {
    if (!drag) return;
    const current = drag;
    const target = current.ghost && commit ? hit() : null;
    let index = null;
    if (target) {
      const arrow = target.closest('[data-insert-index]');
      const card = target.closest('[data-step-index]');
      index = arrow ? Number(arrow.dataset.insertIndex) : card
        ? Number(card.dataset.stepIndex) + Number(current.x > card.getBoundingClientRect().left + card.getBoundingClientRect().width / 2)
        : board.querySelectorAll('[data-step-index]').length;
    }
    drag = null;
    cancelAnimationFrame(frame);
    previousTime = 0;
    if (current.root.hasPointerCapture(current.id)) current.root.releasePointerCapture(current.id);
    current.card.classList.remove('scenarioDragSource');
    current.ghost?.remove();
    canvas.classList.remove('dragOver');
    board.querySelectorAll('.dropTarget').forEach(item => item.classList.remove('dropTarget'));
    if (current.ghost) suppressClickUntil = performance.now() + 250;
    if (index !== null) insert(current.source, index);
  }

  document.addEventListener('pointerdown', event => {
    if (drag || event.button !== 0 || !event.isPrimary) return;
    if (event.target.closest('[data-delete-method]')) return;
    const card = event.target.closest('[data-step-index], [data-endpoint-id]');
    if (!card || !(board.contains(card) || shelf.contains(card))) return;
    if (board.contains(card) && event.target.closest('button')) return;
    const source = resolveSource(card);
    if (!source) return;
    suppressClickUntil = 0;
    drag = { id: event.pointerId, card, source, root: board.contains(card) ? board : shelf,
      startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, ghost: null };
  });
  document.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    drag.x = event.clientX;
    drag.y = event.clientY;
    if (drag.ghost && event.pointerType === 'mouse' && event.buttons === 0) {
      finish(true);
      return;
    }
    if (!drag.ghost) {
      if (Math.hypot(drag.x - drag.startX, drag.y - drag.startY) < 6) return;
      const surface = drag.card.querySelector('.routeStepSurface') || drag.card;
      const rect = surface.getBoundingClientRect();
      drag.width = rect.width;
      drag.height = rect.height;
      const ghost = surface.cloneNode(true);
      ghost.classList.remove('selected', 'dragging', 'insertionPreview');
      ghost.classList.add('scenarioDragGhost');
      ghost.setAttribute('aria-hidden', 'true');
      ghost.inert = true;
      ghost.removeAttribute('id');
      ghost.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
      ghost.style.width = `${rect.width}px`;
      ghost.style.height = `${rect.height}px`;
      ghost.style.transform = `translate3d(${rect.left}px, ${rect.top}px, 0) scale(1)`;
      document.body.append(ghost);
      drag.ghost = ghost;
      drag.card.classList.add('scenarioDragSource');
      drag.root.setPointerCapture(drag.id);
      frame = requestAnimationFrame(scrollFrame);
    }
    event.preventDefault();
    paint();
  }, { passive: false });
  // Capture release before controls/containers can stop its propagation.
  window.addEventListener('pointerup', event => {
    if (drag?.id !== event.pointerId) return;
    drag.x = event.clientX;
    drag.y = event.clientY;
    finish(true);
  }, true);
  window.addEventListener('pointercancel', event => { if (drag?.id === event.pointerId) finish(); }, true);
  // A capture transfer (e.g. implicit touch capture -> shelf) is not a cancellation.
  // Keep listening globally until release, pointercancel, Escape or window blur.
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && drag) { event.preventDefault(); finish(); } });
  window.addEventListener('blur', () => finish());
  window.addEventListener('hashchange', () => finish());
  for (const root of [board, shelf]) {
    root.addEventListener('dragstart', event => event.preventDefault());
    root.addEventListener('click', event => {
      if (performance.now() < suppressClickUntil) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
  }
  return { isDragging: () => Boolean(drag?.ghost) };
}
