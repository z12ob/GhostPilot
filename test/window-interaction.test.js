const assert = require('node:assert/strict');
const test = require('node:test');

const { clampWindowBounds, isPointInRegions } = require('../src/window-interaction');

test('window bounds keep the complete toolbar window inside the work area', () => {
  const workArea = { x: 0, y: 0, width: 1920, height: 1040 };

  assert.deepEqual(
    clampWindowBounds({ x: 1900, y: 1020, width: 560, height: 500 }, workArea),
    { x: 1360, y: 540, width: 560, height: 500 }
  );
  assert.deepEqual(
    clampWindowBounds({ x: -500, y: -80, width: 560, height: 500 }, workArea),
    { x: 0, y: 0, width: 560, height: 500 }
  );
});

test('window bounds handle a work area smaller than the saved window', () => {
  assert.deepEqual(
    clampWindowBounds(
      { x: 20, y: 30, width: 900, height: 700 },
      { x: 100, y: 50, width: 640, height: 480 }
    ),
    { x: 100, y: 50, width: 640, height: 480 }
  );
});

test('interactive regions use renderer-local cursor coordinates', () => {
  const regions = [{ x: 120, y: 14, width: 320, height: 44 }];

  assert.equal(isPointInRegions({ x: 150, y: 30 }, regions), true);
  assert.equal(isPointInRegions({ x: 20, y: 200 }, regions), false);
  assert.equal(isPointInRegions({ x: 120, y: 14 }, regions), true);
});
