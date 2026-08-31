function clampWindowBounds(bounds, workArea) {
  const width = Math.min(Math.max(1, Math.round(bounds.width)), workArea.width);
  const height = Math.min(Math.max(1, Math.round(bounds.height)), workArea.height);
  const maxX = workArea.x + workArea.width - width;
  const maxY = workArea.y + workArea.height - height;

  return {
    x: Math.max(workArea.x, Math.min(Math.round(bounds.x), maxX)),
    y: Math.max(workArea.y, Math.min(Math.round(bounds.y), maxY)),
    width,
    height
  };
}

function clampWindowPosition(bounds, workArea, visibleWidth = 64, visibleHeight = 60) {
  const width = Math.max(1, Math.round(bounds.width));
  const height = Math.max(1, Math.round(bounds.height));
  const reachableWidth = Math.min(width, visibleWidth);
  const reachableHeight = Math.min(height, visibleHeight);
  const minX = workArea.x - width + reachableWidth;
  const maxX = workArea.x + workArea.width - reachableWidth;
  const minY = workArea.y;
  const maxY = workArea.y + workArea.height - reachableHeight;

  return {
    x: Math.max(minX, Math.min(Math.round(bounds.x), maxX)),
    y: Math.max(minY, Math.min(Math.round(bounds.y), maxY)),
    width,
    height
  };
}

function isPointInRegions(point, regions) {
  return (regions || []).some((region) => (
    point.x >= region.x &&
    point.y >= region.y &&
    point.x <= region.x + region.width &&
    point.y <= region.y + region.height
  ));
}

function moveWindowBounds(startBounds, startPoint, point, workArea) {
  return clampWindowPosition({
    ...startBounds,
    x: startBounds.x + point.x - startPoint.x,
    y: startBounds.y + point.y - startPoint.y
  }, workArea);
}

function resizeWindowBounds(startBounds, startPoint, point, edge, workArea) {
  const dx = Math.round(point.x - startPoint.x);
  const dy = Math.round(point.y - startPoint.y);
  let left = startBounds.x;
  let top = startBounds.y;
  let right = startBounds.x + startBounds.width;
  let bottom = startBounds.y + startBounds.height;

  if (edge.includes('w')) left = Math.min(right - 1, left + dx);
  if (edge.includes('e')) right = Math.max(left + 1, right + dx);
  if (edge.includes('n')) top = Math.max(workArea.y, Math.min(bottom - 1, top + dy));
  if (edge.includes('s')) bottom = Math.max(top + 1, bottom + dy);

  return {
    x: Math.round(left),
    y: Math.round(top),
    width: Math.max(1, Math.round(right - left)),
    height: Math.max(1, Math.round(bottom - top))
  };
}

module.exports = {
  clampWindowBounds,
  clampWindowPosition,
  isPointInRegions,
  moveWindowBounds,
  resizeWindowBounds
};
