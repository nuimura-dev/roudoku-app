import { activeCaption, applyEnglishRuby, applyJapaneseRubyCorrections, captionCues, englishRubyCandidates, expressionAt, isPunctuationPause, parseScript, plainText, type ActiveCaption, type CaptionCue, type Expression } from './script.js';
import { matchTimelineAnchors } from './alignment.js';

type Viseme = 'closed' | 'a' | 'i' | 'u' | 'e' | 'o';
type SceneLayer = 'background' | 'character' | 'foreground';
type PlaybackPhase = 'idle' | 'opening' | 'narration' | 'ending';
interface ImageBox { x: number; y: number; width: number; height: number }
interface LayerOffset { x: number; y: number }
interface HairPart {
  x: number;
  y: number;
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
  phase: number;
  direction: 1 | -1;
  mask: ReadonlyArray<readonly [number, number]>;
  eraseOriginal: boolean;
  motionScale: number;
}
interface PlaybackSession {
  cancelled: boolean;
  duration: number;
  startOffset: number;
  openingDuration: number;
  narrationDuration: number;
  endingDuration: number;
  source?: AudioBufferSourceNode;
  mediaStartTimer?: number;
  bgmSource?: AudioBufferSourceNode;
  bgmGain?: GainNode;
  ambientSource?: AudioBufferSourceNode;
  ambientGain?: GainNode;
  frame?: number;
  renderWorker?: Worker;
  renderWorkerUrl?: string;
  captureTrack?: CanvasCaptureMediaStreamTrack;
  finish?: () => void;
}
interface AppState {
  images: Partial<Record<Expression, HTMLImageElement>>;
  sceneImages: Partial<Record<'background' | 'foreground', HTMLImageElement>>;
  layerOffsets: Record<SceneLayer, LayerOffset>;
  activeLayer: SceneLayer;
  mouthPatches: Partial<Record<Expression, HTMLCanvasElement>>;
  mouthImages: Partial<Record<Viseme, HTMLImageElement>>;
  audioBuffer: AudioBuffer | null;
  audioElement: HTMLAudioElement | null;
  audioMediaNode: MediaElementAudioSourceNode | null;
  audioUrl: string | null;
  audioDuration: number;
  audioBlob: Blob | null;
  audioName: string;
  audioScriptSource: string | null;
  audioCaptionTimes: number[] | null;
  bgmBuffer: AudioBuffer | null;
  bgmName: string;
  ambientBuffer: AudioBuffer | null;
  ambientName: string;
  playing: boolean;
  exporting: boolean;
  progress: number;
  overallProgress: number;
  playbackElapsed: number;
  playbackPhase: PlaybackPhase;
  mouth: number;
  currentExpression: Expression;
  previousExpression: Expression;
  expressionTransitionStartedAt: number;
  currentViseme: Viseme;
  session: PlaybackSession | null;
  captionCues: CaptionCue[];
  captionTimes: number[] | null;
}

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Required element not found: ${selector}`);
  return element;
}

const elements = {
  canvas: required<HTMLCanvasElement>('#stage'),
  stageWrap: required<HTMLElement>('.stage-wrap'),
  stageExpand: required<HTMLButtonElement>('#stageExpand'),
  notice: required<HTMLElement>('#notice'),
  aozoraUrl: required<HTMLInputElement>('#aozoraUrl'),
  importAozora: required<HTMLButtonElement>('#importAozora'),
  aozoraStatus: required<HTMLElement>('#aozoraStatus'),
  workTitle: required<HTMLInputElement>('#workTitle'),
  workAuthor: required<HTMLInputElement>('#workAuthor'),
  workPublication: required<HTMLInputElement>('#workPublication'),
  openingText: required<HTMLTextAreaElement>('#openingText'),
  openingDuration: required<HTMLInputElement>('#openingDuration'),
  endingText: required<HTMLTextAreaElement>('#endingText'),
  endingDuration: required<HTMLInputElement>('#endingDuration'),
  script: required<HTMLTextAreaElement>('#scriptInput'),
  charCount: required<HTMLElement>('#charCount'),
  scriptMap: required<HTMLElement>('#scriptMap'),
  englishRubyPanel: required<HTMLElement>('#englishRubyPanel'),
  englishRubySummary: required<HTMLElement>('#englishRubySummary'),
  englishRubyList: required<HTMLElement>('#englishRubyList'),
  applyEnglishRuby: required<HTMLButtonElement>('#applyEnglishRuby'),
  pronunciationCorrections: required<HTMLTextAreaElement>('#pronunciationCorrections'),
  applyPronunciationCorrections: required<HTMLButtonElement>('#applyPronunciationCorrections'),
  repairPronunciationAudio: required<HTMLButtonElement>('#repairPronunciationAudio'),
  pronunciationRepairStatus: required<HTMLElement>('#pronunciationRepairStatus'),
  expressionPill: required<HTMLElement>('#expressionPill'),
  timeline: required<HTMLElement>('#timeline'),
  timelineFill: required<HTMLElement>('#timelineFill'),
  timelineHandle: required<HTMLElement>('#timelineHandle'),
  timecode: required<HTMLElement>('#timecode'),
  mouthX: required<HTMLInputElement>('#mouthX'),
  mouthY: required<HTMLInputElement>('#mouthY'),
  mouthSize: required<HTMLInputElement>('#mouthSize'),
  characterScale: required<HTMLInputElement>('#characterScale'),
  backgroundScale: required<HTMLInputElement>('#backgroundScale'),
  foregroundScale: required<HTMLInputElement>('#foregroundScale'),
  characterMotion: required<HTMLInputElement>('#characterMotion'),
  hairMotion: required<HTMLInputElement>('#hairMotion'),
  legMotion: required<HTMLInputElement>('#legMotion'),
  useMouthSprites: required<HTMLInputElement>('#useMouthSprites'),
  expressionPreviewButtons: required<HTMLElement>('#expressionPreviewButtons'),
  ttsEngine: required<HTMLSelectElement>('#ttsEngine'),
  ttsEngineName: required<HTMLElement>('#ttsEngineName'),
  ttsEngineStatus: required<HTMLElement>('#ttsEngineStatus'),
  voicevoxSettings: required<HTMLElement>('#voicevoxSettings'),
  irodoriSettings: required<HTMLElement>('#irodoriSettings'),
  irodoriVoice: required<HTMLInputElement>('#irodoriVoice'),
  irodoriCaption: required<HTMLTextAreaElement>('#irodoriCaption'),
  irodoriQuality: required<HTMLSelectElement>('#irodoriQuality'),
  irodoriAttackFade: required<HTMLInputElement>('#irodoriAttackFade'),
  irodoriAttackFadeOut: required<HTMLOutputElement>('#irodoriAttackFadeOut'),
  irodoriReference: required<HTMLInputElement>('#irodoriReference'),
  irodoriReferenceName: required<HTMLElement>('#irodoriReferenceName'),
  uploadIrodoriVoice: required<HTMLButtonElement>('#uploadIrodoriVoice'),
  voiceSpeed: required<HTMLInputElement>('#voiceSpeed'),
  speakerId: required<HTMLInputElement>('#speakerId'),
  audioName: required<HTMLElement>('#audioName'),
  bgmPreset: required<HTMLSelectElement>('#bgmPreset'),
  bgmVolume: required<HTMLInputElement>('#bgmVolume'),
  bgmVolumeOut: required<HTMLOutputElement>('#bgmVolumeOut'),
  bgmLoop: required<HTMLInputElement>('#bgmLoop'),
  bgmFile: required<HTMLInputElement>('#bgmFile'),
  bgmFileName: required<HTMLElement>('#bgmFileName'),
  bgmName: required<HTMLElement>('#bgmName'),
  ambientPreset: required<HTMLSelectElement>('#ambientPreset'),
  ambientVolume: required<HTMLInputElement>('#ambientVolume'),
  ambientVolumeOut: required<HTMLOutputElement>('#ambientVolumeOut'),
  ambientLoop: required<HTMLInputElement>('#ambientLoop'),
  ambientFile: required<HTMLInputElement>('#ambientFile'),
  ambientFileName: required<HTMLElement>('#ambientFileName'),
  ambientName: required<HTMLElement>('#ambientName'),
  baseImage: required<HTMLInputElement>('#baseImage'),
  backgroundImage: required<HTMLInputElement>('#backgroundImage'),
  foregroundImage: required<HTMLInputElement>('#foregroundImage'),
  layerButtons: required<HTMLElement>('#layerButtons'),
  resetLayerPosition: required<HTMLButtonElement>('#resetLayerPosition'),
  audioFile: required<HTMLInputElement>('#audioFile'),
  emptyStage: required<HTMLElement>('#emptyStage'),
  statusText: required<HTMLElement>('#statusText'),
  playButton: required<HTMLButtonElement>('#playButton'),
  rewind: required<HTMLButtonElement>('#rewind'),
  exportButton: required<HTMLButtonElement>('#exportButton'),
  cancelExport: required<HTMLButtonElement>('#cancelExport'),
  generateVoice: required<HTMLButtonElement>('#generateVoice'),
  generateVoiceFromScript: required<HTMLButtonElement>('#generateVoiceFromScript'),
  generateVoiceAndExport: required<HTMLButtonElement>('#generateVoiceAndExport'),
  saveAudio: required<HTMLButtonElement>('#saveAudio'),
  saveAudioFromScript: required<HTMLButtonElement>('#saveAudioFromScript'),
  cancelVoice: required<HTMLButtonElement>('#cancelVoice'),
  cancelVoiceFromScript: required<HTMLButtonElement>('#cancelVoiceFromScript'),
  saveProject: required<HTMLButtonElement>('#saveProject'),
  openProject: required<HTMLInputElement>('#openProject'),
  showCaptions: required<HTMLInputElement>('#showCaptions'),
  captionEffect: required<HTMLSelectElement>('#captionEffect'),
  captionSize: required<HTMLInputElement>('#captionSize'),
  captionX: required<HTMLInputElement>('#captionX'),
  captionY: required<HTMLInputElement>('#captionY'),
  expressionChips: required<HTMLElement>('#expressionChips')
};
const canvasContext = elements.canvas.getContext('2d');
if (!canvasContext) throw new Error('Canvas 2D context is unavailable');
const ctx: CanvasRenderingContext2D = canvasContext;
const expressionPartCanvas = document.createElement('canvas');
expressionPartCanvas.width = elements.canvas.width;
expressionPartCanvas.height = elements.canvas.height;
const expressionPartContextCandidate = expressionPartCanvas.getContext('2d');
if (!expressionPartContextCandidate) throw new Error('Expression part canvas is unavailable');
const expressionPartContext: CanvasRenderingContext2D = expressionPartContextCandidate;
const legPartCanvas = document.createElement('canvas');
legPartCanvas.width = elements.canvas.width;
legPartCanvas.height = elements.canvas.height;
const legPartContextCandidate = legPartCanvas.getContext('2d');
if (!legPartContextCandidate) throw new Error('Leg part canvas is unavailable');
const legPartContext: CanvasRenderingContext2D = legPartContextCandidate;

const defaultLayerOffsets: Record<SceneLayer, LayerOffset> = {
  background: { x: 0, y: 0 },
  character: { x: 431, y: 41 },
  foreground: { x: 207, y: 145 }
};
function defaultLayerOffset(layer: SceneLayer): LayerOffset {
  return { ...defaultLayerOffsets[layer] };
}

const state: AppState = {
  images: {}, sceneImages: {}, mouthPatches: {}, mouthImages: {},
  layerOffsets: {
    background: defaultLayerOffset('background'),
    character: defaultLayerOffset('character'),
    foreground: defaultLayerOffset('foreground')
  },
  activeLayer: 'character', audioBuffer: null, audioElement: null, audioMediaNode: null, audioUrl: null, audioDuration: 0, audioBlob: null, audioName: '', audioScriptSource: null, audioCaptionTimes: null, bgmBuffer: null, bgmName: '', ambientBuffer: null, ambientName: '', playing: false, exporting: false,
  progress: 0, overallProgress: 0, playbackElapsed: 0, playbackPhase: 'idle', mouth: 0, currentExpression: 'neutral', previousExpression: 'neutral',
  expressionTransitionStartedAt: Number.NEGATIVE_INFINITY, currentViseme: 'closed', session: null, captionCues: [], captionTimes: null
};
let voiceGenerationController: AbortController | null = null;
let exportController: AbortController | null = null;
let exportCancelled = false;
let combinedWorkflowRunning = false;
const expressionTransitionDuration = .42;
const colors: Record<Expression, string> = {
  neutral: '#a6a39c', happy: '#d8ff45', sad: '#70a7ff', angry: '#ff6b53', surprised: '#d994ff'
};
const defaultCharacterAssets: Record<Expression, string> = {
  neutral: '/assets/character-reader/base.png',
  happy: '/assets/character-reader/happy.png',
  sad: '/assets/character-reader/sad.png',
  angry: '/assets/character-reader/angry.png',
  surprised: '/assets/character-reader/surprised.png'
};
const defaultMouthAssets: Record<Viseme, string> = {
  closed: '/assets/character-reader/mouth/closed.png',
  a: '/assets/character-reader/mouth/a.png',
  i: '/assets/character-reader/mouth/i.png',
  u: '/assets/character-reader/mouth/u.png',
  e: '/assets/character-reader/mouth/e.png',
  o: '/assets/character-reader/mouth/o.png'
};
const defaultSceneAssets = {
  background: '/assets/scene-samples/reading-room.png',
  foreground: '/assets/scene-samples/desk-foreground.png'
} as const;
const defaultBgmAssets: Record<string, { url: string; label: string }> = {
  gogatsunokaze: { url: '/assets/bgm/gogatsunokaze.mp3', label: '5月の風' },
  irishnokaze: { url: '/assets/bgm/irishnokaze.mp3', label: 'アイリッシュの風' },
  musmus105a: { url: '/assets/bgm/MusMus-BGM-105a.mp3', label: '卒業（音楽室ver.）' },
  musmus105b: { url: '/assets/bgm/MusMus-BGM-105b.mp3', label: '卒業（体育館ver.）' },
  seiya: { url: '/assets/bgm/seiya.mp3', label: '聖夜' }
};
const defaultAmbientAssets: Record<string, { url: string; label: string }> = {
  wind: { url: '/assets/sounds/VSQSE_0613_wind_04.mp3', label: '風' },
  pastoral: { url: '/assets/sounds/VSQSE_1078_pastoral_landscape_03.mp3', label: '田園風景' }
};
const hairParts: HairPart[] = [
  {
    x: .22, y: .25, width: .23, height: .16, anchorX: .405, anchorY: .32, phase: 0, direction: -1,
    mask: [[.395, .305], [.36, .275], [.29, .27], [.235, .3], [.245, .34], [.31, .355], [.38, .34]],
    eraseOriginal: false,
    motionScale: .62
  },
  {
    x: .65, y: .245, width: .24, height: .17, anchorX: .69, anchorY: .31, phase: .7, direction: 1,
    mask: [[.69, .295], [.735, .265], [.81, .26], [.87, .29], [.885, .345], [.83, .39], [.755, .38], [.7, .34]],
    eraseOriginal: true,
    motionScale: 1
  }
];
let audioContext: AudioContext | null = null;
let noticeTimer: ReturnType<typeof setTimeout> | undefined;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function notify(message: string, success = false): void {
  elements.notice.textContent = message;
  elements.notice.className = `notice show${success ? ' success' : ''}`;
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { elements.notice.className = 'notice'; }, 5000);
}

function formatTime(seconds: number): string {
  const value = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
}

function metadataNarration(): string {
  const title = elements.workTitle.value.trim();
  const author = elements.workAuthor.value.trim();
  return [title ? `作品名、${title}。` : '', author ? `著者、${author}。` : ''].filter(Boolean).join('');
}

function playbackScriptSource(): string {
  const metadata = metadataNarration();
  return metadata ? `[neutral]${metadata} ${elements.script.value}` : elements.script.value;
}

function estimatedNarrationDuration(): number {
  return Math.max(2, [...plainText(playbackScriptSource())].length / 5.5);
}

function videoCardText(opening: boolean): string {
  const template = opening ? elements.openingText.value : elements.endingText.value;
  const publication = elements.workPublication.value.trim();
  return template
    .replaceAll('{{title}}', elements.workTitle.value.trim())
    .replaceAll('{{author}}', elements.workAuthor.value.trim())
    .replaceAll('{{publication}}', publication ? `初出：${publication}` : '')
    .trim();
}

function openingCardDuration(): number {
  return videoCardText(true) ? Math.max(1, Math.min(20, Number(elements.openingDuration.value) || 3)) : 0;
}

function endingCardDuration(): number {
  return videoCardText(false) ? Math.max(1, Math.min(20, Number(elements.endingDuration.value) || 3)) : 0;
}

function narrationDuration(): number { return state.audioBuffer?.duration ?? (state.audioDuration > 0 ? state.audioDuration : estimatedNarrationDuration()); }
function duration(): number { return openingCardDuration() + narrationDuration() + endingCardDuration(); }

function extractAozoraText(html: string): { title: string; author: string; text: string } {
  const document = new DOMParser().parseFromString(html, 'text/html');
  const main = document.querySelector<HTMLElement>('.main_text');
  if (!main) throw new Error('XHTML本文を認識できませんでした');
  main.querySelectorAll('script,style,.bibliographical_information,.notation_notes,.notes').forEach(node => node.remove());
  main.querySelectorAll('img').forEach(image => image.replaceWith(document.createTextNode(image.alt || '')));
  main.querySelectorAll('ruby').forEach(ruby => {
    const reading = [...ruby.querySelectorAll('rt')].map(node => node.textContent ?? '').join('').trim();
    const bases = [...ruby.querySelectorAll('rb')].map(node => node.textContent ?? '').join('').trim();
    let base = bases;
    if (!base) {
      const clone = ruby.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('rt,rp').forEach(node => node.remove());
      base = clone.textContent?.trim() ?? '';
    }
    ruby.replaceWith(document.createTextNode(reading ? `｜${base}《${reading}》` : base));
  });
  main.querySelectorAll('br').forEach(node => node.replaceWith(document.createTextNode('\n')));
  main.querySelectorAll('p,div,h1,h2,h3,h4').forEach(node => node.append(document.createTextNode('\n')));
  const text = (main.textContent ?? '')
    .replace(/\r/g, '')
    .split('\n')
    .map(line => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!text) throw new Error('本文が空です');
  const title = document.querySelector<HTMLElement>('h1.title,.title')?.textContent?.trim()
    ?? document.title.replace(/\s*[｜|].*$/, '').trim()
    ?? '青空文庫';
  const author = document.querySelector<HTMLElement>('h2.author,.author')?.textContent?.trim() ?? '';
  return { title, author, text };
}

function imageBox(image: HTMLImageElement, time: number): ImageBox {
  const maxW = elements.canvas.width * 0.82;
  const maxH = elements.canvas.height * 0.91;
  const characterScale = Number(elements.characterScale.value) / 100;
  const scale = Math.min(maxW / image.naturalWidth, maxH / image.naturalHeight) * characterScale;
  const breath = state.playing ? 1 + Math.sin(time * 2.2) * 0.004 : 1;
  const width = image.naturalWidth * scale * breath;
  const height = image.naturalHeight * scale * breath;
  const offset = state.layerOffsets.character;
  return {
    x: (elements.canvas.width - width) / 2 + offset.x,
    y: elements.canvas.height - height + offset.y,
    width,
    height
  };
}

function sceneLayerBox(image: HTMLImageElement, layer: 'background' | 'foreground'): ImageBox {
  const canvasWidth = elements.canvas.width;
  const canvasHeight = elements.canvas.height;
  const slider = layer === 'background' ? elements.backgroundScale : elements.foregroundScale;
  const userScale = Number(slider.value) / 100;
  const fitScale = layer === 'background'
    ? Math.max(canvasWidth / image.naturalWidth, canvasHeight / image.naturalHeight)
    : Math.min(canvasWidth / image.naturalWidth, canvasHeight / image.naturalHeight);
  const width = image.naturalWidth * fitScale * userScale;
  const height = image.naturalHeight * fitScale * userScale;
  const offset = state.layerOffsets[layer];
  return {
    x: (canvasWidth - width) / 2 + offset.x,
    y: (canvasHeight - height) / 2 + offset.y,
    width,
    height
  };
}

function drawSceneLayer(layer: 'background' | 'foreground'): void {
  const image = state.sceneImages[layer];
  if (!image) return;
  const box = sceneLayerBox(image, layer);
  ctx.drawImage(image, box.x, box.y, box.width, box.height);
}

function createMouthRemovalPatch(image: HTMLImageElement, expression: Expression): HTMLCanvasElement {
  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = image.naturalWidth;
  sourceCanvas.height = image.naturalHeight;
  const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
  if (!sourceContext) throw new Error('Mouth source canvas is unavailable');
  sourceContext.drawImage(image, 0, 0);
  const source = sourceContext.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
  const patch = document.createElement('canvas');
  patch.width = sourceCanvas.width;
  patch.height = sourceCanvas.height;
  const patchContext = patch.getContext('2d');
  if (!patchContext) throw new Error('Mouth patch canvas is unavailable');
  const output = patchContext.createImageData(patch.width, patch.height);
  const isHappy = expression === 'happy';
  const xStart = Math.floor(patch.width * (isHappy ? .485 : .48));
  const xEnd = Math.ceil(patch.width * (isHappy ? .56 : .545));
  const yStart = Math.floor(patch.height * (isHappy ? .33 : .338));
  const yEnd = Math.ceil(patch.height * .367);
  const skinOffset = Math.round(patch.height * .019);

  for (let y = yStart; y < yEnd; y += 1) {
    for (let x = xStart; x < xEnd; x += 1) {
      const index = (y * patch.width + x) * 4;
      const skinIndex = ((y - skinOffset) * patch.width + x) * 4;
      const red = source.data[index]!;
      const green = source.data[index + 1]!;
      const blue = source.data[index + 2]!;
      const skinRed = source.data[skinIndex]!;
      const skinGreen = source.data[skinIndex + 1]!;
      const skinBlue = source.data[skinIndex + 2]!;
      const luminance = red * .299 + green * .587 + blue * .114;
      const skinLuminance = skinRed * .299 + skinGreen * .587 + skinBlue * .114;
      // A plain colour-distance test also catches the bright book below the
      // chin and makes the replacement skin protrude beyond the face. Mouth
      // pixels are darker and/or redder than the nearby skin, so restrict the
      // mask to those two characteristics.
      const darkness = skinLuminance - luminance;
      const redness = (red - green) - (skinRed - skinGreen);
      const teethBrightness = isHappy ? (luminance - skinLuminance) * .9 : 0;
      const difference = Math.max(darkness, redness * 1.15, teethBrightness);
      const edgeFade = Math.min(1, (x - xStart) / Math.max(1, patch.width * .006));
      const strength = Math.max(0, Math.min(1, (difference - 12) / 32)) * edgeFade;
      if (strength === 0) continue;
      output.data[index] = skinRed;
      output.data[index + 1] = skinGreen;
      output.data[index + 2] = skinBlue;
      output.data[index + 3] = Math.round(strength * 255);
    }
  }
  patchContext.putImageData(output, 0, 0);
  return patch;
}

function restoreOriginalMouthArea(box: ImageBox, expression: Expression): void {
  // The base image is always neutral; remove only its original mouth before a
  // viseme is drawn. Expression mouths are never composited during lip-sync.
  const patch = state.mouthPatches.neutral ?? state.mouthPatches[expression];
  if (patch) ctx.drawImage(patch, box.x, box.y, box.width, box.height);
}

function drawExpressionParts(image: HTMLImageElement, box: ImageBox, includeMouth: boolean, opacity = 1): void {
  const drawFeatheredEllipse = (centerX: number, centerY: number, radiusX: number, radiusY: number): void => {
    expressionPartContext.clearRect(0, 0, expressionPartCanvas.width, expressionPartCanvas.height);
    expressionPartContext.save();
    expressionPartContext.drawImage(image, box.x, box.y, box.width, box.height);
    expressionPartContext.globalCompositeOperation = 'destination-in';
    expressionPartContext.translate(box.x + box.width * centerX, box.y + box.height * centerY);
    expressionPartContext.scale(box.width * radiusX, box.height * radiusY);
    const feather = expressionPartContext.createRadialGradient(0, 0, 0, 0, 0, 1);
    feather.addColorStop(0, 'rgba(0,0,0,1)');
    feather.addColorStop(.72, 'rgba(0,0,0,1)');
    feather.addColorStop(1, 'rgba(0,0,0,0)');
    expressionPartContext.fillStyle = feather;
    expressionPartContext.beginPath();
    expressionPartContext.arc(0, 0, 1, 0, Math.PI * 2);
    expressionPartContext.fill();
    expressionPartContext.restore();
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.drawImage(expressionPartCanvas, 0, 0);
    ctx.restore();
  };

  // Keep the body, face outline, hair and book from the neutral base. Only
  // replace the small facial regions that actually carry an expression.
  // Brows need their own wide, opaque centers. Otherwise the neutral brows
  // remain visible when sad/angry brows move away from their base position.
  drawFeatheredEllipse(.425, .247, .085, .03);
  drawFeatheredEllipse(.575, .247, .085, .03);
  drawFeatheredEllipse(.43, .282, .073, .046);
  drawFeatheredEllipse(.575, .28, .073, .046);
  if (includeMouth) drawFeatheredEllipse(.52, .352, .062, .026);
}

function setExpression(expression: Expression): boolean {
  if (expression === state.currentExpression) return false;
  state.previousExpression = state.currentExpression;
  state.currentExpression = expression;
  state.expressionTransitionStartedAt = performance.now() / 1000;
  return true;
}

function drawHairPart(image: HTMLImageElement, box: ImageBox, part: HairPart, time: number): void {
  const sourceX = image.naturalWidth * part.x;
  const sourceY = image.naturalHeight * part.y;
  const sourceWidth = image.naturalWidth * part.width;
  const sourceHeight = image.naturalHeight * part.height;
  const destinationX = box.x + box.width * part.x;
  const destinationY = box.y + box.height * part.y;
  const destinationWidth = box.width * part.width;
  const destinationHeight = box.height * part.height;
  const anchorX = box.x + box.width * part.anchorX;
  const anchorY = box.y + box.height * part.anchorY;
  const strength = Number(elements.hairMotion.value) / 100;

  if (part.eraseOriginal) {
    ctx.save();
    ctx.beginPath();
    part.mask.forEach(([pointX, pointY], index) => {
      const x = box.x + box.width * pointX;
      const y = box.y + box.height * pointY;
      if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.clip();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.drawImage(
      image, sourceX, sourceY, sourceWidth, sourceHeight,
      destinationX, destinationY, destinationWidth, destinationHeight
    );
    ctx.restore();
  }

  const delayedTime = time * 1.15 - part.phase;
  const partStrength = strength * part.motionScale;
  const angle = Math.sin(delayedTime) * 0.028 * partStrength * part.direction;
  const followX = Math.sin(delayedTime * .9) * 3.2 * partStrength * part.direction;
  const followY = Math.cos(delayedTime * 1.2) * 1.8 * partStrength;
  ctx.save();
  ctx.translate(anchorX + followX, anchorY + followY);
  ctx.rotate(angle);
  ctx.translate(-anchorX, -anchorY);
  ctx.beginPath();
  part.mask.forEach(([pointX, pointY], index) => {
    const x = box.x + box.width * pointX;
    const y = box.y + box.height * pointY;
    if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(
    image, sourceX, sourceY, sourceWidth, sourceHeight,
    destinationX, destinationY, destinationWidth, destinationHeight
  );
  ctx.restore();
}

function drawLegMotion(image: HTMLImageElement, box: ImageBox, time: number): void {
  const strength = Number(elements.legMotion.value) / 100;
  if (strength <= 0) return;
  const opening = (1 - Math.cos(time * 1.2)) / 2;
  const travel = box.width * .008 * strength * opening;
  const angle = .007 * strength * opening;
  const parts: ReadonlyArray<{
    direction: 1 | -1;
    anchor: readonly [number, number];
    mask: ReadonlyArray<readonly [number, number]>;
  }> = [
    {
      direction: -1,
      anchor: [.46, .865],
      mask: [[.245, .865], [.455, .855], [.505, .91], [.49, 1], [.16, 1], [.18, .93]]
    },
    {
      direction: 1,
      anchor: [.545, .86],
      mask: [[.505, .91], [.545, .855], [.75, .865], [.825, .94], [.85, 1], [.505, 1]]
    }
  ];

  for (const part of parts) {
    const anchorX = box.x + box.width * part.anchor[0];
    const anchorY = box.y + box.height * part.anchor[1];
    legPartContext.clearRect(0, 0, legPartCanvas.width, legPartCanvas.height);
    legPartContext.save();
    legPartContext.translate(anchorX + travel * part.direction, anchorY);
    legPartContext.rotate(angle * part.direction);
    legPartContext.translate(-anchorX, -anchorY);
    legPartContext.drawImage(image, box.x, box.y, box.width, box.height);
    legPartContext.globalCompositeOperation = 'destination-in';
    legPartContext.filter = `blur(${Math.max(1.5, box.width * .0025)}px)`;
    legPartContext.beginPath();
    part.mask.forEach(([pointX, pointY], index) => {
      const x = box.x + box.width * pointX;
      const y = box.y + box.height * pointY;
      if (index === 0) legPartContext.moveTo(x, y); else legPartContext.lineTo(x, y);
    });
    legPartContext.closePath();
    legPartContext.fillStyle = '#000';
    legPartContext.fill();
    legPartContext.restore();
    ctx.drawImage(legPartCanvas, 0, 0);
  }
}

function drawMouth(box: ImageBox, openness: number, expression: Expression): void {
  const size = Number(elements.mouthSize.value) / 100;
  const x = box.x + box.width * Number(elements.mouthX.value) / 100;
  const y = box.y + box.height * Number(elements.mouthY.value) / 100;
  const sprite = state.mouthImages[state.currentViseme];
  if (elements.useMouthSprites.checked && sprite) {
    restoreOriginalMouthArea(box, expression);
    const spriteSize = box.width * 0.82 * size;
    ctx.drawImage(sprite, x - spriteSize / 2, y - spriteSize / 2, spriteSize, spriteSize);
    return;
  }
  const width = box.width * 0.075 * size;
  const open = Math.max(0.04, openness);
  const height = width * (0.13 + open * 0.72);
  ctx.save();
  ctx.translate(x, y);
  if (expression === 'happy' && open < 0.18) {
    ctx.beginPath(); ctx.arc(0, -height * .4, width * .48, .12, Math.PI - .12); ctx.strokeStyle = '#351f25'; ctx.lineWidth = Math.max(3, width * .09); ctx.lineCap = 'round'; ctx.stroke();
  } else {
    ctx.beginPath(); ctx.ellipse(0, 0, width / 2, height / 2, 0, 0, Math.PI * 2); ctx.fillStyle = '#351b25'; ctx.fill();
    if (open > .28) { ctx.beginPath(); ctx.ellipse(0, height * .18, width * .3, height * .18, 0, 0, Math.PI * 2); ctx.fillStyle = '#df6f81'; ctx.fill(); }
  }
  ctx.restore();
}

function smoothStep(value: number): number {
  const x = Math.max(0, Math.min(1, value));
  return x * x * (3 - 2 * x);
}

function captionLines(text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const character of [...text]) {
    const candidate = line + character;
    if (line && ctx.measureText(candidate).width > maxWidth) {
      lines.push(line.trim());
      line = character.trimStart();
    } else {
      line = candidate;
    }
  }
  if (line.trim()) lines.push(line.trim());
  return lines;
}

function drawTwistReadingCaption(time: number, caption: { text: string; progress: number }): void {
  ctx.save();
  const fontSize = Number(elements.captionSize.value);
  ctx.font = `700 ${fontSize}px "Yu Mincho", YuMincho, "Hiragino Mincho ProN", "Noto Serif JP", serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const leftX = elements.canvas.width * Number(elements.captionX.value) / 100;
  const rightPadding = elements.canvas.width * .04;
  const availableWidth = Math.max(fontSize * 1.2, elements.canvas.width - leftX - rightPadding);
  const lines = captionLines(caption.text, availableWidth);
  const lineHeight = fontSize * 1.34;
  const widest = Math.max(...lines.map(line => ctx.measureText(line).width));
  const panelHeight = lines.length * lineHeight + fontSize * .7;
  const requestedY = elements.canvas.height * Number(elements.captionY.value) / 100;
  const centerY = Math.max(panelHeight / 2 + 8, Math.min(elements.canvas.height - panelHeight / 2 - 8, requestedY))
    + Math.sin(time * 1.8) * 1.2;
  const panelX = Math.max(0, leftX - fontSize * .55);
  const panelRight = Math.min(elements.canvas.width, leftX + widest + fontSize * .8);
  const panelWidth = panelRight - panelX;
  const panelOpacity = Math.min(smoothStep(caption.progress / .15), smoothStep((1 - caption.progress) / .1));

  // 黒文字の背後へ、風フェードと同じく左右が溶ける薄い生成り色を敷く。
  ctx.save();
  ctx.globalAlpha = panelOpacity * .74;
  ctx.filter = `blur(${(1 - panelOpacity) * 3}px)`;
  const panel = ctx.createLinearGradient(panelX, 0, panelRight, 0);
  panel.addColorStop(0, 'rgba(250,247,231,0)');
  panel.addColorStop(.13, 'rgba(250,247,231,.88)');
  panel.addColorStop(.87, 'rgba(250,247,231,.88)');
  panel.addColorStop(1, 'rgba(250,247,231,0)');
  ctx.fillStyle = panel;
  ctx.fillRect(panelX, centerY - panelHeight / 2, panelWidth, panelHeight);
  ctx.restore();
  const glyphs: Array<{ character: string; x: number; y: number }> = [];
  lines.forEach((line, lineIndex) => {
    const characters = [...line];
    const widths = characters.map(character => ctx.measureText(character).width);
    let cursor = 0;
    characters.forEach((character, index) => {
      const width = widths[index]!;
      glyphs.push({
        character,
        x: cursor + width / 2,
        y: (lineIndex - (lines.length - 1) / 2) * lineHeight
      });
      cursor += width;
    });
  });

  const lastIndex = Math.max(1, glyphs.length - 1);
  glyphs.forEach((glyph, index) => {
    if (!glyph.character.trim()) return;
    const order = index / lastIndex;
    // 文字ごとに時間差を付け、右上から薄い面が回り込むように出現させる。
    const entry = smoothStep((caption.progress - order * .12) / .08);
    const exitStart = .88 + (1 - order) * .04;
    const exit = smoothStep((caption.progress - exitStart) / .1);
    const opacity = entry * (1 - exit);
    if (opacity <= .004) return;
    const twist = 1 - entry;
    const diagonalX = twist * (145 + order * 45) - exit * (115 + order * 30);
    const diagonalY = -twist * (95 + Math.sin(index * 1.7) * 18) + exit * 78;
    const rotation = twist * (-.72 + Math.sin(index * 1.3) * .2) + exit * (.48 - order * .16);
    const skewX = twist * (-.58 + (index % 2) * .16) + exit * .42;
    const skewY = twist * (.12 - order * .08) - exit * .08;
    // 横幅を細くして、Y軸周りにひねられているような擬似3D感を出す。
    const scaleX = Math.max(.1, (.12 + entry * .88) * (1 - exit * .82));

    ctx.save();
    ctx.translate(leftX + glyph.x + diagonalX, centerY + glyph.y + diagonalY);
    ctx.rotate(rotation);
    ctx.transform(1, skewY, skewX, 1, 0, 0);
    ctx.scale(scaleX, 1);
    ctx.globalAlpha = opacity;
    ctx.filter = `blur(${(twist + exit) * 2.4}px)`;
    // 古い日本文学を思わせる明朝体を、縁取りなしの黒一色で描く。
    ctx.fillStyle = '#050505';
    ctx.fillText(glyph.character, 0, 0);
    ctx.restore();
  });
  ctx.restore();
}

function drawFixedReadingPanel(caption: ActiveCaption): void {
  ctx.save();
  const fontSize = Number(elements.captionSize.value);
  const lineHeight = fontSize * 1.52;
  const panelX = elements.canvas.width * Number(elements.captionX.value) / 100;
  const panelWidth = Math.min(elements.canvas.width * .43, elements.canvas.width - panelX - elements.canvas.width * .035);
  const panelHeight = elements.canvas.height * .68;
  const requestedCenterY = elements.canvas.height * Number(elements.captionY.value) / 100;
  const panelY = Math.max(12, Math.min(elements.canvas.height - panelHeight - 12, requestedCenterY - panelHeight / 2));
  const paddingX = Math.max(24, fontSize * .9);
  const paddingY = Math.max(26, fontSize * .95);
  const textWidth = panelWidth - paddingX * 2;
  const maxLines = Math.max(1, Math.floor((panelHeight - paddingY * 2) / lineHeight));

  ctx.globalAlpha = .78;
  ctx.fillStyle = '#fff';
  ctx.fillRect(panelX, panelY, panelWidth, panelHeight);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = 'rgba(18,18,18,.18)';
  ctx.lineWidth = 2;
  ctx.strokeRect(panelX + 1, panelY + 1, panelWidth - 2, panelHeight - 2);

  ctx.font = `600 ${fontSize}px "Yu Mincho", YuMincho, "Hiragino Mincho ProN", "Noto Serif JP", serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  const previousLines = caption.index > 0 && caption.progress < .22
    ? captionLines(state.captionCues[caption.index - 1]!.text, textWidth)
    : [];
  const previousPresence = previousLines.length ? 1 - smoothStep(caption.progress / .22) : 0;
  const previousHeight = previousLines.length * lineHeight + fontSize * .45;
  const blocks: Array<{ lines: string[]; current: boolean }> = [];
  let usedLines = 0;
  for (let index = caption.index; index < state.captionCues.length && blocks.length < 4; index += 1) {
    const lines = captionLines(state.captionCues[index]!.text, textWidth);
    if (blocks.length > 0 && usedLines + lines.length > maxLines) break;
    const available = Math.max(1, maxLines - usedLines);
    blocks.push({ lines: lines.slice(0, available), current: index === caption.index });
    usedLines += Math.min(lines.length, available);
    if (usedLines >= maxLines) break;
  }

  let cursorY = panelY + paddingY;
  if (previousLines.length) {
    ctx.globalAlpha = previousPresence * .72;
    ctx.fillStyle = '#202020';
    previousLines.forEach((line, index) => ctx.fillText(line, panelX + paddingX, cursorY + index * lineHeight));
    cursorY += previousHeight * previousPresence;
  }

  for (const [blockIndex, block] of blocks.entries()) {
    if (cursorY + block.lines.length * lineHeight > panelY + panelHeight - paddingY + 1) break;
    ctx.globalAlpha = block.current ? 1 : Math.max(.34, .62 - blockIndex * .1);
    ctx.fillStyle = block.current ? '#080808' : '#363636';
    block.lines.forEach((line, lineIndex) => ctx.fillText(line, panelX + paddingX, cursorY + lineIndex * lineHeight));
    cursorY += block.lines.length * lineHeight + fontSize * .45;
  }
  ctx.restore();
}

function captionPauseThreshold(text: string): number | null {
  // Irodoriが句点後に追加する約2秒の無音だけを確実なアンカーにする。
  // 読点や自然なブレス（約0.4〜1.2秒）は字幕途中にも現れるため、
  // 順番だけで境界へ割り当てると以後の字幕が大きくずれる。
  if (/[。．.][」』）)】］\]”’]*\s*$/u.test(text)) return 1.8;
  return null;
}

interface AudioSilence { start: number; end: number; duration: number }

function silencesFromRms(rmsValues: readonly number[], peak: number, windowSeconds: number, audioDuration: number): AudioSilence[] {
  // 約-34dB相当。高くしすぎると静かな発話まで無音として結合される。
  const threshold = Math.max(.001, peak * .02);
  const silences: AudioSilence[] = [];
  let runStart = -1;
  for (let index = 0; index <= rmsValues.length; index += 1) {
    const silent = index < rmsValues.length && rmsValues[index]! <= threshold;
    if (silent && runStart < 0) runStart = index;
    if (!silent && runStart >= 0) {
      const start = runStart * windowSeconds;
      const end = Math.min(audioDuration, index * windowSeconds);
      const silenceDuration = end - start;
      if (silenceDuration >= .22 && start > .12 && end < audioDuration - .08) {
        silences.push({ start, end, duration: silenceDuration });
      }
      runStart = -1;
    }
  }
  return silences;
}

async function audioSilences(buffer: AudioBuffer): Promise<Array<{ start: number; end: number; duration: number }>> {
  const windowSeconds = .02;
  const windowSamples = Math.max(1, Math.round(buffer.sampleRate * windowSeconds));
  const sampleStride = Math.max(8, Math.floor(windowSamples / 32));
  const rmsValues: number[] = [];
  let peak = 0;
  for (let start = 0; start < buffer.length; start += windowSamples) {
    let sum = 0;
    let count = 0;
    const samples = buffer.getChannelData(0);
    for (let index = start; index < Math.min(buffer.length, start + windowSamples); index += sampleStride) {
      sum += samples[index]! * samples[index]!;
      count += 1;
    }
    const rms = count ? Math.sqrt(sum / count) : 0;
    rmsValues.push(rms);
    peak = Math.max(peak, rms);
    if (rmsValues.length % 4000 === 0) await new Promise<void>(resolve => window.setTimeout(resolve, 0));
  }
  return silencesFromRms(rmsValues, peak, windowSeconds, buffer.duration);
}

function alignCaptionTimesFromSilences(cues: readonly CaptionCue[], silences: readonly AudioSilence[], audioDuration: number): number[] | null {
  if (!cues.length || audioDuration <= 0) return null;
  const anchors = new Map<number, number>([[0, 0], [cues.length, audioDuration]]);
  const totalWeight = cues.reduce((sum, cue) => sum + cue.weight, 0);
  const required: Array<{ boundary: number; expected: number; minimumPause: number }> = [];
  let cumulativeWeight = 0;
  for (let cueIndex = 0; cueIndex < cues.length - 1; cueIndex += 1) {
    cumulativeWeight += cues[cueIndex]!.weight;
    const minimumPause = captionPauseThreshold(cues[cueIndex]!.text);
    if (minimumPause === null) continue;
    required.push({ boundary: cueIndex + 1, expected: cumulativeWeight / totalWeight * audioDuration, minimumPause });
  }
  const minimumRequiredPause = Math.min(...required.map(anchor => anchor.minimumPause));
  const candidates = Number.isFinite(minimumRequiredPause)
    ? silences.filter(silence => silence.duration >= minimumRequiredPause)
    : [];

  if (required.length > 0 && candidates.length >= required.length) {
    // 台本上の予測位置との誤差が最小になるよう、余分な長い間を飛ばしながら
    // 句点境界と無音を単調マッチングする。
    const selected = matchTimelineAnchors(required.map(anchor => anchor.expected), candidates.map(candidate => candidate.end));
    required.forEach((anchor, index) => {
      const candidate = candidates[selected[index]!];
      if (candidate) anchors.set(anchor.boundary, candidate.end);
    });
  } else {
    // 無音が不足する音声では、見つかった範囲だけを順番にアンカー化する。
    required.slice(0, candidates.length).forEach((anchor, index) => anchors.set(anchor.boundary, candidates[index]!.end));
  }
  const times = Array<number>(cues.length + 1).fill(0);
  const orderedAnchors = [...anchors].sort((a, b) => a[0] - b[0]);
  for (let anchorIndex = 0; anchorIndex < orderedAnchors.length - 1; anchorIndex += 1) {
    const [fromCue, fromTime] = orderedAnchors[anchorIndex]!;
    const [toCue, toTime] = orderedAnchors[anchorIndex + 1]!;
    const weights = cues.slice(fromCue, toCue).map(cue => cue.weight);
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    let elapsedWeight = 0;
    times[fromCue] = fromTime;
    for (let cueIndex = fromCue; cueIndex < toCue; cueIndex += 1) {
      elapsedWeight += weights[cueIndex - fromCue]!;
      times[cueIndex + 1] = fromTime + (toTime - fromTime) * elapsedWeight / totalWeight;
    }
  }
  return times;
}

async function alignCaptionTimes(buffer: AudioBuffer, cues: readonly CaptionCue[]): Promise<number[] | null> {
  return alignCaptionTimesFromSilences(cues, await audioSilences(buffer), buffer.duration);
}

interface PcmWavInfo {
  format: number;
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  blockAlign: number;
  dataOffset: number;
  dataSize: number;
}

async function pcmWavInfo(blob: Blob): Promise<PcmWavInfo | null> {
  const header = new DataView(await blob.slice(0, Math.min(blob.size, 1024 * 1024)).arrayBuffer());
  const fourCc = (offset: number): string => String.fromCharCode(
    header.getUint8(offset), header.getUint8(offset + 1), header.getUint8(offset + 2), header.getUint8(offset + 3)
  );
  if (header.byteLength < 44 || fourCc(0) !== 'RIFF' || fourCc(8) !== 'WAVE') return null;
  let cursor = 12;
  let format: Pick<PcmWavInfo, 'format' | 'channels' | 'sampleRate' | 'bitsPerSample' | 'blockAlign'> | null = null;
  while (cursor + 8 <= header.byteLength) {
    const id = fourCc(cursor);
    const size = header.getUint32(cursor + 4, true);
    const content = cursor + 8;
    if (id === 'fmt ' && size >= 16 && content + 16 <= header.byteLength) {
      format = {
        format: header.getUint16(content, true),
        channels: header.getUint16(content + 2, true),
        sampleRate: header.getUint32(content + 4, true),
        blockAlign: header.getUint16(content + 12, true),
        bitsPerSample: header.getUint16(content + 14, true)
      };
    } else if (id === 'data' && format) {
      const dataSize = Math.min(size, Math.max(0, blob.size - content));
      return { ...format, dataOffset: content, dataSize };
    }
    cursor = content + size + (size % 2);
  }
  return null;
}

function pcmSample(view: DataView, offset: number, format: number, bits: number): number {
  if (format === 3 && bits === 32) return view.getFloat32(offset, true);
  if (format !== 1) return 0;
  if (bits === 8) return (view.getUint8(offset) - 128) / 128;
  if (bits === 16) return view.getInt16(offset, true) / 32768;
  if (bits === 24) {
    const raw = view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getUint8(offset + 2) << 16);
    return ((raw & 0x800000) ? raw - 0x1000000 : raw) / 8388608;
  }
  if (bits === 32) return view.getInt32(offset, true) / 2147483648;
  return 0;
}

async function alignLongWavCaptionTimes(blob: Blob, cues: readonly CaptionCue[]): Promise<number[] | null> {
  const info = await pcmWavInfo(blob);
  if (!info || ![1, 3].includes(info.format) || ![8, 16, 24, 32].includes(info.bitsPerSample) || info.blockAlign <= 0) return null;
  const windowSeconds = .02;
  const windowFrames = Math.max(1, Math.round(info.sampleRate * windowSeconds));
  const sampleStride = Math.max(8, Math.floor(windowFrames / 32));
  const bytesPerSample = info.bitsPerSample / 8;
  const totalFrames = Math.floor(info.dataSize / info.blockAlign);
  const rmsValues: number[] = [];
  let peak = 0;
  let nextFrame = 0;
  let currentWindow = 0;
  let sum = 0;
  let count = 0;
  const chunkBytes = Math.floor((8 * 1024 * 1024) / info.blockAlign) * info.blockAlign;
  for (let byteOffset = 0; byteOffset < info.dataSize; byteOffset += chunkBytes) {
    const size = Math.min(chunkBytes, info.dataSize - byteOffset);
    const view = new DataView(await blob.slice(info.dataOffset + byteOffset, info.dataOffset + byteOffset + size).arrayBuffer());
    const chunkStartFrame = Math.floor(byteOffset / info.blockAlign);
    const chunkEndFrame = chunkStartFrame + Math.floor(size / info.blockAlign);
    while (nextFrame < chunkEndFrame && nextFrame < totalFrames) {
      const windowIndex = Math.floor(nextFrame / windowFrames);
      if (windowIndex !== currentWindow) {
        const rms = count ? Math.sqrt(sum / count) : 0;
        rmsValues.push(rms); peak = Math.max(peak, rms);
        currentWindow = windowIndex; sum = 0; count = 0;
      }
      const localOffset = (nextFrame - chunkStartFrame) * info.blockAlign;
      if (localOffset >= 0 && localOffset + bytesPerSample <= view.byteLength) {
        const sample = pcmSample(view, localOffset, info.format, info.bitsPerSample);
        sum += sample * sample; count += 1;
      }
      nextFrame += sampleStride;
    }
  }
  const finalRms = count ? Math.sqrt(sum / count) : 0;
  rmsValues.push(finalRms); peak = Math.max(peak, finalRms);
  const audioDuration = totalFrames / info.sampleRate;
  return alignCaptionTimesFromSilences(cues, silencesFromRms(rmsValues, peak, windowSeconds, audioDuration), audioDuration);
}

function activeCaptionForPlayback(): ActiveCaption | null {
  const times = state.captionTimes;
  if (!times || times.length !== state.captionCues.length + 1) return activeCaption(state.captionCues, state.progress);
  const narrationElapsed = Math.max(0, state.playbackElapsed - (state.session?.openingDuration ?? openingCardDuration()));
  for (let index = 0; index < state.captionCues.length; index += 1) {
    const start = times[index]!;
    const end = times[index + 1]!;
    if (narrationElapsed < end || index === state.captionCues.length - 1) {
      return {
        text: state.captionCues[index]!.text,
        progress: end > start ? Math.max(0, Math.min(1, (narrationElapsed - start) / (end - start))) : 1,
        index
      };
    }
  }
  return null;
}

function drawReadingCaption(time: number): void {
  if (state.playbackPhase !== 'narration' || !elements.showCaptions.checked) return;
  const caption = activeCaptionForPlayback();
  if (!caption) return;
  if (elements.captionEffect.value === 'fixed-panel') {
    drawFixedReadingPanel(caption);
    return;
  }
  if (elements.captionEffect.value === 'twist') {
    drawTwistReadingCaption(time, caption);
    return;
  }
  const fadeIn = smoothStep(caption.progress / .08);
  const fadeOut = smoothStep((1 - caption.progress) / .1);
  const opacity = Math.min(fadeIn, fadeOut);
  if (opacity <= .005) return;

  const entering = 1 - fadeIn;
  const leaving = 1 - fadeOut;
  const windX = entering * 90 - leaving * 58 + Math.sin(time * 1.7) * 2;
  const windY = Math.sin(time * 2.1) * 1.5 - entering * 5;
  ctx.save();
  const fontSize = Number(elements.captionSize.value);
  ctx.font = `600 ${fontSize}px "Hiragino Kaku Gothic ProN", "Yu Gothic", Meiryo, sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const leftX = elements.canvas.width * Number(elements.captionX.value) / 100;
  const rightPadding = elements.canvas.width * .04;
  const availableWidth = Math.max(fontSize * 1.2, elements.canvas.width - leftX - rightPadding);
  const lines = captionLines(caption.text, availableWidth);
  const widest = Math.max(...lines.map(line => ctx.measureText(line).width));
  const lineHeight = fontSize * 1.43;
  const panelHeight = lines.length * lineHeight + fontSize;
  const requestedY = elements.canvas.height * Number(elements.captionY.value) / 100;
  const baseY = Math.max(panelHeight / 2 + 8, Math.min(elements.canvas.height - panelHeight / 2 - 8, requestedY)) + windY;
  const textX = leftX + windX;
  const panelX = Math.max(0, textX - fontSize * .6);
  const panelRight = Math.min(elements.canvas.width, textX + widest + fontSize * .8);
  const panelWidth = panelRight - panelX;
  const panelY = baseY - panelHeight / 2;

  ctx.globalAlpha = opacity * .62;
  ctx.filter = `blur(${entering * 3.5 + leaving * 2}px)`;
  const backdrop = ctx.createLinearGradient(panelX, 0, panelX + panelWidth, 0);
  backdrop.addColorStop(0, 'rgba(10,12,10,0)');
  backdrop.addColorStop(.14, 'rgba(10,12,10,.82)');
  backdrop.addColorStop(.86, 'rgba(10,12,10,.82)');
  backdrop.addColorStop(1, 'rgba(10,12,10,0)');
  ctx.fillStyle = backdrop;
  ctx.fillRect(panelX, panelY, panelWidth, panelHeight);

  // 薄い残像を右側へ流し、風に運ばれて現れる印象を作る。
  ctx.filter = `blur(${2 + entering * 4}px)`;
  for (let trail = 3; trail >= 1; trail -= 1) {
    ctx.globalAlpha = opacity * (.025 + entering * .035) * trail;
    ctx.fillStyle = '#eef8d1';
    lines.forEach((line, index) => ctx.fillText(line, textX + trail * 13, baseY + (index - (lines.length - 1) / 2) * lineHeight));
  }

  ctx.filter = `blur(${(entering + leaving) * 1.4}px)`;
  ctx.shadowColor = 'rgba(0,0,0,.9)';
  ctx.shadowBlur = 9;
  ctx.globalAlpha = opacity;
  ctx.fillStyle = '#f7f5ee';
  lines.forEach((line, index) => ctx.fillText(line, textX, baseY + (index - (lines.length - 1) / 2) * lineHeight));
  ctx.globalAlpha = opacity * .9;
  ctx.fillStyle = '#d8ff45';
  ctx.fillRect(textX, panelY + panelHeight - 5, Math.min(180, panelWidth * .26), 2);
  ctx.restore();
}

function drawVideoCard(): void {
  if (state.playbackPhase !== 'opening' && state.playbackPhase !== 'ending') return;
  const opening = state.playbackPhase === 'opening';
  const text = videoCardText(opening);
  const cardDuration = opening ? state.session?.openingDuration ?? openingCardDuration() : state.session?.endingDuration ?? endingCardDuration();
  if (!text || cardDuration <= 0) return;
  const elapsed = opening
    ? state.playbackElapsed
    : state.playbackElapsed - (state.session?.openingDuration ?? openingCardDuration()) - (state.session?.narrationDuration ?? narrationDuration());
  const fadeTime = Math.min(.7, cardDuration / 3);
  const opacity = Math.min(smoothStep(elapsed / fadeTime), smoothStep((cardDuration - elapsed) / fadeTime));

  ctx.save();
  ctx.globalAlpha = Math.max(0, opacity);
  const shade = ctx.createLinearGradient(0, 0, elements.canvas.width, elements.canvas.height);
  shade.addColorStop(0, 'rgba(8,10,8,.9)');
  shade.addColorStop(.55, 'rgba(14,15,12,.78)');
  shade.addColorStop(1, 'rgba(8,10,8,.92)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, elements.canvas.width, elements.canvas.height);
  ctx.font = '700 54px "Yu Mincho", YuMincho, "Hiragino Mincho ProN", "Noto Serif JP", serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lines = text.split(/\r?\n/u).flatMap(line => captionLines(line, elements.canvas.width * .76));
  const lineHeight = 76;
  ctx.fillStyle = '#f3f0e6';
  ctx.shadowColor = 'rgba(0,0,0,.8)';
  ctx.shadowBlur = 14;
  lines.forEach((line, index) => {
    ctx.fillText(line, elements.canvas.width / 2, elements.canvas.height / 2 + (index - (lines.length - 1) / 2) * lineHeight);
  });
  ctx.fillStyle = '#d8ff45';
  ctx.fillRect(elements.canvas.width / 2 - 70, elements.canvas.height / 2 + lines.length * lineHeight / 2 + 22, 140, 2);
  ctx.restore();
}

function draw(time = performance.now() / 1000): void {
  ctx.clearRect(0, 0, elements.canvas.width, elements.canvas.height);
  drawSceneLayer('background');
  const baseImage = state.images.neutral;
  if (baseImage) {
    const box = imageBox(baseImage, time);
    const motion = state.playing ? Number(elements.characterMotion.value) / 100 : 0;
    const swayX = Math.sin(time * .95) * 4 * motion;
    const swayY = Math.sin(time * 1.35 + .8) * 2.7 * motion;
    const rotation = Math.sin(time * .72) * .0045 * motion;
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height * .62;
    ctx.save();
    ctx.translate(centerX + swayX, centerY + swayY);
    ctx.rotate(rotation);
    ctx.translate(-centerX, -centerY);
    ctx.drawImage(baseImage, box.x, box.y, box.width, box.height);
    const includeExpressionMouth = !(state.playing || state.mouth > 0);
    const transitionProgress = Math.max(0, Math.min(1,
      (time - state.expressionTransitionStartedAt) / expressionTransitionDuration
    ));
    const drawPartsFor = (expression: Expression, opacity: number): void => {
      const image = state.images[expression];
      if (expression !== 'neutral' && image && opacity > 0) {
        drawExpressionParts(image, box, includeExpressionMouth, opacity);
      }
    };
    if (transitionProgress < 1 && state.previousExpression !== state.currentExpression) {
      drawPartsFor(state.previousExpression, 1 - transitionProgress);
      drawPartsFor(state.currentExpression, transitionProgress);
    } else {
      drawPartsFor(state.currentExpression, 1);
    }
    if (state.playing) drawLegMotion(baseImage, box, time);
    if (state.playing && Number(elements.hairMotion.value) > 0) {
      for (const part of hairParts) drawHairPart(baseImage, box, part, time);
    }
    if (state.playing || state.mouth > 0) drawMouth(box, state.mouth, state.currentExpression); ctx.restore();
  }
  drawSceneLayer('foreground');
  drawVideoCard();
  drawReadingCaption(time);
  elements.expressionPill.textContent = state.currentExpression.toUpperCase();
  elements.expressionPill.style.color = colors[state.currentExpression];
  document.querySelectorAll<HTMLButtonElement>('[data-preview-expression]').forEach(button => {
    button.classList.toggle('active', button.dataset.previewExpression === state.currentExpression);
  });
  const totalDuration = state.session?.duration ?? duration();
  elements.timelineFill.style.width = `${state.overallProgress * 100}%`;
  elements.timelineHandle.style.left = `${state.overallProgress * 100}%`;
  elements.timeline.setAttribute('aria-valuenow', String(Math.round(state.overallProgress * 100)));
  elements.timeline.setAttribute('aria-valuetext', `${formatTime(state.playbackElapsed)} / ${formatTime(totalDuration)}`);
  elements.timecode.textContent = `${formatTime(state.playbackElapsed)} / ${formatTime(totalDuration)}`;
}

function updateScript(): void {
  const source = elements.script.value;
  state.captionCues = captionCues(playbackScriptSource());
  state.captionTimes = null;
  elements.charCount.textContent = `${[...plainText(source)].length} 文字`;
  const segments = parseScript(source);
  elements.scriptMap.replaceChildren(...segments.map(item => {
    const marker = document.createElement('i');
    marker.title = item.expression;
    marker.style.flex = String(Math.max(1, [...item.text].length));
    marker.style.background = colors[item.expression];
    return marker;
  }));
  updateEnglishRubyPanel(source);
  if (!state.playing) draw();
}

function updateEnglishRubyPanel(source: string): void {
  const editedReadings = new Map(
    [...elements.englishRubyList.querySelectorAll<HTMLInputElement>('input[data-word]')]
      .map(input => [input.dataset.word ?? '', input.value] as const)
  );
  const candidates = englishRubyCandidates(source);
  elements.englishRubyPanel.hidden = candidates.length === 0;
  const occurrences = candidates.reduce((sum, candidate) => sum + candidate.count, 0);
  elements.englishRubySummary.textContent = `${candidates.length}単語・${occurrences}箇所`;
  elements.englishRubyList.replaceChildren(...candidates.map(candidate => {
    const row = document.createElement('label');
    row.className = 'english-ruby-row';
    const word = document.createElement('span');
    word.textContent = candidate.word;
    word.title = candidate.word;
    const count = document.createElement('small');
    count.textContent = `×${candidate.count}`;
    const reading = document.createElement('input');
    reading.type = 'text';
    reading.dataset.word = candidate.word;
    reading.value = editedReadings.get(candidate.word) ?? candidate.reading;
    reading.setAttribute('aria-label', `${candidate.word}の読み`);
    row.append(word, count, reading);
    return row;
  }));
}

function updateExpandButton(): void {
  const expanded = document.fullscreenElement === elements.stageWrap || elements.stageWrap.classList.contains('stage-expanded');
  const label = expanded ? '全画面表示を終了' : 'プレビューを全画面表示';
  elements.stageExpand.setAttribute('aria-label', label);
  elements.stageExpand.setAttribute('aria-pressed', String(expanded));
  elements.stageExpand.title = label;
  elements.stageExpand.querySelector('span')!.textContent = expanded ? '×' : '⛶';
}

async function toggleStageFullscreen(): Promise<void> {
  try {
    if (document.fullscreenElement === elements.stageWrap) {
      await document.exitFullscreen();
    } else if (document.fullscreenElement) {
      await document.exitFullscreen();
      await elements.stageWrap.requestFullscreen();
    } else if (elements.stageWrap.requestFullscreen) {
      await elements.stageWrap.requestFullscreen();
    } else {
      elements.stageWrap.classList.toggle('stage-expanded');
    }
  } catch {
    elements.stageWrap.classList.toggle('stage-expanded');
  }
  updateExpandButton();
}

async function fileToImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url; await image.decode(); return image;
  } finally { URL.revokeObjectURL(url); }
}

async function urlToImage(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = url;
  await image.decode();
  return image;
}

function setActiveLayer(layer: SceneLayer): void {
  state.activeLayer = layer;
  elements.layerButtons.querySelectorAll<HTMLButtonElement>('[data-layer]').forEach(button => {
    button.classList.toggle('active', button.dataset.layer === layer);
  });
  elements.canvas.setAttribute('aria-label', `${layer}レイヤーをドラッグして配置`);
}

async function applyLayerFile(layer: SceneLayer, file: File): Promise<void> {
  const image = await fileToImage(file);
  if (layer === 'character') {
    state.images.neutral = image;
    state.mouthPatches.neutral = createMouthRemovalPatch(image, 'neutral');
    elements.statusText.textContent = '準備完了';
    elements.emptyStage.classList.add('hidden');
  } else {
    state.sceneImages[layer] = image;
    required<HTMLElement>(`#${layer}Name`).textContent = file.name;
  }
  state.layerOffsets[layer] = defaultLayerOffset(layer);
  draw();
}

async function loadDefaultCharacter(): Promise<void> {
  try {
    const characterEntries = await Promise.all(
      Object.entries(defaultCharacterAssets).map(async ([expression, url]) => [expression, await urlToImage(url)] as const)
    );
    const mouthEntries = await Promise.all(
      Object.entries(defaultMouthAssets).map(async ([viseme, url]) => [viseme, await urlToImage(url)] as const)
    );
    const sceneEntries = await Promise.all(
      Object.entries(defaultSceneAssets).map(async ([layer, url]) => [layer, await urlToImage(url)] as const)
    );
    for (const [expression, image] of characterEntries) {
      const typedExpression = expression as Expression;
      state.images[typedExpression] = image;
      state.mouthPatches[typedExpression] = createMouthRemovalPatch(image, typedExpression);
    }
    for (const [viseme, image] of mouthEntries) state.mouthImages[viseme as Viseme] = image;
    for (const [layer, image] of sceneEntries) {
      state.sceneImages[layer as 'background' | 'foreground'] = image;
    }
    elements.emptyStage.classList.add('hidden');
    elements.statusText.textContent = 'デフォルトキャラ読込済み';
    for (const expression of ['happy', 'sad', 'angry', 'surprised'] as const) {
      required<HTMLElement>(`#${expression}Name`).textContent = 'デフォルト';
    }
    draw();
  } catch (error) {
    elements.statusText.textContent = 'キャラクター未設定';
    notify(`デフォルトキャラクターを読み込めませんでした: ${errorMessage(error)}`);
  }
}

async function ensureAudioContext(): Promise<AudioContext> {
  audioContext ??= new AudioContext();
  if (audioContext.state === 'suspended') await audioContext.resume();
  return audioContext;
}

function clearNarrationAudio(): void {
  state.audioElement?.pause();
  state.audioMediaNode?.disconnect();
  if (state.audioUrl) URL.revokeObjectURL(state.audioUrl);
  state.audioBuffer = null;
  state.audioElement = null;
  state.audioMediaNode = null;
  state.audioUrl = null;
  state.audioDuration = 0;
  state.audioBlob = null;
  state.captionTimes = null;
  state.audioScriptSource = null;
  state.audioCaptionTimes = null;
  elements.saveAudio.disabled = true;
  elements.saveAudioFromScript.disabled = true;
}

async function loadLongAudio(blob: Blob, name: string, scriptSource: string): Promise<void> {
  const url = URL.createObjectURL(blob);
  const audio = new Audio();
  audio.preload = 'metadata';
  try {
    await new Promise<void>((resolve, reject) => {
      audio.addEventListener('loadedmetadata', () => resolve(), { once: true });
      audio.addEventListener('error', () => reject(new Error('音声メタデータを読み込めませんでした')), { once: true });
      audio.src = url;
    });
    if (!Number.isFinite(audio.duration) || audio.duration <= 0) throw new Error('音声の長さを取得できませんでした');
    clearNarrationAudio();
    state.audioElement = audio;
    state.audioUrl = url;
    state.audioDuration = audio.duration;
    state.audioBlob = blob;
    state.audioName = name;
    state.audioScriptSource = scriptSource;
    elements.saveAudio.disabled = false;
    elements.saveAudioFromScript.disabled = false;
    elements.audioName.textContent = `${name} · ${formatTime(audio.duration)} · 長編省メモリ`;
    notify('長編音声を省メモリモードで読み込みました。WAVの無音位置をバックグラウンドで解析しています。', true);
    draw();
    scheduleLongCaptionAlignment(blob);
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

function scheduleCaptionAlignment(buffer: AudioBuffer): void {
  const targetBuffer = buffer;
  const targetCues = state.captionCues;
  void alignCaptionTimes(targetBuffer, targetCues).then(times => {
    if (state.audioBuffer !== targetBuffer || state.captionCues !== targetCues) return;
    state.captionTimes = times;
    if (state.audioScriptSource === playbackScriptSource()) state.audioCaptionTimes = times;
    draw();
    notify('字幕タイミングの補正が完了しました。', true);
  }).catch(error => {
    if (state.audioBuffer === targetBuffer) state.captionTimes = null;
    console.warn(`字幕タイミングを補正できませんでした: ${errorMessage(error)}`);
  });
}

function scheduleLongCaptionAlignment(blob: Blob): void {
  const targetBlob = blob;
  const targetCues = state.captionCues;
  void alignLongWavCaptionTimes(targetBlob, targetCues).then(times => {
    if (state.audioBlob !== targetBlob || state.captionCues !== targetCues) return;
    state.captionTimes = times;
    if (state.audioScriptSource === playbackScriptSource()) state.audioCaptionTimes = times;
    draw();
    notify(times
      ? '長編WAVの無音位置に合わせて字幕タイミングを補正しました。'
      : 'この音声形式では無音解析を使えないため、句読点から字幕を同期します。', true);
  }).catch(error => {
    if (state.audioBlob === targetBlob) state.captionTimes = null;
    console.warn(`長編WAVの字幕タイミングを補正できませんでした: ${errorMessage(error)}`);
  });
}

async function loadAudio(blob: Blob, name: string, scriptSource = playbackScriptSource()): Promise<void> {
  const ac = await ensureAudioContext();
  try {
    if (blob.size > 48 * 1024 * 1024) {
      await loadLongAudio(blob, name, scriptSource);
      return;
    }
    const buffer = await ac.decodeAudioData(await blob.arrayBuffer());
    clearNarrationAudio();
    state.audioBuffer = buffer; state.audioBlob = blob; state.audioName = name;
    state.audioScriptSource = scriptSource;
    elements.saveAudio.disabled = false;
    elements.saveAudioFromScript.disabled = false;
    elements.audioName.textContent = `${name} · ${formatTime(buffer.duration)}`;
    notify('音声を読み込みました。字幕タイミングをバックグラウンドで補正しています。', true);
    draw();
    scheduleCaptionAlignment(buffer);
  } catch { notify('この音声形式をブラウザで読み込めませんでした。WAVまたはMP3をお試しください。'); }
}

async function loadBgm(blob: Blob, name: string, announce = true): Promise<void> {
  audioContext ??= new AudioContext();
  try {
    state.bgmBuffer = await audioContext.decodeAudioData(await blob.arrayBuffer());
    state.bgmName = name;
    elements.bgmName.textContent = `${name} · ${formatTime(state.bgmBuffer.duration)}`;
    if (announce) notify('BGMを読み込みました。プレビューと動画にミックスされます。', true);
  } catch {
    notify('このBGM形式を読み込めませんでした。MP3またはWAVをお試しください。');
  }
}

async function loadBgmPreset(id: string, announce = true): Promise<void> {
  if (!id) {
    state.bgmBuffer = null;
    state.bgmName = '';
    elements.bgmName.textContent = 'BGMなし';
    if (announce) notify('BGMを解除しました。', true);
    return;
  }
  const preset = defaultBgmAssets[id];
  if (!preset) return;
  try {
    const response = await fetch(preset.url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    await loadBgm(await response.blob(), `${preset.label} · サンプル`, announce);
  } catch (error) {
    elements.bgmName.textContent = 'BGMを読み込めませんでした';
    if (announce) notify(`BGMの読み込みに失敗しました: ${errorMessage(error)}`);
  }
}

async function loadAmbient(blob: Blob, name: string, announce = true): Promise<void> {
  audioContext ??= new AudioContext();
  try {
    state.ambientBuffer = await audioContext.decodeAudioData(await blob.arrayBuffer());
    state.ambientName = name;
    elements.ambientName.textContent = `${name} · ${formatTime(state.ambientBuffer.duration)}`;
    if (announce) notify('環境音を読み込みました。プレビューと動画にミックスされます。', true);
  } catch {
    notify('この環境音を読み込めませんでした。MP3またはWAVをお試しください。');
  }
}

async function loadAmbientPreset(id: string, announce = true): Promise<void> {
  if (!id) {
    state.ambientBuffer = null;
    state.ambientName = '';
    elements.ambientName.textContent = '環境音なし';
    if (announce) notify('環境音を解除しました。', true);
    return;
  }
  const preset = defaultAmbientAssets[id];
  if (!preset) return;
  try {
    const response = await fetch(preset.url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    await loadAmbient(await response.blob(), `${preset.label} · サンプル`, announce);
  } catch (error) {
    elements.ambientName.textContent = '環境音を読み込めませんでした';
    if (announce) notify(`環境音の読み込みに失敗しました: ${errorMessage(error)}`);
  }
}

async function checkIrodoriHealth(): Promise<void> {
  if (elements.ttsEngine.value !== 'irodori') return;
  elements.ttsEngineStatus.textContent = '接続状態を確認中…';
  try {
    const response = await fetch('/api/irodori/health');
    const data = await response.json() as { connected?: boolean; error?: string };
    if (!response.ok || !data.connected) throw new Error(data.error ?? '未接続');
    elements.ttsEngineStatus.textContent = 'Irodori-TTS Server 接続済み · 長文分割対応';
  } catch {
    elements.ttsEngineStatus.textContent = '未接続 · localhost:8088 のサーバーを起動してください';
  }
}

function updateTtsEngine(): void {
  const irodori = elements.ttsEngine.value === 'irodori';
  elements.ttsEngineName.textContent = irodori ? 'Irodori-TTS' : 'VOICEVOX';
  elements.irodoriSettings.hidden = !irodori;
  elements.voicevoxSettings.hidden = irodori;
  elements.ttsEngineStatus.textContent = irodori
    ? '接続状態を確認中…'
    : 'ローカル音声合成エンジン · localhost:50021';
  if (irodori) void checkIrodoriHealth();
}

function stopPlayback(reset = false): void {
  if (state.session) {
    state.session.cancelled = true;
    state.session.finish?.();
    try { state.session.source?.stop(); } catch {}
    try { state.session.bgmSource?.stop(); } catch {}
    try { state.session.ambientSource?.stop(); } catch {}
    if (state.session.mediaStartTimer !== undefined) window.clearTimeout(state.session.mediaStartTimer);
    state.audioElement?.pause();
    if (state.session.frame !== undefined) cancelAnimationFrame(state.session.frame);
    state.session.renderWorker?.terminate();
    if (state.session.renderWorkerUrl) URL.revokeObjectURL(state.session.renderWorkerUrl);
    state.session.captureTrack?.stop();
    state.session = null;
  }
  state.playing = false;
  state.playbackPhase = 'idle';
  if (reset) {
    state.progress = 0; state.overallProgress = 0; state.playbackElapsed = 0;
    setExpression('neutral');
    state.previousExpression = state.currentExpression;
    state.expressionTransitionStartedAt = Number.NEGATIVE_INFINITY;
  }
  state.mouth = 0; state.currentViseme = 'closed';
  elements.playButton.innerHTML = '<span>▶</span> プレビュー';
  elements.statusText.textContent = '準備完了'; draw();
}

function updatePlaybackPosition(elapsed: number, total = duration()): void {
  const opening = state.session?.openingDuration ?? openingCardDuration();
  const narration = state.session?.narrationDuration ?? narrationDuration();
  const safeElapsed = Math.max(0, Math.min(total, elapsed));
  state.playbackElapsed = safeElapsed;
  state.overallProgress = total > 0 ? safeElapsed / total : 0;
  const narrationElapsed = safeElapsed - opening;
  if (safeElapsed < opening) {
    state.playbackPhase = 'opening';
    state.progress = 0;
  } else if (narrationElapsed < narration) {
    state.playbackPhase = 'narration';
    state.progress = narration > 0 ? Math.max(0, Math.min(1, narrationElapsed / narration)) : 1;
  } else {
    state.playbackPhase = 'ending';
    state.progress = 1;
  }
  setExpression(state.playbackPhase === 'narration' ? expressionAt(playbackScriptSource(), state.progress) : 'neutral');
}

function animationLoop(session: PlaybackSession, start: number, analyser: AnalyserNode | null, data: Uint8Array<ArrayBuffer> | null): void {
  const now = audioContext?.currentTime ?? performance.now() / 1000;
  const elapsed = Math.min(session.duration, Math.max(0, session.startOffset + now - start));
  updatePlaybackPosition(elapsed, session.duration);
  const narrationElapsed = elapsed - session.openingDuration;
  const narrating = narrationElapsed >= 0 && narrationElapsed < session.narrationDuration;
  if (narrating && analyser && data) {
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (const value of data) { const sample = (value - 128) / 128; sum += sample * sample; }
    const rms = Math.sqrt(sum / data.length);
    state.mouth += (Math.min(1, Math.max(0, rms * 8 - .08)) - state.mouth) * .18;
  } else if (narrating) {
    const speaking = Math.sin(narrationElapsed * 8) * .5 + Math.sin(narrationElapsed * 13) * .3;
    state.mouth = Math.max(.04, .38 + speaking * .36);
  } else {
    state.mouth = 0;
  }
  const punctuationPause = narrating && isPunctuationPause(playbackScriptSource(), state.progress);
  if (punctuationPause) state.mouth = 0;
  if (state.mouth < .08) state.currentViseme = 'closed';
  else if (state.mouth < .25) state.currentViseme = Math.floor(elapsed * 3) % 2 === 0 ? 'i' : 'u';
  else if (state.mouth < .55) state.currentViseme = Math.floor(elapsed * 3) % 2 === 0 ? 'e' : 'o';
  else state.currentViseme = 'a';
  draw();
  session.captureTrack?.requestFrame();
  if (!session.cancelled && elapsed < session.duration && !session.renderWorker) {
    session.frame = requestAnimationFrame(() => animationLoop(session, start, analyser, data));
  }
}

async function beginPlayback({ record = false }: { record?: boolean } = {}): Promise<Blob | null> {
  if (state.playing) { stopPlayback(); return null; }
  if (!state.images.neutral) { notify('先に「キャラクター」から基本の立ち絵を選択してください。'); return null; }
  const ac = await ensureAudioContext();
  const opening = openingCardDuration();
  const narration = narrationDuration();
  const ending = endingCardDuration();
  const total = opening + narration + ending;
  const startOffset = record || state.overallProgress >= .999
    ? 0
    : Math.max(0, Math.min(total, state.playbackElapsed));
  const session: PlaybackSession = {
    cancelled: false,
    duration: total,
    startOffset,
    openingDuration: opening,
    narrationDuration: narration,
    endingDuration: ending
  };
  state.session = session; state.playing = true; state.exporting = record;
  updatePlaybackPosition(startOffset, total);
  elements.playButton.innerHTML = '<span>■</span> 停止';
  elements.statusText.textContent = record ? '書き出し中' : '再生中';

  let analyser: AnalyserNode | null = null;
  let data: Uint8Array<ArrayBuffer> | null = null;
  const hasAudio = Boolean(state.audioBuffer || state.audioElement || state.bgmBuffer || state.ambientBuffer);
  const destination = record && hasAudio ? ac.createMediaStreamDestination() : null;
  if (state.audioBuffer) {
    session.source = ac.createBufferSource(); session.source.buffer = state.audioBuffer;
    analyser = ac.createAnalyser(); analyser.fftSize = 512; data = new Uint8Array(analyser.fftSize);
    session.source.connect(analyser); analyser.connect(ac.destination);
    if (destination) analyser.connect(destination);
  } else if (state.audioElement) {
    state.audioMediaNode ??= ac.createMediaElementSource(state.audioElement);
    state.audioMediaNode.disconnect();
    analyser = ac.createAnalyser(); analyser.fftSize = 512; data = new Uint8Array(analyser.fftSize);
    state.audioMediaNode.connect(analyser); analyser.connect(ac.destination);
    if (destination) analyser.connect(destination);
  }
  if (state.bgmBuffer) {
    session.bgmSource = ac.createBufferSource();
    session.bgmSource.buffer = state.bgmBuffer;
    session.bgmSource.loop = elements.bgmLoop.checked;
    session.bgmGain = ac.createGain();
    session.bgmSource.connect(session.bgmGain);
    session.bgmGain.connect(ac.destination);
    if (destination) session.bgmGain.connect(destination);
  }
  if (state.ambientBuffer) {
    session.ambientSource = ac.createBufferSource();
    session.ambientSource.buffer = state.ambientBuffer;
    session.ambientSource.loop = elements.ambientLoop.checked;
    session.ambientGain = ac.createGain();
    session.ambientSource.connect(session.ambientGain);
    session.ambientGain.connect(ac.destination);
    if (destination) session.ambientGain.connect(destination);
  }

  let recorder: MediaRecorder | null = null;
  let recorded: Promise<Blob> | null = null;
  if (record) {
    const stream = elements.canvas.captureStream(30);
    const captureTrack = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined;
    if (captureTrack) session.captureTrack = captureTrack;
    destination?.stream.getAudioTracks().forEach(track => stream.addTrack(track));
    const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(candidate => MediaRecorder.isTypeSupported(candidate));
    const chunks: Blob[] = [];
    recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: 4_000_000 });
    const activeRecorder = recorder;
    recorded = new Promise(resolve => {
      activeRecorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      activeRecorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }));
    });
    activeRecorder.start(1000);
    if (typeof Worker !== 'undefined') {
      session.renderWorkerUrl = URL.createObjectURL(new Blob([
        'let timer;onmessage=e=>{if(e.data==="start"){clearInterval(timer);timer=setInterval(()=>postMessage("frame"),1000/30)}else if(e.data==="stop"){clearInterval(timer);close()}}'
      ], { type: 'text/javascript' }));
      session.renderWorker = new Worker(session.renderWorkerUrl);
    }
  }

  const start = ac.currentTime;
  const remainingDuration = Math.max(0, session.duration - session.startOffset);
  if (session.bgmGain) {
    const volume = Number(elements.bgmVolume.value) / 100;
    const fade = Math.min(1, remainingDuration / 4);
    session.bgmGain.gain.setValueAtTime(0, start);
    session.bgmGain.gain.linearRampToValueAtTime(volume, start + fade);
    session.bgmGain.gain.setValueAtTime(volume, Math.max(start + fade, start + remainingDuration - fade));
    session.bgmGain.gain.linearRampToValueAtTime(0, start + remainingDuration);
  }
  if (session.ambientGain) {
    const volume = Number(elements.ambientVolume.value) / 100;
    const fade = Math.min(2, remainingDuration / 4);
    session.ambientGain.gain.setValueAtTime(0, start);
    session.ambientGain.gain.linearRampToValueAtTime(volume, start + fade);
    session.ambientGain.gain.setValueAtTime(volume, Math.max(start + fade, start + remainingDuration - fade));
    session.ambientGain.gain.linearRampToValueAtTime(0, start + remainingDuration);
  }
  animationLoop(session, start, analyser, data);
  if (session.renderWorker) {
    session.renderWorker.onmessage = () => {
      if (!session.cancelled && state.session === session) animationLoop(session, start, analyser, data);
    };
    session.renderWorker.postMessage('start');
  }
  if (session.source && session.startOffset < session.openingDuration + session.narrationDuration) {
    const delay = Math.max(0, session.openingDuration - session.startOffset);
    const audioOffset = Math.max(0, session.startOffset - session.openingDuration);
    session.source.start(start + delay, audioOffset);
  }
  if (state.audioElement && session.startOffset < session.openingDuration + session.narrationDuration) {
    const delay = Math.max(0, session.openingDuration - session.startOffset);
    state.audioElement.currentTime = Math.max(0, session.startOffset - session.openingDuration);
    const playMedia = (): void => { void state.audioElement?.play().catch(error => notify(`長編音声を再生できませんでした: ${errorMessage(error)}`)); };
    if (delay > 0) session.mediaStartTimer = window.setTimeout(playMedia, delay * 1000);
    else playMedia();
  }
  const startBedAudio = (source: AudioBufferSourceNode | undefined, buffer: AudioBuffer | null, loop: boolean): void => {
    if (!source || !buffer || buffer.duration <= 0) return;
    if (!loop && session.startOffset >= buffer.duration) return;
    const offset = loop ? session.startOffset % buffer.duration : session.startOffset;
    source.start(start, offset);
  };
  startBedAudio(session.bgmSource, state.bgmBuffer, elements.bgmLoop.checked);
  startBedAudio(session.ambientSource, state.ambientBuffer, elements.ambientLoop.checked);
  await new Promise<void>(resolve => {
    const timer = window.setTimeout(resolve, remainingDuration * 1000 + 120);
    session.finish = () => { window.clearTimeout(timer); resolve(); };
  });
  delete session.finish;
  if (session.cancelled) {
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    if (recorded) await recorded;
    return null;
  }
  state.progress = 1; state.overallProgress = 1; state.playbackElapsed = session.duration; state.mouth = 0; draw();
  if (recorder && recorder.state !== 'inactive') recorder.stop();
  const blob = recorded ? await recorded : null;
  stopPlayback(); return blob;
}

async function exportVideo(): Promise<void> {
  if (state.exporting) return;
  state.exporting = true;
  exportCancelled = false;
  elements.cancelExport.hidden = false;
  elements.exportButton.disabled = true;
  try {
    const webm = await beginPlayback({ record: true }); if (!webm) return;
    elements.statusText.textContent = 'MP4変換中'; notify('録画が完了しました。MP4に変換しています…', true);
    exportController = new AbortController();
    const response = await fetch('/api/export', { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: webm, signal: exportController.signal });
    if (!response.ok) { const data = await response.json() as { error?: string }; throw new Error(data.error ?? 'MP4変換に失敗しました。'); }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a'); link.href = url; link.download = 'character-video.mp4'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000); notify('MP4を書き出しました。', true);
  } catch (error) {
    if (!exportCancelled) notify(errorMessage(error) || '動画の書き出しに失敗しました。');
  } finally {
    exportController = null;
    exportCancelled = false;
    state.exporting = false;
    elements.exportButton.disabled = false;
    elements.cancelExport.hidden = true;
    elements.statusText.textContent = '準備完了';
  }
}

function cancelExport(): void {
  if (!state.exporting) return;
  exportCancelled = true;
  exportController?.abort();
  stopPlayback();
  elements.statusText.textContent = '中止しています…';
  notify('MP4の書き出しを中止しました。', true);
}

const projectFieldIds = [
  'workTitle', 'workAuthor', 'workPublication', 'openingText', 'openingDuration', 'endingText', 'endingDuration',
  'aozoraUrl', 'scriptInput', 'pronunciationCorrections', 'ttsEngine', 'irodoriVoice', 'irodoriCaption', 'irodoriQuality', 'irodoriAttackFade',
  'voiceSpeed', 'speakerId', 'showCaptions', 'captionEffect', 'captionSize', 'captionX', 'captionY',
  'characterScale', 'backgroundScale', 'foregroundScale', 'characterMotion', 'hairMotion', 'legMotion',
  'mouthX', 'mouthY', 'mouthSize', 'useMouthSprites', 'bgmPreset', 'bgmVolume', 'bgmLoop',
  'ambientPreset', 'ambientVolume', 'ambientLoop'
] as const;

interface SavedProject {
  format: 'roudoku-app-project';
  version: 1;
  savedAt: string;
  fields: Record<string, string | boolean>;
  layerOffsets: Record<SceneLayer, LayerOffset>;
  activeLayer: SceneLayer;
  externalFiles: string[];
}

function projectControl(id: string): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null {
  const element = document.getElementById(id);
  return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement
    ? element
    : null;
}

function safeProjectFilename(value: string): string {
  const base = value.trim().replace(/[\\/:*?"<>|\u0000-\u001f]/gu, '_').slice(0, 80) || 'roudoku-app-project';
  return `${base}.roudoku.json`;
}

function saveProject(): void {
  const fields: Record<string, string | boolean> = {};
  for (const id of projectFieldIds) {
    const control = projectControl(id);
    if (!control) continue;
    fields[id] = control instanceof HTMLInputElement && control.type === 'checkbox' ? control.checked : control.value;
  }
  const externalFiles = [
    elements.baseImage.files?.[0]?.name,
    elements.backgroundImage.files?.[0]?.name,
    elements.foregroundImage.files?.[0]?.name,
    elements.audioFile.files?.[0]?.name,
    elements.bgmFile.files?.[0]?.name,
    elements.ambientFile.files?.[0]?.name
  ].filter((name): name is string => Boolean(name));
  const project: SavedProject = {
    format: 'roudoku-app-project',
    version: 1,
    savedAt: new Date().toISOString(),
    fields,
    layerOffsets: {
      background: { ...state.layerOffsets.background },
      character: { ...state.layerOffsets.character },
      foreground: { ...state.layerOffsets.foreground }
    },
    activeLayer: state.activeLayer,
    externalFiles
  };
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = safeProjectFilename(elements.workTitle.value);
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
  notify('プロジェクト設定を保存しました。', true);
}

function validOffset(value: unknown, fallback: LayerOffset): LayerOffset {
  if (!value || typeof value !== 'object') return { ...fallback };
  const candidate = value as { x?: unknown; y?: unknown };
  const x = Number(candidate.x);
  const y = Number(candidate.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : { ...fallback };
}

async function loadProject(file: File): Promise<void> {
  if (file.size > 5 * 1024 * 1024) throw new Error('プロジェクトファイルが大きすぎます');
  const project = JSON.parse(await file.text()) as Partial<SavedProject> & { format?: string };
  const compatibleFormat = project.format === 'roudoku-app-project' || project.format === 'vt-reader-project';
  if (!compatibleFormat || project.version !== 1 || !project.fields) {
    throw new Error('朗読娘のプロジェクトファイルではありません');
  }
  for (const id of projectFieldIds) {
    const value = project.fields[id];
    const control = projectControl(id);
    if (!control || value === undefined) continue;
    if (control instanceof HTMLInputElement && control.type === 'checkbox') {
      if (typeof value === 'boolean') control.checked = value;
    } else if (typeof value === 'string') {
      control.value = value;
    }
  }
  const offsets = project.layerOffsets;
  state.layerOffsets.background = validOffset(offsets?.background, defaultLayerOffsets.background);
  state.layerOffsets.character = validOffset(offsets?.character, defaultLayerOffsets.character);
  state.layerOffsets.foreground = validOffset(offsets?.foreground, defaultLayerOffsets.foreground);
  const activeLayer = project.activeLayer;
  setActiveLayer(activeLayer === 'background' || activeLayer === 'foreground' ? activeLayer : 'character');

  // 先に読み込まれた音声は維持し、プロジェクト側の台本・表示設定だけを復元する。
  const preservedAudio = Boolean(state.audioBuffer || state.audioElement);
  if (elements.bgmPreset.value === 'custom') elements.bgmPreset.value = '';
  if (elements.ambientPreset.value === 'custom') elements.ambientPreset.value = '';
  await Promise.all([
    loadBgmPreset(elements.bgmPreset.value, false),
    loadAmbientPreset(elements.ambientPreset.value, false)
  ]);
  document.querySelectorAll<HTMLInputElement>('input[type="range"]').forEach(input => input.dispatchEvent(new Event('input')));
  updateTtsEngine();
  updateScript();
  if (preservedAudio) {
    state.audioScriptSource = playbackScriptSource();
    state.audioCaptionTimes = null;
  }
  if (state.audioBuffer) {
    notify('プロジェクトの台本に合わせて字幕タイミングを再補正しています。', true);
    scheduleCaptionAlignment(state.audioBuffer);
  } else if (state.audioElement && state.audioBlob) {
    notify('プロジェクトの台本に合わせて長編WAVの字幕タイミングを再補正しています。', true);
    scheduleLongCaptionAlignment(state.audioBlob);
  }
  state.progress = 0; state.overallProgress = 0; state.playbackElapsed = 0;
  draw();
  const externalCount = project.externalFiles?.length ?? 0;
  notify(preservedAudio
    ? 'プロジェクトを読み込みました。先に読み込んだ音声は保持されています。'
    : externalCount > 0
      ? `プロジェクトを読み込みました。外部素材${externalCount}件は必要に応じて再選択してください。`
      : 'プロジェクトを読み込みました。音声を生成または読み込むと再生できます。', true);
}

document.querySelectorAll<HTMLButtonElement>('.tabs button').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll<HTMLButtonElement>('.tabs button').forEach(item => item.classList.toggle('active', item === button));
  document.querySelectorAll<HTMLElement>('.tab').forEach(tab => tab.classList.toggle('active', tab.id === `tab-${button.dataset.tab}`));
}));

elements.saveProject.addEventListener('click', saveProject);
elements.openProject.addEventListener('change', async () => {
  const file = elements.openProject.files?.[0];
  if (!file) return;
  try {
    if (state.playing) stopPlayback(true);
    await loadProject(file);
  } catch (error) {
    notify(`プロジェクトを読み込めませんでした: ${errorMessage(error)}`);
  } finally {
    elements.openProject.value = '';
  }
});

elements.script.addEventListener('input', updateScript);
elements.applyEnglishRuby.addEventListener('click', () => {
  const readings: Record<string, string> = {};
  elements.englishRubyList.querySelectorAll<HTMLInputElement>('input[data-word]').forEach(input => {
    const word = input.dataset.word;
    if (word && input.value.trim()) readings[word] = input.value.trim();
  });
  const converted = applyEnglishRuby(elements.script.value, readings);
  if (converted === elements.script.value) {
    notify('反映できる英単語がありません。');
    return;
  }
  elements.script.value = converted;
  updateScript();
  notify('英単語の読みを台本へ反映しました。', true);
});
function pronunciationReadings(): Record<string, string> {
  const readings: Record<string, string> = {};
  for (const [index, line] of elements.pronunciationCorrections.value.split(/\r?\n/u).entries()) {
    const separator = line.indexOf('=');
    if (!line.trim()) continue;
    if (separator < 1 || !line.slice(separator + 1).trim()) throw new Error(`${index + 1}行目は「漢字=よみ」で入力してください`);
    readings[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return readings;
}

elements.applyPronunciationCorrections.addEventListener('click', () => {
  try {
    const readings = pronunciationReadings();
    if (!Object.keys(readings).length) { notify('修正する読みを入力してください。'); return; }
    const converted = applyJapaneseRubyCorrections(elements.script.value, readings);
    if (converted === elements.script.value) { notify('新しく反映できる漢字がありません。'); return; }
    elements.script.value = converted;
    updateScript();
    elements.pronunciationRepairStatus.textContent = `${Object.keys(readings).length}語のルビを台本へ反映しました。音声を直す場合は右のボタンを押してください。`;
    notify('漢字の読みを台本へ一括反映しました。', true);
  } catch (error) {
    notify(errorMessage(error));
  }
});
elements.workTitle.addEventListener('input', updateScript);
elements.workAuthor.addEventListener('input', updateScript);
elements.workPublication.addEventListener('input', () => draw());
elements.openingText.addEventListener('input', () => draw());
elements.endingText.addEventListener('input', () => draw());
elements.openingDuration.addEventListener('input', () => draw());
elements.endingDuration.addEventListener('input', () => draw());
elements.importAozora.addEventListener('click', async () => {
  const url = elements.aozoraUrl.value.trim();
  if (!url) { notify('青空文庫の図書カードURLを入力してください。'); return; }
  elements.importAozora.disabled = true;
  elements.importAozora.textContent = '取得中…';
  elements.aozoraStatus.textContent = '青空文庫からXHTML版を取得しています…';
  try {
    const response = await fetch('/api/aozora', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url })
    });
    const data = await response.json() as { html?: string; sourceUrl?: string; firstPublication?: string; error?: string };
    if (!response.ok || !data.html) throw new Error(data.error ?? '作品を取得できませんでした');
    const imported = extractAozoraText(data.html);
    elements.workTitle.value = imported.title;
    elements.workAuthor.value = imported.author;
    elements.workPublication.value = data.firstPublication ?? '';
    if (data.firstPublication && !elements.openingText.value.includes('{{publication}}')) {
      elements.openingText.value = `${elements.openingText.value.trim()}\n{{publication}}`;
    }
    elements.script.value = imported.text;
    state.progress = 0;
    updateScript();
    const characterCount = [...plainText(imported.text)].length;
    elements.aozoraStatus.textContent = `${imported.title} · ${characterCount.toLocaleString()}文字 · ルビ読みに対応`;
    notify(`「${imported.title}」を読み込みました。`, true);
  } catch (error) {
    const message = errorMessage(error);
    elements.aozoraStatus.textContent = message;
    notify(message);
  } finally {
    elements.importAozora.disabled = false;
    elements.importAozora.textContent = '本文を取得';
  }
});
elements.expressionChips.addEventListener('click', event => {
  const button = (event.target as Element).closest<HTMLButtonElement>('button[data-tag]');
  const tag = button?.dataset.tag; if (!tag) return;
  const value = `[${tag}] `;
  elements.script.setRangeText(value, elements.script.selectionStart, elements.script.selectionEnd, 'end');
  elements.script.focus(); updateScript();
});

elements.baseImage.addEventListener('change', async () => {
  const file = elements.baseImage.files?.[0]; if (!file) return;
  await applyLayerFile('character', file);
});
elements.backgroundImage.addEventListener('change', async () => {
  const file = elements.backgroundImage.files?.[0]; if (!file) return;
  await applyLayerFile('background', file);
});
elements.foregroundImage.addEventListener('change', async () => {
  const file = elements.foregroundImage.files?.[0]; if (!file) return;
  await applyLayerFile('foreground', file);
});
document.querySelectorAll<HTMLInputElement>('[data-expression]').forEach(input => input.addEventListener('change', async () => {
  const file = input.files?.[0]; if (!file) return;
  const expression = input.dataset.expression as Expression;
  state.images[expression] = await fileToImage(file);
  state.mouthPatches[expression] = createMouthRemovalPatch(state.images[expression], expression);
  required<HTMLElement>(`#${expression}Name`).textContent = file.name; draw();
}));

(['mouthX', 'mouthY', 'mouthSize', 'characterScale', 'backgroundScale', 'foregroundScale', 'characterMotion', 'hairMotion', 'legMotion'] as const).forEach(id => elements[id].addEventListener('input', () => {
  required<HTMLOutputElement>(`#${id}Out`).textContent = `${elements[id].value}%`; draw();
}));
elements.layerButtons.addEventListener('click', event => {
  const button = (event.target as Element).closest<HTMLButtonElement>('[data-layer]');
  const layer = button?.dataset.layer as SceneLayer | undefined;
  if (layer) setActiveLayer(layer);
});
elements.resetLayerPosition.addEventListener('click', () => {
  state.layerOffsets[state.activeLayer] = defaultLayerOffset(state.activeLayer);
  draw();
});
elements.useMouthSprites.addEventListener('change', () => draw());
elements.showCaptions.addEventListener('change', () => draw());
elements.captionEffect.addEventListener('change', () => draw());
(['captionSize', 'captionX', 'captionY'] as const).forEach(id => elements[id].addEventListener('input', () => {
  const suffix = id === 'captionSize' ? 'px' : '%';
  required<HTMLOutputElement>(`#${id}Out`).textContent = `${elements[id].value}${suffix}`;
  draw();
}));
elements.expressionPreviewButtons.addEventListener('click', event => {
  const button = (event.target as Element).closest<HTMLButtonElement>('[data-preview-expression]');
  if (!button) return;
  if (state.playing) stopPlayback();
  const changed = setExpression(button.dataset.previewExpression as Expression);
  state.mouth = 0;
  state.currentViseme = 'closed';
  draw();
  if (changed) {
    const animateTransition = (frameTime: number): void => {
      if (state.playing) return;
      draw(frameTime / 1000);
      if (frameTime / 1000 - state.expressionTransitionStartedAt < expressionTransitionDuration) {
        requestAnimationFrame(animateTransition);
      }
    };
    requestAnimationFrame(animateTransition);
  }
});
elements.voiceSpeed.addEventListener('input', () => { required<HTMLOutputElement>('#voiceSpeedOut').textContent = `${Number(elements.voiceSpeed.value).toFixed(2)}×`; });
elements.irodoriAttackFade.addEventListener('input', () => {
  elements.irodoriAttackFadeOut.textContent = `${elements.irodoriAttackFade.value}ms`;
});
elements.audioFile.addEventListener('change', () => { const file = elements.audioFile.files?.[0]; if (file) void loadAudio(file, file.name); });
elements.bgmPreset.addEventListener('change', () => { void loadBgmPreset(elements.bgmPreset.value); });
elements.bgmFile.addEventListener('change', () => {
  const file = elements.bgmFile.files?.[0];
  if (!file) return;
  elements.bgmPreset.value = 'custom';
  elements.bgmFileName.textContent = file.name;
  void loadBgm(file, file.name);
});
elements.bgmVolume.addEventListener('input', () => {
  const value = Number(elements.bgmVolume.value);
  elements.bgmVolumeOut.textContent = `${value}%`;
  if (state.session?.bgmGain && audioContext) {
    state.session.bgmGain.gain.setTargetAtTime(value / 100, audioContext.currentTime, .04);
  }
});
elements.ambientPreset.addEventListener('change', () => { void loadAmbientPreset(elements.ambientPreset.value); });
elements.ambientFile.addEventListener('change', () => {
  const file = elements.ambientFile.files?.[0];
  if (!file) return;
  elements.ambientPreset.value = 'custom';
  elements.ambientFileName.textContent = file.name;
  void loadAmbient(file, file.name);
});
elements.ambientVolume.addEventListener('input', () => {
  const value = Number(elements.ambientVolume.value);
  elements.ambientVolumeOut.textContent = `${value}%`;
  if (state.session?.ambientGain && audioContext) {
    state.session.ambientGain.gain.setTargetAtTime(value / 100, audioContext.currentTime, .04);
  }
});
elements.ttsEngine.addEventListener('change', updateTtsEngine);
elements.irodoriReference.addEventListener('change', () => {
  const file = elements.irodoriReference.files?.[0];
  elements.irodoriReferenceName.textContent = file?.name ?? '未選択';
  if (file && elements.irodoriVoice.value.trim() === 'none') {
    const stem = file.name.replace(/\.[^.]+$/, '').replace(/[^\p{Letter}\p{Number}_.-]+/gu, '_').slice(0, 80);
    elements.irodoriVoice.value = stem || 'reference';
  }
});
elements.uploadIrodoriVoice.addEventListener('click', async () => {
  const file = elements.irodoriReference.files?.[0];
  const voiceId = elements.irodoriVoice.value.trim();
  if (!file) { notify('登録する参照音声を選択してください。'); return; }
  if (!voiceId || voiceId === 'none') { notify('参照音声の声IDを入力してください。'); return; }
  elements.uploadIrodoriVoice.disabled = true;
  elements.uploadIrodoriVoice.textContent = '登録中…';
  try {
    const form = new FormData();
    form.append('voice_id', voiceId);
    form.append('file', file, file.name);
    const response = await fetch('/api/irodori/voices', { method: 'POST', body: form });
    const data = await response.json() as { error?: string; detail?: string };
    if (!response.ok) throw new Error(data.detail ?? data.error ?? '参照音声を登録できませんでした');
    elements.ttsEngineStatus.textContent = `声「${voiceId}」を登録済み`;
    notify(`Irodori-TTSへ声「${voiceId}」を登録しました。`, true);
  } catch (error) {
    notify(errorMessage(error));
  } finally {
    elements.uploadIrodoriVoice.disabled = false;
    elements.uploadIrodoriVoice.textContent = '声を登録';
  }
});

function setVoiceGenerationState(generating: boolean): void {
  elements.generateVoice.disabled = generating;
  elements.generateVoiceFromScript.disabled = generating;
  elements.generateVoiceAndExport.disabled = generating || combinedWorkflowRunning;
  elements.repairPronunciationAudio.disabled = generating;
  elements.generateVoice.textContent = generating ? '音声を生成中…' : '台本から音声を生成';
  elements.generateVoiceFromScript.textContent = generating ? '音声を生成中…' : '音声を生成';
  elements.cancelVoice.hidden = !generating;
  elements.cancelVoiceFromScript.hidden = !generating;
}

function saveNarrationAudio(): void {
  const blob = state.audioBlob;
  if (!blob) { notify('先に音声を生成または読み込んでください。'); return; }
  const requestedExtension = state.audioName.match(/\.(wav|mp3|m4a|ogg)$/i)?.[0].toLowerCase();
  const extension = requestedExtension ?? (blob.type.includes('mpeg') ? '.mp3' : blob.type.includes('ogg') ? '.ogg' : '.wav');
  const title = elements.workTitle.value.trim() || '朗読音声';
  const filename = `${title.replace(/[\\/:*?"<>|\u0000-\u001f]/gu, '_').slice(0, 80)}${extension}`;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 3000);
  notify(`音声を「${filename}」として保存しました。`, true);
}

function speechRequest(text: string): { endpoint: string; body: Record<string, string | number>; name: string } {
  const irodori = elements.ttsEngine.value === 'irodori';
  return irodori
    ? {
        endpoint: '/api/irodori/speech',
        body: {
          text,
          voice: elements.irodoriVoice.value,
          speed: Number(elements.voiceSpeed.value),
          caption: elements.irodoriCaption.value,
          quality: elements.irodoriQuality.value,
          attackFadeMs: Number(elements.irodoriAttackFade.value)
        },
        name: 'Irodori-TTS音声.wav'
      }
    : {
        endpoint: '/api/tts',
        body: { text, speaker: Number(elements.speakerId.value), speedScale: Number(elements.voiceSpeed.value) },
        name: 'VOICEVOX音声.wav'
      };
}

async function fetchSpeech(text: string, signal: AbortSignal): Promise<{ blob: Blob; name: string }> {
  const request = speechRequest(text);
  const response = await fetch(request.endpoint, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request.body), signal
  });
  if (!response.ok) {
    const data = await response.json() as { error?: string; detail?: string };
    throw new Error(data.detail ?? data.error ?? '音声生成に失敗しました。');
  }
  return { blob: await response.blob(), name: request.name };
}

async function generateScriptVoice(): Promise<boolean> {
  if (voiceGenerationController) return false;
  const controller = new AbortController();
  voiceGenerationController = controller;
  setVoiceGenerationState(true);
  try {
    const scriptSource = playbackScriptSource();
    const generated = await fetchSpeech(plainText(scriptSource), controller.signal);
    await loadAudio(generated.blob, generated.name, scriptSource);
    return true;
  } catch (error) {
    if (!controller.signal.aborted) notify(errorMessage(error));
    return false;
  } finally {
    if (voiceGenerationController === controller) voiceGenerationController = null;
    setVoiceGenerationState(false);
  }
}

interface CaptionRepairRange { from: number; to: number }

function captionRangesForIndexes(cues: readonly CaptionCue[], indexes: readonly number[]): CaptionRepairRange[] {
  const sentenceEnd = (text: string): boolean => /[。．.!！?？…][」』）)】］\]”’]*\s*$/u.test(text);
  const ranges: CaptionRepairRange[] = [];
  for (const index of [...new Set(indexes)].sort((left, right) => left - right)) {
    let from = index;
    let to = index;
    while (from > 0 && !sentenceEnd(cues[from - 1]!.text)) from -= 1;
    while (to < cues.length - 1 && !sentenceEnd(cues[to]!.text)) to += 1;
    const previous = ranges.at(-1);
    if (previous && from <= previous.to + 1) previous.to = Math.max(previous.to, to);
    else ranges.push({ from, to });
  }
  return ranges;
}

function changedCaptionRanges(before: readonly CaptionCue[], after: readonly CaptionCue[]): CaptionRepairRange[] {
  if (before.length !== after.length || before.some((cue, index) => cue.text !== after[index]?.text)) {
    throw new Error('読み以外の台本文字も変わっています。部分修正には表示文章が同じ音声を使用してください。');
  }
  return captionRangesForIndexes(before, before.flatMap((cue, index) => cue.spoken === after[index]!.spoken ? [] : [index]));
}

function base64Url(value: string): string {
  return btoa(value).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

async function repairPronunciationAudio(): Promise<void> {
  if (voiceGenerationController) return;
  if (!state.audioBlob || !state.audioScriptSource) {
    notify('先に元の朗読音声を生成または読み込んでください。');
    return;
  }
  if (!state.audioCaptionTimes) {
    notify('音声の字幕タイミングを解析中です。完了後にもう一度お試しください。');
    return;
  }
  const currentSource = playbackScriptSource();
  const beforeCues = captionCues(state.audioScriptSource);
  const afterCues = captionCues(currentSource);
  let ranges: CaptionRepairRange[];
  try {
    ranges = changedCaptionRanges(beforeCues, afterCues);
  } catch (error) {
    notify(errorMessage(error));
    return;
  }
  let forced = false;
  if (!ranges.length) {
    try {
      const words = Object.keys(pronunciationReadings());
      const matchingIndexes = afterCues.flatMap((cue, index) => words.some(word => cue.text.includes(word)) ? [index] : []);
      ranges = captionRangesForIndexes(afterCues, matchingIndexes);
      forced = ranges.length > 0;
    } catch (error) {
      notify(errorMessage(error));
      return;
    }
    if (!ranges.length) {
      notify('読みの変更がありません。強制再生成する場合は「漢字の読み修正」へ対象語を入力してください。');
      return;
    }
  }
  if (ranges.length > 50) {
    notify('修正区間が50件を超えています。いくつかに分けて修正してください。');
    return;
  }
  const times = state.audioCaptionTimes;
  if (times.length !== beforeCues.length + 1) {
    notify('元音声の文境界が台本と一致しません。字幕タイミングの補正完了を待ってください。');
    return;
  }

  const controller = new AbortController();
  voiceGenerationController = controller;
  setVoiceGenerationState(true);
  elements.repairPronunciationAudio.textContent = `修正文を生成中 0/${ranges.length}`;
  elements.pronunciationRepairStatus.textContent = `${ranges.length}区間の修正文を${forced ? '同じルビで強制' : ''}生成します。`;
  try {
    const replacements: Blob[] = [];
    for (const [index, range] of ranges.entries()) {
      elements.repairPronunciationAudio.textContent = `修正文を生成中 ${index + 1}/${ranges.length}`;
      const text = afterCues.slice(range.from, range.to + 1).map(cue => cue.spoken).join('');
      replacements.push((await fetchSpeech(text, controller.signal)).blob);
    }
    elements.repairPronunciationAudio.textContent = '元音声へ差し替え中…';
    const manifest = ranges.map((range, index) => ({
      start: times[range.from]!,
      end: times[range.to + 1]!,
      size: replacements[index]!.size
    }));
    const response = await fetch('/api/audio/repair', {
      method: 'POST',
      headers: {
        'content-type': 'application/octet-stream',
        'x-roudoku-repairs': base64Url(JSON.stringify(manifest))
      },
      body: new Blob([...replacements, state.audioBlob]),
      signal: controller.signal
    });
    if (!response.ok) {
      const data = await response.json() as { error?: string; detail?: string };
      throw new Error(data.detail ?? data.error ?? '修正文を元音声へ差し替えられませんでした。');
    }
    await loadAudio(await response.blob(), `${state.audioName.replace(/\.wav$/iu, '')}-読み修正版.wav`, currentSource);
    elements.pronunciationRepairStatus.textContent = `${ranges.length}区間の音声を修正しました。必要なら音声を保存してください。`;
    notify(`${ranges.length}区間の音声を${forced ? '同じルビで再生成' : '修正'}しました。`, true);
  } catch (error) {
    if (!controller.signal.aborted) notify(errorMessage(error));
  } finally {
    if (voiceGenerationController === controller) voiceGenerationController = null;
    setVoiceGenerationState(false);
    elements.repairPronunciationAudio.textContent = '変更文だけ音声を修正';
  }
}

async function generateVoiceAndExport(): Promise<void> {
  if (combinedWorkflowRunning || voiceGenerationController || state.exporting) return;
  if (state.playing) stopPlayback(true);
  combinedWorkflowRunning = true;
  elements.generateVoiceAndExport.disabled = true;
  elements.generateVoiceAndExport.textContent = '音声を生成中…';
  try {
    const generated = await generateScriptVoice();
    if (!generated) return;
    elements.generateVoiceAndExport.textContent = 'MP4を書き出し中…';
    await exportVideo();
  } finally {
    combinedWorkflowRunning = false;
    elements.generateVoiceAndExport.disabled = false;
    elements.generateVoiceAndExport.textContent = '音声生成 → MP4';
  }
}

function cancelVoiceGeneration(): void {
  if (!voiceGenerationController) return;
  voiceGenerationController.abort();
  setVoiceGenerationState(false);
  notify('音声生成を中止しました。', true);
}

elements.generateVoice.addEventListener('click', () => { void generateScriptVoice(); });
elements.generateVoiceFromScript.addEventListener('click', () => { void generateScriptVoice(); });
elements.generateVoiceAndExport.addEventListener('click', () => { void generateVoiceAndExport(); });
elements.repairPronunciationAudio.addEventListener('click', () => { void repairPronunciationAudio(); });
elements.saveAudio.addEventListener('click', saveNarrationAudio);
elements.saveAudioFromScript.addEventListener('click', saveNarrationAudio);
elements.cancelVoice.addEventListener('click', cancelVoiceGeneration);
elements.cancelVoiceFromScript.addEventListener('click', cancelVoiceGeneration);

let draggedPointer: { id: number; x: number; y: number } | null = null;
function canvasPointerPosition(event: PointerEvent): { x: number; y: number } {
  const bounds = elements.canvas.getBoundingClientRect();
  return {
    x: (event.clientX - bounds.left) * elements.canvas.width / bounds.width,
    y: (event.clientY - bounds.top) * elements.canvas.height / bounds.height
  };
}

elements.canvas.addEventListener('pointerdown', event => {
  const point = canvasPointerPosition(event);
  draggedPointer = { id: event.pointerId, x: point.x, y: point.y };
  elements.canvas.setPointerCapture(event.pointerId);
  elements.canvas.classList.add('dragging');
  event.preventDefault();
});
elements.canvas.addEventListener('pointermove', event => {
  if (!draggedPointer || draggedPointer.id !== event.pointerId) return;
  const point = canvasPointerPosition(event);
  const offset = state.layerOffsets[state.activeLayer];
  offset.x += point.x - draggedPointer.x;
  offset.y += point.y - draggedPointer.y;
  draggedPointer.x = point.x;
  draggedPointer.y = point.y;
  draw();
});
const finishLayerDrag = (event: PointerEvent): void => {
  if (!draggedPointer || draggedPointer.id !== event.pointerId) return;
  draggedPointer = null;
  elements.canvas.classList.remove('dragging');
  if (elements.canvas.hasPointerCapture(event.pointerId)) elements.canvas.releasePointerCapture(event.pointerId);
};
elements.canvas.addEventListener('pointerup', finishLayerDrag);
elements.canvas.addEventListener('pointercancel', finishLayerDrag);

elements.stageWrap.addEventListener('dragover', event => {
  if ([...event.dataTransfer?.items ?? []].some(item => item.kind === 'file')) {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    elements.stageWrap.classList.add('layer-drop');
  }
});
elements.stageWrap.addEventListener('dragleave', event => {
  if (!elements.stageWrap.contains(event.relatedTarget as Node | null)) {
    elements.stageWrap.classList.remove('layer-drop');
  }
});
elements.stageWrap.addEventListener('drop', event => {
  event.preventDefault();
  elements.stageWrap.classList.remove('layer-drop');
  const file = event.dataTransfer?.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    notify('画像ファイルをドロップしてください。');
    return;
  }
  void applyLayerFile(state.activeLayer, file);
});

elements.playButton.addEventListener('click', () => { void beginPlayback(); });
elements.rewind.addEventListener('click', () => stopPlayback(true));
elements.exportButton.addEventListener('click', () => { void exportVideo(); });
elements.cancelExport.addEventListener('click', cancelExport);

function seekPreview(clientX: number): void {
  const bounds = elements.timeline.getBoundingClientRect();
  const ratio = bounds.width > 0 ? Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width)) : 0;
  state.mouth = 0;
  state.currentViseme = 'closed';
  updatePlaybackPosition(duration() * ratio);
  state.previousExpression = state.currentExpression;
  state.expressionTransitionStartedAt = Number.NEGATIVE_INFINITY;
  draw();
}

let timelineDrag: { pointerId: number; resume: boolean } | null = null;
elements.timeline.addEventListener('pointerdown', event => {
  if (state.exporting) { notify('MP4書き出し中は再生位置を変更できません。'); return; }
  const resume = state.playing;
  if (resume) stopPlayback();
  timelineDrag = { pointerId: event.pointerId, resume };
  elements.timeline.setPointerCapture(event.pointerId);
  seekPreview(event.clientX);
  event.preventDefault();
});
elements.timeline.addEventListener('pointermove', event => {
  if (timelineDrag?.pointerId !== event.pointerId) return;
  seekPreview(event.clientX);
});
elements.timeline.addEventListener('pointerup', event => {
  if (timelineDrag?.pointerId !== event.pointerId) return;
  seekPreview(event.clientX);
  const resume = timelineDrag.resume;
  timelineDrag = null;
  elements.timeline.releasePointerCapture(event.pointerId);
  if (resume && state.overallProgress < .999) void beginPlayback();
});
elements.timeline.addEventListener('pointercancel', event => {
  if (timelineDrag?.pointerId !== event.pointerId) return;
  const resume = timelineDrag.resume;
  timelineDrag = null;
  if (resume && state.overallProgress < .999) void beginPlayback();
});
elements.timeline.addEventListener('keydown', event => {
  if (state.exporting || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const wasPlaying = state.playing;
  if (wasPlaying) stopPlayback();
  const total = duration();
  const next = event.key === 'Home' ? 0
    : event.key === 'End' ? total
      : state.playbackElapsed + (event.key === 'ArrowLeft' ? -5 : 5);
  updatePlaybackPosition(next, total);
  state.previousExpression = state.currentExpression;
  state.expressionTransitionStartedAt = Number.NEGATIVE_INFINITY;
  state.mouth = 0;
  state.currentViseme = 'closed';
  draw();
  if (wasPlaying && state.overallProgress < .999) void beginPlayback();
  event.preventDefault();
});
elements.stageExpand.addEventListener('click', () => { void toggleStageFullscreen(); });
document.addEventListener('fullscreenchange', updateExpandButton);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && elements.stageWrap.classList.contains('stage-expanded')) {
    elements.stageWrap.classList.remove('stage-expanded');
    updateExpandButton();
  }
});
window.addEventListener('beforeunload', () => stopPlayback());

setActiveLayer('character'); updateTtsEngine(); updateScript(); draw(); void loadDefaultCharacter(); void loadBgmPreset(elements.bgmPreset.value, false); void loadAmbientPreset(elements.ambientPreset.value, false);
