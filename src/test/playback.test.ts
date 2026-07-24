import test from 'node:test';
import assert from 'node:assert/strict';
import { playbackElapsed, playbackRate } from '../public/playback.js';

test('プレビュー速度は1倍・1.5倍・2倍だけを受け付ける', () => {
  assert.equal(playbackRate('1', false), 1);
  assert.equal(playbackRate('1.5', false), 1.5);
  assert.equal(playbackRate('2', false), 2);
  assert.equal(playbackRate('3', false), 1);
});

test('MP4書き出しは速度選択に関係なく1倍に固定する', () => {
  assert.equal(playbackRate('1.5', true), 1);
  assert.equal(playbackRate('2', true), 1);
});

test('倍速プレビューの経過時間を台本時間へ変換する', () => {
  assert.equal(playbackElapsed(10, 4, 1, 100), 14);
  assert.equal(playbackElapsed(10, 4, 1.5, 100), 16);
  assert.equal(playbackElapsed(10, 4, 2, 100), 18);
  assert.equal(playbackElapsed(98, 4, 2, 100), 100);
});
