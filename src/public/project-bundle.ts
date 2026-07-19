const bundleMagic = new TextEncoder().encode('ROUDOKU-APP-BUNDLE-1\n');
const maxEnvelopeBytes = 5 * 1024 * 1024;
export const maxProjectBundleBytes = 8 * 1024 * 1024 * 1024;

interface BundleEnvelope {
  format: 'roudoku-app-bundle';
  version: 1;
  project: unknown;
  audio: {
    name: string;
    type: string;
    size: number;
  };
}

export interface ProjectBundleAudio {
  blob: Blob;
  name: string;
}

export interface ProjectBundleContents {
  project: unknown;
  audio: ProjectBundleAudio;
}

function cleanAudioName(value: unknown): string {
  if (typeof value !== 'string') return '朗読音声.wav';
  return value.replace(/[\u0000-\u001f\u007f]/gu, '').trim().slice(0, 200) || '朗読音声.wav';
}

export function createProjectBundle(project: unknown, audio: ProjectBundleAudio): Blob {
  const audioType = audio.blob.type || 'application/octet-stream';
  const envelope: BundleEnvelope = {
    format: 'roudoku-app-bundle',
    version: 1,
    project,
    audio: {
      name: cleanAudioName(audio.name),
      type: audioType,
      size: audio.blob.size
    }
  };
  const envelopeBytes = new TextEncoder().encode(JSON.stringify(envelope));
  if (envelopeBytes.byteLength > maxEnvelopeBytes) throw new Error('プロジェクト設定が大きすぎます');
  const lengthBytes = new Uint8Array(4);
  new DataView(lengthBytes.buffer).setUint32(0, envelopeBytes.byteLength, true);
  return new Blob([bundleMagic, lengthBytes, envelopeBytes, audio.blob], {
    type: 'application/x-roudoku-project'
  });
}

export async function readProjectBundle(file: Blob): Promise<ProjectBundleContents | null> {
  const fixedHeaderSize = bundleMagic.byteLength + 4;
  if (file.size < fixedHeaderSize) return null;
  const fixedHeader = new Uint8Array(await file.slice(0, fixedHeaderSize).arrayBuffer());
  for (let index = 0; index < bundleMagic.byteLength; index += 1) {
    if (fixedHeader[index] !== bundleMagic[index]) return null;
  }
  if (file.size > maxProjectBundleBytes) throw new Error('プロジェクトファイルが大きすぎます');
  const envelopeSize = new DataView(fixedHeader.buffer, fixedHeader.byteOffset + bundleMagic.byteLength, 4).getUint32(0, true);
  if (envelopeSize < 2 || envelopeSize > maxEnvelopeBytes || fixedHeaderSize + envelopeSize > file.size) {
    throw new Error('プロジェクトファイルが壊れています');
  }
  let envelope: Partial<BundleEnvelope>;
  try {
    envelope = JSON.parse(await file.slice(fixedHeaderSize, fixedHeaderSize + envelopeSize).text()) as Partial<BundleEnvelope>;
  } catch {
    throw new Error('プロジェクト設定を解析できません');
  }
  if (envelope.format !== 'roudoku-app-bundle' || envelope.version !== 1 || !envelope.audio || envelope.project === undefined) {
    throw new Error('朗読娘のプロジェクトファイルではありません');
  }
  const audioSize = Number(envelope.audio.size);
  const audioOffset = fixedHeaderSize + envelopeSize;
  if (!Number.isSafeInteger(audioSize) || audioSize < 0 || audioOffset + audioSize !== file.size) {
    throw new Error('プロジェクト内の音声データが壊れています');
  }
  const audioType = typeof envelope.audio.type === 'string' && envelope.audio.type.length <= 100
    ? envelope.audio.type
    : 'application/octet-stream';
  return {
    project: envelope.project,
    audio: {
      blob: file.slice(audioOffset, audioOffset + audioSize, audioType),
      name: cleanAudioName(envelope.audio.name)
    }
  };
}
