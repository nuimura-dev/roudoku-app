import test from 'node:test';
import assert from 'node:assert/strict';
import { matchNearestTimelineAnchors, matchTimelineAnchors } from '../public/alignment.js';

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

test('長い一文の読点を照合し、途中の余分な息継ぎを飛ばす', () => {
  const expected = [2.81, 4.41, 9.62, 13.23, 17.83, 21.64, 25.65, 29.66, 31.26, 34.47, 35.67];
  const silences = [2.99, 4.70, 9.23, 10.40, 12.87, 17.31, 21.73, 25.26, 29.50, 31.33, 34.16, 36.16];
  assert.deepEqual(matchTimelineAnchors(expected, silences), [0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11]);
});

test('読点の無音が不足しても対応する台本側の位置を選べる', () => {
  const detectedSilences = [2.1, 6.1, 8.1];
  const expectedCommas = [2, 4, 6, 8];
  assert.deepEqual(matchTimelineAnchors(detectedSilences, expectedCommas), [0, 2, 3]);
});

test('各読点を近い無音へ割り当て、隣の読点への一行ずれを防ぐ', () => {
  const expected = [393.828, 395.284, 400.016, 403.292];
  const silences = [393.64, 395.38, 399.5, 402.54, 406.72];
  assert.deepEqual(matchNearestTimelineAnchors(expected, silences), [0, 1, 2, 3]);
});
