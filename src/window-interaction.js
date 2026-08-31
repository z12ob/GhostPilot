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

function isPointInRegions(point, regions) {
  return (regions || []).some((region) => (
    point.x >= region.x &&
    point.y >= region.y &&
    point.x <= region.x + region.width &&
    point.y <= region.y + region.height
  ));
}

module.exports = { clampWindowBounds, isPointInRegions };
