export const EXPRESSIONS = ['neutral', 'happy', 'sad', 'angry', 'surprised'] as const;

export type Expression = typeof EXPRESSIONS[number];
export interface ScriptSegment { expression: Expression; text: string }
export interface CaptionCue { text: string; rubyText: string; spoken: string; weight: number }
export interface ActiveCaption { text: string; progress: number; index: number }
export interface EnglishRubyCandidate { word: string; reading: string; count: number }

const latinLetterReadings: Record<string, string> = {
  A: 'エー', B: 'ビー', C: 'シー', D: 'ディー', E: 'イー', F: 'エフ', G: 'ジー', H: 'エイチ', I: 'アイ',
  J: 'ジェー', K: 'ケー', L: 'エル', M: 'エム', N: 'エヌ', O: 'オー', P: 'ピー', Q: 'キュー', R: 'アール',
  S: 'エス', T: 'ティー', U: 'ユー', V: 'ブイ', W: 'ダブリュー', X: 'エックス', Y: 'ワイ', Z: 'ゼット'
};

const latinDigitReadings: Record<string, string> = {
  '0': 'ゼロ', '1': 'ワン', '2': 'ツー', '3': 'スリー', '4': 'フォー',
  '5': 'ファイブ', '6': 'シックス', '7': 'セブン', '8': 'エイト', '9': 'ナイン'
};

const commonLatinReadings: Record<string, string> = {
  ai: 'エーアイ', cpu: 'シーピーユー', gpu: 'ジーピーユー', http: 'エイチティーティーピー',
  https: 'エイチティーティーピーエス', mp3: 'エムピースリー', mp4: 'エムピーフォー',
  tts: 'ティーティーエス', url: 'ユーアールエル', vr: 'ブイアール',
  reader: 'リーダー', hello: 'ハロー', world: 'ワールド', english: 'イングリッシュ'
};

function latinReading(token: string): string {
  const common = commonLatinReadings[token.toLowerCase()];
  if (common) return common;
  return [...token].map(character => latinLetterReadings[character.toUpperCase()] ?? latinDigitReadings[character] ?? character).join('');
}

export function englishRubyCandidates(source: unknown): EnglishRubyCandidate[] {
  const counts = new Map<string, number>();
  String(source ?? '').replace(
    /｜[^《\n]+《[^》\n]+》|\[(?:neutral|happy|sad|angry|surprised)\]|[A-Za-z][A-Za-z0-9]*/gi,
    token => {
      if (!token.startsWith('｜') && !token.startsWith('[')) counts.set(token, (counts.get(token) ?? 0) + 1);
      return token;
    }
  );
  return [...counts].map(([word, count]) => ({ word, reading: latinReading(word), count }));
}

export function applyEnglishRuby(source: unknown, readings: Readonly<Record<string, string>>): string {
  return String(source ?? '').replace(
    /｜[^《\n]+《[^》\n]+》|\[(?:neutral|happy|sad|angry|surprised)\]|[A-Za-z][A-Za-z0-9]*/gi,
    token => {
      if (token.startsWith('｜') || token.startsWith('[')) return token;
      const reading = readings[token]?.trim();
      return reading ? `｜${token}《${reading}》` : token;
    }
  );
}

export function applyJapaneseRubyCorrections(source: unknown, readings: Readonly<Record<string, string>>): string {
  const entries = Object.entries(readings)
    .map(([word, reading]) => [word.trim(), reading.trim()] as const)
    .filter(([word, reading]) => word && reading && !/[｜《》\[\]\r\n]/u.test(word))
    .sort((left, right) => [...right[0]].length - [...left[0]].length);
  if (!entries.length) return String(source ?? '');
  const escaped = entries.map(([word]) => word.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'));
  const replacement = new RegExp(escaped.join('|'), 'gu');
  const readingByWord = new Map(entries);
  return String(source ?? '').replace(
    /｜[^《\n]+《[^》\n]+》|[\p{Script=Han}々〆ヵヶ]+《[^》\n]+》|\[(?:neutral|happy|sad|angry|surprised)\]|[^｜\[\n]+|./giu,
    token => {
      if (token.startsWith('｜') || token.startsWith('[') || /《[^》\n]+》$/u.test(token)) return token;
      return token.replace(replacement, word => `｜${word}《${readingByWord.get(word)!}》`);
    }
  );
}

export function parseScript(source: unknown): ScriptSegment[] {
  const text = String(source || '');
  const marks = [...text.matchAll(/\[(neutral|happy|sad|angry|surprised)\]/gi)];
  const segments: ScriptSegment[] = [];
  let expression: Expression = 'neutral';
  let cursor = 0;
  for (const mark of marks) {
    const content = text.slice(cursor, mark.index).trim();
    if (content) segments.push({ expression, text: content });
    expression = mark[1]!.toLowerCase() as Expression;
    cursor = mark.index + mark[0].length;
  }
  const rest = text.slice(cursor).trim();
  if (rest) segments.push({ expression, text: rest });
  return segments.length ? segments : [{ expression: 'neutral', text: '' }];
}

export function plainText(source: unknown): string {
  return parseScript(source).map(item => item.text).filter(Boolean).join(' ')
    .replace(/｜([^《\n]+)《([^》\n]+)》/g, '$2')
    .replace(/([\p{Script=Han}々〆ヵヶ]+)《([^》\n]+)》/gu, '$2')
    .replace(/[A-Za-z][A-Za-z0-9]*/g, latinReading);
}

export function displayText(source: unknown): string {
  return parseScript(source).map(item => item.text).filter(Boolean).join(' ')
    .replace(/｜([^《\n]+)《([^》\n]+)》/g, '$1')
    .replace(/([\p{Script=Han}々〆ヵヶ]+)《([^》\n]+)》/gu, '$1');
}

function captionPauseWeight(text: string): number {
  let weight = 0;
  for (const match of text.matchAll(/[\n\r]+|…+|[!！?？]+|[。．.]+|[、，,]+/gu)) {
    const punctuation = match[0];
    if (/[\n\r]/u.test(punctuation)) weight += 4;
    else if (/…/u.test(punctuation)) weight += 4.5;
    else if (/[!！?？]/u.test(punctuation)) weight += 3.6;
    else if (/[。．.]/u.test(punctuation)) weight += 11.4;
    else if (/[、，,]/u.test(punctuation)) weight += 3;
  }
  return weight;
}

export function captionCues(source: unknown): CaptionCue[] {
  const rawSource = parseScript(source).map(item => item.text).filter(Boolean).join(' ');
  const units = [...rawSource.matchAll(/｜([^《\n]+)《([^》\n]+)》|([\p{Script=Han}々〆ヵヶ]+)《([^》\n]+)》|./gsu)].map(match => ({
    display: match[1] ?? match[3] ?? match[0],
    spoken: match[2] ?? match[4] ?? match[0],
    rubyText: match[0]
  }));
  const cues: CaptionCue[] = [];
  const strong = new Set(['。', '．', '.', '!', '！', '?', '？', '…']);
  const comma = new Set(['、', '，', ',']);
  const closingMarks = new Set(['」', '』', '）', ')', '】', '］', ']', '”', '’']);
  let current = '';
  let rubyText = '';
  let spoken = '';
  let visibleChars = 0;
  const push = (): void => {
    const text = current.replace(/\s+/gu, ' ').trim();
    const annotatedText = rubyText.replace(/\s+/gu, ' ').trim();
    const spokenText = spoken;
    current = '';
    rubyText = '';
    spoken = '';
    visibleChars = 0;
    if (text) {
      const spokenValue = plainText(spokenText);
      cues.push({ text, rubyText: annotatedText, spoken: spokenValue, weight: Math.max(1, [...spokenValue].length + captionPauseWeight(spokenText)) });
    } else {
      const blankPause = captionPauseWeight(spokenText);
      const previous = cues.at(-1);
      if (previous && blankPause > 0) previous.weight += blankPause;
    }
  };

  units.forEach((unit, index) => {
    current += unit.display;
    rubyText += unit.rubyText;
    spoken += unit.spoken;
    if (!/\s/u.test(unit.display)) visibleChars += [...unit.display].length;
    const character = [...unit.display].at(-1) ?? '';
    const next = units[index + 1]?.display[0];
    const previous = [...(units[index - 1]?.display ?? '')].at(-1);
    const strongEnd = strong.has(character) && (!next || (!strong.has(next) && !closingMarks.has(next)));
    const closingEnd = closingMarks.has(character)
      && Boolean(previous && (strong.has(previous) || closingMarks.has(previous)))
      && (!next || !closingMarks.has(next));
    if (strongEnd || closingEnd || /[\n\r]/u.test(character) || (comma.has(character) && visibleChars >= 18) || visibleChars >= 34) push();
  });
  push();
  return cues;
}

export function activeCaption(cues: readonly CaptionCue[], progress: number): ActiveCaption | null {
  if (cues.length === 0) return null;
  const total = cues.reduce((sum, cue) => sum + cue.weight, 0);
  const target = Math.max(0, Math.min(.999999, progress)) * total;
  let before = 0;
  for (const cue of cues) {
    const after = before + cue.weight;
    if (target < after) return { text: cue.text, progress: (target - before) / cue.weight, index: cues.indexOf(cue) };
    before = after;
  }
  return { text: cues.at(-1)!.text, progress: 1, index: cues.length - 1 };
}

export function expressionAt(source: unknown, progress: number): Expression {
  const segments = parseScript(source);
  const weights = segments.map(item => Math.max(1, [...item.text].length));
  const target = Math.max(0, Math.min(0.999999, progress)) * weights.reduce((a, b) => a + b, 0);
  let total = 0;
  for (let i = 0; i < segments.length; i += 1) {
    total += weights[i]!;
    if (target < total) return segments[i]!.expression;
  }
  return segments.at(-1)!.expression;
}

export function isPunctuationPause(source: unknown, progress: number): boolean {
  const characters = [...plainText(source)];
  if (!characters.length) return false;
  const cursor = Math.max(0, Math.min(1, progress)) * characters.length;
  const commaMarks = new Set(['、', ',', '，']);
  const periodMarks = new Set(['。', '.', '．']);

  return characters.some((character, index) => {
    const pauseLength = commaMarks.has(character) ? 1 : periodMarks.has(character) ? 1.8 : 0;
    return pauseLength > 0 && cursor >= index - 0.1 && cursor < index + pauseLength;
  });
}
