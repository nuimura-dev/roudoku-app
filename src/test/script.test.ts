import test from 'node:test';
import assert from 'node:assert/strict';
import { activeCaption, applyEnglishRuby, applyJapaneseRubyCorrections, captionCues, captionTimesFromSpeechTimeline, displayText, englishRubyCandidates, expressionAt, isPunctuationPause, parseScript, parseSpeechTimeline, plainText, replaceCaptionTimeRange } from '../public/script.js';

test('表情タグ付き台本を解析する', () => {
  assert.deepEqual(parseScript('こんにちは。[happy]うれしい！[sad]でも少し残念。'), [
    { expression: 'neutral', text: 'こんにちは。' },
    { expression: 'happy', text: 'うれしい！' },
    { expression: 'sad', text: 'でも少し残念。' }
  ]);
});

test('VOICEVOX用テキストからタグを除去する', () => {
  assert.equal(plainText('[happy]おはよう。[angry]もう！'), 'おはよう。 もう！');
});

test('青空文庫のルビをVOICEVOX用の読みに変換する', () => {
  assert.equal(plainText('｜羅生門《らしょうもん》で下人《げにん》が待つ。'), 'らしょうもんでげにんが待つ。');
});

test('英字は音声用の読みに変換し、字幕では元の表記を保つ', () => {
  const spoken = 'ブイアール リーダーとエムピーフォー。';
  assert.equal(plainText('VR ReaderとMP4。'), spoken);
  assert.equal(displayText('VR ReaderとMP4。'), 'VR ReaderとMP4。');
  const cue = captionCues('VR ReaderとMP4。')[0]!;
  assert.equal(cue.text, 'VR ReaderとMP4。');
  assert.equal(cue.weight, [...spoken].length + 11.4);
});

test('英語の固有名詞はルビで自然な読みを指定できる', () => {
  assert.equal(plainText('｜London《ロンドン》へ行く。'), 'ロンドンへ行く。');
  assert.equal(displayText('｜London《ロンドン》へ行く。'), 'Londonへ行く。');
  const cue = captionCues('｜London《ロンドン》へ行く。')[0]!;
  assert.equal(cue.text, 'Londonへ行く。');
  assert.equal(cue.rubyText, '｜London《ロンドン》へ行く。');
  assert.equal(cue.spoken, 'ロンドンへ行く。');
  assert.equal(cue.weight, [...'ロンドンへ行く。'].length + 11.4);
});

test('台本の英単語を集計し、編集した読みを一括反映する', () => {
  const source = '[happy]LondonとLondon、｜Paris《パリ》、MP4。';
  assert.deepEqual(englishRubyCandidates(source), [
    { word: 'London', reading: 'エルオーエヌディーオーエヌ', count: 2 },
    { word: 'MP4', reading: 'エムピーフォー', count: 1 }
  ]);
  assert.equal(
    applyEnglishRuby(source, { London: 'ロンドン', MP4: 'エムピーフォー' }),
    '[happy]｜London《ロンドン》と｜London《ロンドン》、｜Paris《パリ》、｜MP4《エムピーフォー》。'
  );
});

test('複数の漢字へ読みを一括反映し、既存ルビは維持する', () => {
  const source = '顧みる者はいない。顧みる。｜顧みる《別のよみ》。狐狸が棲む。';
  assert.equal(
    applyJapaneseRubyCorrections(source, { 顧みる: 'かえりみる', 狐狸: 'こり', 棲む: 'すむ' }),
    '｜顧みる《かえりみる》者はいない。｜顧みる《かえりみる》。｜顧みる《別のよみ》。｜狐狸《こり》が｜棲む《すむ》。'
  );
});

test('漢字を含むフレーズ全体へ読みを指定できる', () => {
  assert.equal(
    applyJapaneseRubyCorrections('作品名、羅生門。羅生門の下で待つ。', { '作品名、羅生門': 'さくひん、らしょうもん' }),
    '｜作品名、羅生門《さくひん、らしょうもん》。羅生門の下で待つ。'
  );
});

test('文字量に応じて現在の表情を返す', () => {
  assert.equal(expressionAt('[happy]123456[sad]12', 0.5), 'happy');
  assert.equal(expressionAt('[happy]123456[sad]12', 0.9), 'sad');
});

test('読点と句点の位置でリップシンクを休止する', () => {
  const script = 'あ、い。';
  assert.equal(isPunctuationPause(script, 0.05), false);
  assert.equal(isPunctuationPause(script, 0.3), true);
  assert.equal(isPunctuationPause(script, 0.65), false);
  assert.equal(isPunctuationPause(script, 0.9), true);
  assert.equal(isPunctuationPause('a,b.', 0.35), true);
  assert.equal(isPunctuationPause('a,b.', 0.9), true);
});

test('生成時チャンクを字幕の開始終了時刻へ変換する', () => {
  const cues = captionCues('あいう、えお。');
  const chunks = parseSpeechTimeline('4:2000,3:5000');
  assert.ok(chunks);
  assert.deepEqual(captionTimesFromSpeechTimeline(cues, chunks, 5), [0, 2, 5]);
  assert.equal(parseSpeechTimeline('4:2000,bad'), null);
});

test('一文の差し替え時間を後続字幕へ反映する', () => {
  assert.deepEqual(
    replaceCaptionTimeRange([0, 2, 5, 9], 1, 1, [0, 4]),
    [0, 2, 6, 10]
  );
  assert.deepEqual(
    replaceCaptionTimeRange([0, 2, 5, 9], 1, 2, [0, 1, 5]),
    [0, 2, 3, 7]
  );
});

test('朗読字幕を句点ごとの区間へ分ける', () => {
  const cues = captionCues('風が吹いた。雲が流れていく！静かな夜。');
  assert.deepEqual(cues.map(cue => cue.text), ['風が吹いた。', '雲が流れていく！', '静かな夜。']);
  assert.equal(cues[0]?.weight, 17.4);
  assert.equal(activeCaption(cues, 0)?.text, '風が吹いた。');
  assert.equal(activeCaption(cues, 0)?.index, 0);
  assert.equal(activeCaption(cues, .999)?.text, '静かな夜。');
  assert.equal(activeCaption(cues, .999)?.index, 2);
});

test('読点の無音に合わせて字幕の表示時間を延ばす', () => {
  const beforeComma = `${'あ'.repeat(18)}、`;
  const cues = captionCues(`${beforeComma}次の文章へ続きます。`);
  assert.equal(cues[0]?.text, beforeComma);
  assert.equal(cues[0]?.weight, 22);
});

test('各読点の字幕へ音声の無音時間を加算する', () => {
  const cues = captionCues('洛中がその始末であるから、羅生門の修理などは、');
  assert.deepEqual(cues.map(cue => cue.text), ['洛中がその始末であるから、', '羅生門の修理などは、']);
  assert.deepEqual(cues.map(cue => cue.weight), [
    [...'洛中がその始末であるから、'].length + 3,
    [...'羅生門の修理などは、'].length + 3
  ]);
});

test('句読点直後の全角空白を音声と字幕で同じように扱う', () => {
  const source = '振りして、いつでも大変な贅沢を言い、　その後も話は続く。';
  assert.equal(plainText(source), '振りして、いつでも大変な贅沢を言い、その後も話は続く。');
  assert.deepEqual(captionCues(source).map(cue => cue.spoken), [
    '振りして、',
    'いつでも大変な贅沢を言い、',
    'その後も話は続く。'
  ]);
});

test('段落間の連続改行を直前の字幕時間へ加算する', () => {
  const cues = captionCues('最初の段落。\n\n次の段落。');
  assert.equal(cues[0]?.weight, [...'最初の段落。'].length + 11.4 + 8);
  assert.equal(cues[1]?.text, '次の段落。');
});

test('閉じかぎ括弧を直前の字幕へ含める', () => {
  const cues = captionCues('「風が吹いた。」彼女は空を見た。');
  assert.deepEqual(cues.map(cue => cue.text), ['「風が吹いた。」', '彼女は空を見た。']);
});

test('無音のない長文を文字数だけでは分割しない', () => {
  const cues = captionCues('あ'.repeat(40) + '。');
  assert.deepEqual(cues.map(cue => cue.text), ['あ'.repeat(40) + '。']);
});

test('長文は実際に間ができる読点で分割する', () => {
  const cues = captionCues('お礼を言わぬどころか、あの人は、私のこんな隠れた日々の苦労をも知らぬ振りして、いつでも大変な贅沢を言い、五つのパンと魚が二つ在るきりの時でさえ、');
  assert.deepEqual(cues.map(cue => cue.text), [
    'お礼を言わぬどころか、',
    'あの人は、',
    '私のこんな隠れた日々の苦労をも知らぬ振りして、',
    'いつでも大変な贅沢を言い、',
    '五つのパンと魚が二つ在るきりの時でさえ、'
  ]);
});
