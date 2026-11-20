import test from 'node:test';
import assert from 'node:assert/strict';
import {
  IMPORT_STAGES,
  buildImportProgressState,
  calculateStageProgress,
  formatImportProgressCounter,
  yieldToMainThread,
} from './importProgress';

test('IMPORT_STAGES defines the 4 required stages in order', () => {
  assert.equal(IMPORT_STAGES.length, 4);
  assert.deepEqual(
    IMPORT_STAGES.map((s) => s.id),
    ['parsing', 'validating', 'saving_local', 'syncing_cloud']
  );
  assert.deepEqual(
    IMPORT_STAGES.map((s) => s.stepNumber),
    [1, 2, 3, 4]
  );
});

test('calculateStageProgress advances monotonically across all 4 stages with cloud sync', () => {
  const p0 = calculateStageProgress('parsing', 0, 1000, true);
  const p1 = calculateStageProgress('parsing', 500, 1000, true);
  const p2 = calculateStageProgress('parsing', 1000, 1000, true);
  const v1 = calculateStageProgress('validating', 500, 1000, true);
  const v2 = calculateStageProgress('validating', 1000, 1000, true);
  const s1 = calculateStageProgress('saving_local', 500, 1000, true);
  const s2 = calculateStageProgress('saving_local', 1000, 1000, true);
  const c1 = calculateStageProgress('syncing_cloud', 500, 1000, true);
  const c2 = calculateStageProgress('syncing_cloud', 1000, 1000, true);

  assert.equal(p0, 0);
  assert.ok(p1 > p0 && p1 < p2);
  assert.equal(p2, 15);
  assert.ok(v1 > p2 && v1 < v2);
  assert.equal(v2, 40);
  assert.ok(s1 > v2 && s1 < s2);
  assert.equal(s2, 65);
  assert.ok(c1 > s2 && c1 < c2);
  assert.equal(c2, 100);
});

test('calculateStageProgress reaches 100% at saving_local end when cloud sync is disabled', () => {
  assert.equal(calculateStageProgress('parsing', 100, 100, false), 20);
  assert.equal(calculateStageProgress('validating', 100, 100, false), 55);
  assert.equal(calculateStageProgress('saving_local', 100, 100, false), 100);
});

test('buildImportProgressState clamps out-of-bounds counters cleanly', () => {
  const state = buildImportProgressState({
    stage: 'validating',
    processed: 1500,
    total: 1000,
    hasCloudSync: true,
  });
  assert.equal(state.processed, 1000);
  assert.equal(state.total, 1000);
  assert.equal(state.percent, 40);
  assert.equal(state.labelAr, 'التحقق من صحة البيانات والمحافظ');
});

test('formatImportProgressCounter formats Arabic and English counters accurately', () => {
  const ar = formatImportProgressCounter(350, 1200, 29, true);
  assert.equal(ar, 'تمت معالجة 350 من 1,200 معاملة • 29%');

  const en = formatImportProgressCounter(350, 1200, 29, false);
  assert.equal(en, 'Processed 350 of 1,200 transactions • 29%');

  const preparing = formatImportProgressCounter(0, 0, 5, true);
  assert.equal(preparing, 'جاري التجهيز • 5%');
});

test('yieldToMainThread resolves asynchronously without throwing', async () => {
  let resolved = false;
  const promise = yieldToMainThread().then(() => {
    resolved = true;
  });
  assert.equal(resolved, false);
  await promise;
  assert.equal(resolved, true);
});
