import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectBundle, readProjectBundle } from '../public/project-bundle.js';

test('プロジェクト設定と音声を一つのファイルへ保存して復元できる', async () => {
  const project = { format: 'roudoku-app-project', version: 1, fields: { workTitle: '羅生門' } };
  const sourceAudio = new Blob([new Uint8Array([82, 73, 70, 70, 1, 2, 3])], { type: 'audio/wav' });
  const bundle = createProjectBundle(project, { blob: sourceAudio, name: '羅生門.wav' });
  const restored = await readProjectBundle(bundle);

  assert.deepEqual(restored?.project, project);
  assert.equal(restored?.audio.name, '羅生門.wav');
  assert.equal(restored?.audio.blob.type, 'audio/wav');
  assert.deepEqual(new Uint8Array(await restored?.audio.blob.arrayBuffer()), new Uint8Array([82, 73, 70, 70, 1, 2, 3]));
});

test('従来のJSONはバンドルとして誤認しない', async () => {
  const json = new Blob([JSON.stringify({ format: 'roudoku-app-project', version: 1 })], { type: 'application/json' });
  assert.equal(await readProjectBundle(json), null);
});

test('音声サイズが一致しない壊れたファイルを拒否する', async () => {
  const bundle = createProjectBundle({ format: 'roudoku-app-project' }, {
    blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/wav' }),
    name: 'test.wav'
  });
  const broken = bundle.slice(0, bundle.size - 1, bundle.type);
  await assert.rejects(readProjectBundle(broken), /音声データが壊れています/);
});
