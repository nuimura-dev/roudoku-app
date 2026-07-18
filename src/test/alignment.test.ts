import test from 'node:test';
import assert from 'node:assert/strict';
import { matchTimelineAnchors } from '../public/alignment.js';

test('台本にない余分な長い無音を飛ばして時刻を対応させる', () => {
  const expected = [865.361, 875.932, 884.873, 894.177];
  const candidates = [861.399, 872.332, 874.474, 881.215, 890.882];
  assert.deepEqual(matchTimelineAnchors(expected, candidates), [0, 2, 3, 4]);
});

test('句点直後の無音を残し、その後の長い間を候補から除外できる', () => {
  const minimumPeriodPause = 1.8;
  const silences = [
    { end: 872.332, duration: 2.240 },
    { end: 874.474, duration: 1.781 },
    { end: 881.215, duration: 2.297 }
  ];
  assert.deepEqual(silences.filter(silence => silence.duration >= minimumPeriodPause).map(silence => silence.end), [872.332, 881.215]);
});

test('候補不足時は存在する時刻を先頭から使用する', () => {
  assert.deepEqual(matchTimelineAnchors([10, 20, 30], [11, 21]), [0, 1]);
});
