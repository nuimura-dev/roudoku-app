import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { extname, isAbsolute, join, relative as relativePath, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { aozoraFirstPublication, aozoraUrl, findAozoraXhtml, isAozoraXhtml } from './aozora.js';
import { irodoriAttackFadeMs, irodoriPauseMs, irodoriPayload, parseIrodoriSse, splitIrodoriText, type IrodoriSpeechRequest } from './irodori.js';

const port = Number(process.env.PORT || 4173);
const publicDir = join(import.meta.dirname, 'public');
const maxUpload = 300 * 1024 * 1024;
const maxVideoUpload = 8 * 1024 * 1024 * 1024;

const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg'
};

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function bodyBuffer(req: IncomingMessage, limit = maxUpload): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('送信データが大きすぎます');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function requestToFile(req: IncomingMessage, path: string, limit: number): Promise<void> {
  const file = await open(path, 'wx');
  let size = 0;
  try {
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > limit) throw new Error('動画データが大きすぎます（上限8GB）');
      await file.write(buffer);
    }
  } finally {
    await file.close();
  }
}

function run(command: string, args: string[], signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'], signal });
    let stderr = '';
    child.stderr.on('data', data => { stderr += data; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(stderr || `${command} exited with ${code}`)));
  });
}

interface VoicevoxRequest { text?: string; speaker?: number; speedScale?: number }
interface VoicevoxQuery { speedScale: number; [key: string]: unknown }
interface AozoraRequest { url?: string }
interface AudioRepairRange { start: number; end: number; size: number }

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function voicevox(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const clientAbort = new AbortController();
  res.once('close', () => { if (!res.writableEnded) clientAbort.abort(); });
  const { text, speaker = 3, speedScale = 1 } = JSON.parse((await bodyBuffer(req, 2 * 1024 * 1024)).toString()) as VoicevoxRequest;
  const spokenText = String(text ?? '');
  if (!spokenText.trim()) return json(res, 400, { error: '台本を入力してください' });
  const base = process.env.VOICEVOX_URL || 'http://127.0.0.1:50021';
  try {
    const queryResponse = await fetch(`${base}/audio_query?text=${encodeURIComponent(spokenText)}&speaker=${speaker}`, { method: 'POST', signal: clientAbort.signal });
    if (!queryResponse.ok) throw new Error(`audio_query: ${queryResponse.status}`);
    const query = await queryResponse.json() as VoicevoxQuery;
    query.speedScale = Number(speedScale) || 1;
    const synthesis = await fetch(`${base}/synthesis?speaker=${speaker}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(query),
      signal: clientAbort.signal
    });
    if (!synthesis.ok) throw new Error(`synthesis: ${synthesis.status}`);
    const audio = Buffer.from(await synthesis.arrayBuffer());
    res.writeHead(200, { 'content-type': 'audio/wav', 'content-length': audio.length });
    res.end(audio);
  } catch (error) {
    if (!clientAbort.signal.aborted && !res.destroyed) json(res, 503, { error: 'VOICEVOXに接続できません。起動状態とVOICEVOX_URLを確認してください。', detail: errorMessage(error) });
  }
}

function irodoriHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const headers = { ...extra };
  const apiKey = process.env.IRODORI_API_KEY?.trim();
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  return headers;
}

function irodoriUrl(path: string): string {
  const base = (process.env.IRODORI_TTS_URL || 'http://127.0.0.1:8088').replace(/\/+$/, '');
  return `${base}${path}`;
}

async function irodoriError(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const data = JSON.parse(text) as { error?: string; detail?: string };
    return data.error ?? data.detail ?? text;
  } catch {
    return text || `HTTP ${response.status}`;
  }
}

async function irodoriHealth(res: ServerResponse): Promise<void> {
  try {
    const response = await fetch(irodoriUrl('/health'), {
      headers: irodoriHeaders(), signal: AbortSignal.timeout(5_000)
    });
    if (!response.ok) throw new Error(await irodoriError(response));
    json(res, 200, { connected: true, server: await response.json() });
  } catch (error) {
    json(res, 503, { connected: false, error: 'Irodori-TTS Serverに接続できません', detail: errorMessage(error) });
  }
}

async function irodoriSpeech(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let audioDir: string | undefined;
  const clientAbort = new AbortController();
  res.once('close', () => { if (!res.writableEnded) clientAbort.abort(); });
  try {
    const request = JSON.parse((await bodyBuffer(req, 4 * 1024 * 1024)).toString()) as IrodoriSpeechRequest;
    const requestedChunkSize = Number(process.env.IRODORI_REQUEST_CHARS ?? 600);
    const chunkSize = Number.isInteger(requestedChunkSize) ? Math.max(200, Math.min(1200, requestedChunkSize)) : 600;
    const textChunks = splitIrodoriText(request.text, chunkSize);
    const attackFadeMs = irodoriAttackFadeMs(request.attackFadeMs);
    if (textChunks.length === 0) throw new Error('台本を入力してください');
    audioDir = await mkdtemp(join(tmpdir(), 'vt-reader-irodori-'));
    const listPath = join(audioDir, 'chunks.txt');
    const outputPath = join(audioDir, 'speech.wav');
    const list: string[] = [];
    const pauseFiles = new Map<number, string>();
    let audioIndex = 0;
    for (const [index, text] of textChunks.entries()) {
      console.info(`Irodori音声を生成中: ${index + 1}/${textChunks.length}`);
      const payload = irodoriPayload({ ...request, text });
      const response = await fetch(irodoriUrl('/v1/audio/speech'), {
        method: 'POST',
        headers: irodoriHeaders({ 'content-type': 'application/json', accept: 'text/event-stream' }),
        body: JSON.stringify(payload),
        signal: AbortSignal.any([clientAbort.signal, AbortSignal.timeout(15 * 60_000)])
      });
      if (!response.ok) {
        const reason = await irodoriError(response);
        throw new Error(`音声 ${index + 1}/${textChunks.length}: ${reason}`);
      }
      const streamChunks = parseIrodoriSse(await response.text());
      if (streamChunks.length === 0) throw new Error(`音声 ${index + 1}/${textChunks.length}: 音声チャンクを受信できませんでした`);
      for (const chunk of streamChunks) {
        const rawName = `chunk-${audioIndex}-raw.wav`;
        const name = attackFadeMs > 0 ? `chunk-${audioIndex}.wav` : rawName;
        await writeFile(join(audioDir, rawName), Buffer.from(chunk.audioBase64, 'base64'));
        if (attackFadeMs > 0) {
          await run('ffmpeg', [
            '-y', '-i', join(audioDir, rawName),
            '-af', `afade=t=in:st=0:d=${attackFadeMs / 1000}:curve=tri`,
            '-c:a', 'pcm_s16le', join(audioDir, name)
          ], clientAbort.signal);
          await rm(join(audioDir, rawName), { force: true });
        }
        list.push(`file '${name}'`);
        const pauseMs = irodoriPauseMs(chunk.text);
        if (pauseMs > 0 && !pauseFiles.has(pauseMs)) {
          const pauseName = `pause-${pauseMs}.wav`;
          await run('ffmpeg', [
            '-y', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono',
            '-t', String(pauseMs / 1000), '-c:a', 'pcm_s16le', join(audioDir, pauseName)
          ], clientAbort.signal);
          pauseFiles.set(pauseMs, pauseName);
        }
        const pauseName = pauseFiles.get(pauseMs);
        if (pauseName) list.push(`file '${pauseName}'`);
        audioIndex += 1;
      }
    }
    await writeFile(listPath, `${list.join('\n')}\n`);
    await run('ffmpeg', [
      '-y', '-f', 'concat', '-safe', '0', '-i', listPath,
      '-vn', '-c:a', 'pcm_s16le', outputPath
    ], clientAbort.signal);
    const audio = await stat(outputPath);
    res.writeHead(200, {
      'content-type': 'audio/wav',
      'content-length': audio.size
    });
    await pipeline(createReadStream(outputPath), res);
  } catch (error) {
    if (!clientAbort.signal.aborted && !res.destroyed && !res.headersSent) {
      json(res, 503, { error: 'Irodori-TTSで音声を生成できませんでした', detail: errorMessage(error) });
    }
  } finally {
    if (audioDir) await rm(audioDir, { recursive: true, force: true });
  }
}

async function irodoriVoiceUpload(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const contentType = req.headers['content-type'];
    if (!contentType?.startsWith('multipart/form-data')) return json(res, 400, { error: '参照音声ファイルが必要です' });
    const body = await bodyBuffer(req, 100 * 1024 * 1024);
    const uploadBody = new Uint8Array(body.length);
    uploadBody.set(body);
    const response = await fetch(irodoriUrl('/v1/audio/voices'), {
      method: 'POST',
      headers: irodoriHeaders({ 'content-type': contentType }),
      body: uploadBody,
      signal: AbortSignal.timeout(5 * 60_000)
    });
    if (!response.ok) throw new Error(await irodoriError(response));
    const responseType = response.headers.get('content-type') || 'application/json; charset=utf-8';
    const data = Buffer.from(await response.arrayBuffer());
    res.writeHead(200, { 'content-type': responseType, 'content-length': data.length });
    res.end(data);
  } catch (error) {
    json(res, 503, { error: '参照音声を登録できませんでした', detail: errorMessage(error) });
  }
}

async function fetchAozora(url: URL): Promise<Response> {
  const response = await fetch(url, {
    headers: { 'user-agent': 'VT Reader/0.1 (Aozora Bunko importer)' },
    redirect: 'follow',
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error(`青空文庫から取得できませんでした（HTTP ${response.status}）`);
  aozoraUrl(response.url);
  return response;
}

async function importAozora(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const request = JSON.parse((await bodyBuffer(req, 64 * 1024)).toString()) as AozoraRequest;
  try {
    const requestedUrl = aozoraUrl(request.url);
    let xhtmlUrl = requestedUrl;
    let firstPublication = '';
    if (!isAozoraXhtml(requestedUrl)) {
      const cardResponse = await fetchAozora(requestedUrl);
      const cardHtml = await cardResponse.text();
      firstPublication = aozoraFirstPublication(cardHtml);
      xhtmlUrl = findAozoraXhtml(cardHtml, requestedUrl);
    }
    const xhtmlResponse = await fetchAozora(xhtmlUrl);
    const declaredSize = Number(xhtmlResponse.headers.get('content-length') ?? 0);
    if (declaredSize > 5 * 1024 * 1024) throw new Error('作品ファイルが大きすぎます');
    const bytes = await xhtmlResponse.arrayBuffer();
    if (bytes.byteLength > 5 * 1024 * 1024) throw new Error('作品ファイルが大きすぎます');
    const html = new TextDecoder('shift_jis').decode(bytes);
    json(res, 200, { html, sourceUrl: xhtmlUrl.href, firstPublication });
  } catch (error) {
    json(res, 400, { error: errorMessage(error) });
  }
}

async function convert(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'vt-reader-'));
  const input = join(dir, 'capture.webm');
  const output = join(dir, 'character.mp4');
  const clientAbort = new AbortController();
  res.once('close', () => { if (!res.writableEnded) clientAbort.abort(); });
  try {
    await requestToFile(req, input, maxVideoUpload);
    try {
      await run('ffmpeg', [
        '-y', '-i', input,
        '-c:v', 'h264_nvenc', '-preset', 'p5', '-tune', 'hq',
        '-rc', 'vbr', '-cq', '21', '-b:v', '0', '-spatial_aq', '1', '-temporal_aq', '1',
        '-profile:v', 'high', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', output
      ], clientAbort.signal);
    } catch (nvencError) {
      if (clientAbort.signal.aborted) throw nvencError;
      console.warn(`NVENCを利用できないためCPU変換へ切り替えます: ${errorMessage(nvencError)}`);
      await run('ffmpeg', [
        '-y', '-i', input,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', output
      ], clientAbort.signal);
    }
    const video = await stat(output);
    res.writeHead(200, {
      'content-type': 'video/mp4',
      'content-length': video.size,
      'content-disposition': 'attachment; filename="character-video.mp4"'
    });
    await pipeline(createReadStream(output), res);
  } catch (error) {
    if (!clientAbort.signal.aborted && !res.destroyed && !res.headersSent) {
      json(res, 500, { error: 'MP4変換に失敗しました。FFmpegが利用可能か確認してください。', detail: errorMessage(error) });
    } else {
      res.destroy(error instanceof Error ? error : new Error(errorMessage(error)));
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function audioRepairRanges(req: IncomingMessage): AudioRepairRange[] {
  const encoded = req.headers['x-roudoku-repairs'];
  if (typeof encoded !== 'string' || encoded.length > 16_384) throw new Error('音声修正情報がありません');
  const value = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as unknown;
  if (!Array.isArray(value) || value.length < 1 || value.length > 50) throw new Error('音声修正は1〜50区間で指定してください');
  let previousEnd = 0;
  return value.map((item, index) => {
    const range = item as Partial<AudioRepairRange>;
    const start = Number(range.start);
    const end = Number(range.end);
    const size = Number(range.size);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < previousEnd || end <= start || end - start > 300) {
      throw new Error(`音声修正区間${index + 1}が不正です`);
    }
    if (!Number.isSafeInteger(size) || size < 44 || size > 100 * 1024 * 1024) {
      throw new Error(`修正音声${index + 1}のサイズが不正です`);
    }
    previousEnd = end;
    return { start, end, size };
  });
}

async function repairAudio(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'roudoku-audio-repair-'));
  const combined = join(dir, 'combined.bin');
  const original = join(dir, 'original.wav');
  const output = join(dir, 'repaired.wav');
  const clientAbort = new AbortController();
  res.once('close', () => { if (!res.writableEnded) clientAbort.abort(); });
  try {
    const ranges = audioRepairRanges(req);
    await requestToFile(req, combined, maxVideoUpload);
    const combinedInfo = await stat(combined);
    const replacementBytes = ranges.reduce((sum, range) => sum + range.size, 0);
    if (combinedInfo.size <= replacementBytes) throw new Error('元音声データがありません');

    let offset = 0;
    const replacementPaths: string[] = [];
    for (const [index, range] of ranges.entries()) {
      const path = join(dir, `replacement-${index}.wav`);
      await pipeline(createReadStream(combined, { start: offset, end: offset + range.size - 1 }), createWriteStream(path));
      replacementPaths.push(path);
      offset += range.size;
    }
    await pipeline(createReadStream(combined, { start: offset }), createWriteStream(original));

    const inputs = ['-i', original];
    replacementPaths.forEach(path => inputs.push('-i', path));
    const filters: string[] = [];
    const pieces: string[] = [];
    let cursor = 0;
    let pieceIndex = 0;
    const addOriginal = (start: number, end?: number): void => {
      const label = `p${pieceIndex++}`;
      const endOption = end === undefined ? '' : `:end=${end.toFixed(6)}`;
      filters.push(`[0:a]atrim=start=${start.toFixed(6)}${endOption},asetpts=PTS-STARTPTS,aformat=sample_rates=48000:sample_fmts=s16:channel_layouts=mono[${label}]`);
      pieces.push(`[${label}]`);
    };
    ranges.forEach((range, index) => {
      if (range.start > cursor + .001) addOriginal(cursor, range.start);
      const label = `p${pieceIndex++}`;
      filters.push(`[${index + 1}:a]asetpts=PTS-STARTPTS,aformat=sample_rates=48000:sample_fmts=s16:channel_layouts=mono[${label}]`);
      pieces.push(`[${label}]`);
      cursor = range.end;
    });
    addOriginal(cursor);
    filters.push(`${pieces.join('')}concat=n=${pieces.length}:v=0:a=1[out]`);
    await run('ffmpeg', [
      '-y', ...inputs, '-filter_complex', filters.join(';'), '-map', '[out]',
      '-c:a', 'pcm_s16le', output
    ], clientAbort.signal);
    const audio = await stat(output);
    res.writeHead(200, { 'content-type': 'audio/wav', 'content-length': audio.size });
    await pipeline(createReadStream(output), res);
  } catch (error) {
    if (!clientAbort.signal.aborted && !res.destroyed && !res.headersSent) {
      json(res, 500, { error: '修正文の音声を差し替えられませんでした', detail: errorMessage(error) });
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function staticFile(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const urlPath = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`).pathname;
  const requestedFile = urlPath === '/' ? 'index.html' : decodeURIComponent(urlPath.slice(1));
  const path = resolve(publicDir, requestedFile);
  const relative = relativePath(publicDir, path);
  if (relative.startsWith('..') || isAbsolute(relative)) return json(res, 403, { error: 'Forbidden' });

  try {
    const file = await readFile(path);
    res.writeHead(200, {
      'content-type': mime[extname(path)] || 'application/octet-stream',
      'content-length': file.length
    });
    res.end(file);
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : undefined;
    if (code === 'ENOENT' || code === 'EISDIR') return json(res, 404, { error: 'Not found' });
    throw error;
  }
}

createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url === '/api/tts') return await voicevox(req, res);
    if (req.method === 'POST' && req.url === '/api/irodori/speech') return await irodoriSpeech(req, res);
    if (req.method === 'POST' && req.url === '/api/irodori/voices') return await irodoriVoiceUpload(req, res);
    if (req.method === 'POST' && req.url === '/api/aozora') return await importAozora(req, res);
    if (req.method === 'POST' && req.url === '/api/export') return await convert(req, res);
    if (req.method === 'POST' && req.url === '/api/audio/repair') return await repairAudio(req, res);
    if (req.method === 'GET' && req.url === '/api/irodori/health') return await irodoriHealth(res);
    if (req.method === 'GET') return await staticFile(req, res);
    json(res, 405, { error: 'Method not allowed' });
  } catch (error) {
    console.error(error);
    if (!res.headersSent && !res.writableEnded && !res.destroyed) {
      json(res, 500, { error: errorMessage(error) });
    } else if (!res.destroyed) {
      res.destroy(error instanceof Error ? error : new Error(errorMessage(error)));
    }
  }
}).listen(port, () => console.log(`VT Reader: http://localhost:${port}`));
