export interface IrodoriSpeechRequest {
  text?: unknown;
  voice?: unknown;
  speed?: unknown;
  caption?: unknown;
  quality?: unknown;
  attackFadeMs?: unknown;
}

export type IrodoriQuality = 'turbo' | 'draft' | 'standard' | 'high';

export interface IrodoriStreamChunk {
  text: string;
  audioBase64: string;
}

export interface IrodoriApiPayload {
  model: 'irodori-tts';
  input: string;
  voice: string;
  response_format: 'wav';
  stream_format: 'sse';
  speed: number;
  irodori: {
    chunking_enabled: true;
    chunk_min_chars: 1;
    first_sentence_chunk_min_chars: 1;
    num_steps: number;
    t_schedule_mode?: 'sway';
    sway_coeff?: number;
    caption?: string;
  };
}

export function irodoriPauseMs(text: string): number {
  const ending = text.match(/([。、，,．.!！?？…\n\r]+)\s*$/u)?.[1] ?? '';
  if (!ending) return 0;
  if (/[\n\r]/u.test(ending)) return 750;
  if (/[…]/u.test(ending)) return 800;
  if (/[!！?？]/u.test(ending)) return 650;
  if (/[。．.]/u.test(ending)) return 2080;
  if (/[、，,]/u.test(ending)) return 560;
  return 0;
}

export function irodoriAttackFadeMs(value: unknown): number {
  const requested = Number(value);
  if (!Number.isFinite(requested)) return 40;
  return Math.round(Math.max(0, Math.min(120, requested)));
}

export function parseIrodoriSse(value: string): IrodoriStreamChunk[] {
  const chunks: IrodoriStreamChunk[] = [];
  for (const block of value.split(/\r?\n\r?\n/u)) {
    const lines = block.split(/\r?\n/u);
    if (!lines.some(line => line.trim() === 'event: audio_chunk')) continue;
    const json = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n');
    if (!json) continue;
    const data = JSON.parse(json) as { text?: unknown; audio_base64?: unknown };
    const text = String(data.text ?? '');
    const audioBase64 = String(data.audio_base64 ?? '');
    if (!audioBase64) throw new Error('Irodori-TTSの音声チャンクが空です');
    chunks.push({ text, audioBase64 });
  }
  return chunks;
}

export function splitIrodoriText(value: unknown, maxChars = 4000): string[] {
  const text = String(value ?? '').trim();
  if (!text) return [];
  if (!Number.isInteger(maxChars) || maxChars < 1) throw new Error('分割文字数が不正です');

  const remaining = Array.from(text);
  const chunks: string[] = [];
  const breakChars = new Set(['\n', '。', '！', '？', '!', '?', '；', ';', '、', '，', ',', '．', '.']);
  while (remaining.length > maxChars) {
    const minimumBreak = Math.floor(maxChars * .55);
    let breakAt = maxChars;
    for (let index = maxChars - 1; index >= minimumBreak; index -= 1) {
      if (breakChars.has(remaining[index] ?? '')) {
        breakAt = index + 1;
        break;
      }
    }
    const chunk = remaining.splice(0, breakAt).join('').trim();
    while (remaining[0]?.trim() === '') remaining.shift();
    if (chunk) chunks.push(chunk);
  }
  const tail = remaining.join('').trim();
  if (tail) chunks.push(tail);
  return chunks;
}

export function irodoriPayload(request: IrodoriSpeechRequest): IrodoriApiPayload {
  const input = String(request.text ?? '').trim();
  if (!input) throw new Error('台本を入力してください');
  const voice = String(request.voice ?? 'none').trim() || 'none';
  if (voice !== 'none' && !/^[\p{Letter}\p{Number}_.-]{1,80}$/u.test(voice)) {
    throw new Error('声IDには英数字、日本語、ハイフン、アンダースコア、ピリオドだけ使用できます');
  }
  const requestedSpeed = Number(request.speed);
  const speed = Number.isFinite(requestedSpeed) ? Math.max(.25, Math.min(4, requestedSpeed)) : 1;
  const caption = String(request.caption ?? '').trim();
  const requestedQuality = String(request.quality ?? 'high');
  const quality: IrodoriQuality = requestedQuality === 'turbo' || requestedQuality === 'draft' || requestedQuality === 'standard'
    ? requestedQuality
    : 'high';
  const numSteps = quality === 'turbo' ? 16 : quality === 'draft' ? 24 : quality === 'standard' ? 40 : 56;
  const irodori: IrodoriApiPayload['irodori'] = {
    chunking_enabled: true,
    chunk_min_chars: 1,
    first_sentence_chunk_min_chars: 1,
    num_steps: numSteps
  };
  if (quality === 'turbo') {
    irodori.t_schedule_mode = 'sway';
    irodori.sway_coeff = -1;
  }
  if (caption) irodori.caption = caption;
  return { model: 'irodori-tts', input, voice, response_format: 'wav', stream_format: 'sse', speed, irodori };
}
