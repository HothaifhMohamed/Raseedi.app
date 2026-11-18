import test from 'node:test';
import assert from 'node:assert/strict';
import { resetElementAndAncestorsScroll, type ScrollableTarget } from './useScrollToTop';

test('resetElementAndAncestorsScroll resets element and all scrollable ancestors to 0', () => {
  const calls: Array<ScrollToOptions> = [];
  const rootParent: ScrollableTarget = {
    scrollTop: 640,
    scrollTo: (opts) => calls.push(opts),
    parentElement: null,
  };
  const middleContainer: ScrollableTarget = {
    scrollTop: 320,
    parentElement: rootParent,
  };
  const leafContainer: ScrollableTarget = {
    scrollTop: 180,
    scrollTo: (opts) => calls.push(opts),
    parentElement: middleContainer,
  };

  resetElementAndAncestorsScroll(leafContainer);

  assert.equal(leafContainer.scrollTop, 0);
  assert.equal(middleContainer.scrollTop, 0);
  assert.equal(rootParent.scrollTop, 0);
  assert.deepEqual(calls, [
    { top: 0, behavior: 'instant' },
    { top: 0, behavior: 'instant' },
  ]);
});

test('resetElementAndAncestorsScroll handles null targets and cyclic parent refs safely', () => {
  assert.doesNotThrow(() => resetElementAndAncestorsScroll(null));
  assert.doesNotThrow(() => resetElementAndAncestorsScroll(undefined));

  const a: ScrollableTarget = { scrollTop: 100 };
  const b: ScrollableTarget = { scrollTop: 200, parentElement: a };
  a.parentElement = b;

  resetElementAndAncestorsScroll(a);
  assert.equal(a.scrollTop, 0);
  assert.equal(b.scrollTop, 0);
});
