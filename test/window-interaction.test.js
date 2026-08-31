const assert = require('node:assert/strict');
const test = require('node:test');

const {
  clampWindowBounds,
  isPointInRegions,
  moveWindowBounds,
  resizeWindowBounds
} = require('../src/window-interaction');

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

test('explicit window movement follows the pointer and stays on the display', () => {
  const workArea = { x: 0, y: 0, width: 1200, height: 800 };
  const startBounds = { x: 100, y: 80, width: 500, height: 400 };

  assert.deepEqual(
    moveWindowBounds(startBounds, { x: 130, y: 100 }, { x: 300, y: 240 }, workArea),
    { x: 270, y: 220, width: 500, height: 400 }
  );
  assert.deepEqual(
    moveWindowBounds(startBounds, { x: 130, y: 100 }, { x: -1000, y: -1000 }, workArea),
    { x: -436, y: 0, width: 500, height: 400 }
  );
  assert.deepEqual(
    moveWindowBounds(startBounds, { x: 130, y: 100 }, { x: 2000, y: 2000 }, workArea),
    { x: 1136, y: 740, width: 500, height: 400 }
  );
});

test('window resizing works from every edge and corner', () => {
  const workArea = { x: 0, y: 0, width: 1200, height: 800 };
  const startBounds = { x: 200, y: 150, width: 500, height: 400 };
  assert.deepEqual(
    resizeWindowBounds(startBounds, { x: 700, y: 550 }, { x: 820, y: 640 }, 'se', workArea),
    { x: 200, y: 150, width: 620, height: 490 }
  );
  assert.deepEqual(
    resizeWindowBounds(startBounds, { x: 200, y: 150 }, { x: 100, y: 80 }, 'nw', workArea),
    { x: 100, y: 80, width: 600, height: 470 }
  );
  assert.deepEqual(
    resizeWindowBounds(startBounds, { x: 700, y: 350 }, { x: 760, y: 350 }, 'e', workArea),
    { x: 200, y: 150, width: 560, height: 400 }
  );
  assert.deepEqual(
    resizeWindowBounds(startBounds, { x: 450, y: 550 }, { x: 450, y: 610 }, 's', workArea),
    { x: 200, y: 150, width: 500, height: 460 }
  );
  assert.deepEqual(
    resizeWindowBounds(startBounds, { x: 700, y: 550 }, { x: 1500, y: 1000 }, 'se', workArea),
    { x: 200, y: 150, width: 1300, height: 850 }
  );
});
