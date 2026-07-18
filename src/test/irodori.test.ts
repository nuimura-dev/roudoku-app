import test from 'node:test';
import assert from 'node:assert/strict';
import { irodoriAttackFadeMs, irodoriPauseMs, irodoriPayload, parseIrodoriSse, splitIrodoriText } from '../irodori.js';

test('Irodori用の長文分割付きリクエストを作る', () => {
  assert.deepEqual(irodoriPayload({
    text: ' 羅生門を読みます。 ', voice: 'narrator', speed: 1.1, caption: '落ち着いた朗読'
  }), {
    model: 'irodori-tts',
    input: '羅生門を読みます。',
    voice: 'narrator',
    response_format: 'wav',
    stream_format: 'sse',
    speed: 1.1,
    irodori: {
      chunking_enabled: true,
      chunk_min_chars: 1,
      first_sentence_chunk_min_chars: 1,
      num_steps: 56,
      caption: '落ち着いた朗読'
    }
  });
});

test('Irodoriの生成品質をステップ数へ変換する', () => {
  const turbo = irodoriPayload({ text: '超高速', quality: 'turbo' });
  assert.equal(turbo.irodori.num_steps, 16);
  assert.equal(turbo.irodori.t_schedule_mode, 'sway');
  assert.equal(turbo.irodori.sway_coeff, -1);
  assert.equal(irodoriPayload({ text: '下書き', quality: 'draft' }).irodori.num_steps, 24);
  assert.equal(irodoriPayload({ text: '標準', quality: 'standard' }).irodori.num_steps, 40);
  assert.equal(irodoriPayload({ text: '高音質', quality: 'high' }).irodori.num_steps, 56);
});

test('句読点に応じた無音時間を返す', () => {
  assert.equal(irodoriPauseMs('少し待って、'), 560);
  assert.equal(irodoriPauseMs('Wait,'), 560);
  assert.equal(irodoriPauseMs('全角カンマ，'), 560);
  assert.equal(irodoriPauseMs('終わりました。'), 2080);
  assert.equal(irodoriPauseMs('Finished.'), 2080);
  assert.equal(irodoriPauseMs('全角ピリオド．'), 2080);
  assert.equal(irodoriPauseMs('本当ですか？'), 650);
  assert.equal(irodoriPauseMs('段落です。\n'), 750);
  assert.equal(irodoriPauseMs('続けます'), 0);
});

test('語頭フェード時間を既定値と範囲内へ整える', () => {
  assert.equal(irodoriAttackFadeMs(undefined), 40);
  assert.equal(irodoriAttackFadeMs(65.4), 65);
  assert.equal(irodoriAttackFadeMs(-20), 0);
  assert.equal(irodoriAttackFadeMs(999), 120);
});

test('IrodoriのSSE音声チャンクを解析する', () => {
  const sse = 'event: audio_chunk\ndata: {"text":"こんにちは。","audio_base64":"V0FW"}\n\nevent: done\ndata: {"chunks":1}\n\n';
  assert.deepEqual(parseIrodoriSse(sse), [{ text: 'こんにちは。', audioBase64: 'V0FW' }]);
});

test('Irodoriの速度範囲と声IDを検証する', () => {
  assert.equal(irodoriPayload({ text: 'テスト', speed: 99 }).speed, 4);
  assert.equal(irodoriPayload({ text: 'テスト', speed: 0 }).speed, .25);
  assert.throws(() => irodoriPayload({ text: 'テスト', voice: '../voice' }));
  assert.throws(() => irodoriPayload({ text: '  ' }));
});

test('Irodoriの上限内で句読点を優先して長文を分割する', () => {
  const chunks = splitIrodoriText('あ'.repeat(2500) + '。' + 'い'.repeat(2000), 4000);
  assert.deepEqual(chunks, ['あ'.repeat(2500) + '。', 'い'.repeat(2000)]);
  assert.ok(chunks.every(chunk => Array.from(chunk).length <= 4000));
});

test('区切りがない長文も上限で分割する', () => {
  const chunks = splitIrodoriText('読'.repeat(8500), 4000);
  assert.deepEqual(chunks.map(chunk => chunk.length), [4000, 4000, 500]);
});
