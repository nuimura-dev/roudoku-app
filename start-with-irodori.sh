#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
IRODORI_SERVER_DIR="${IRODORI_SERVER_DIR:-${ROOT_DIR}/../Irodori-TTS-Server}"
IRODORI_HOST="${IRODORI_HOST:-127.0.0.1}"
IRODORI_PORT="${IRODORI_PORT:-8088}"
IRODORI_TTS_URL="${IRODORI_TTS_URL:-http://${IRODORI_HOST}:${IRODORI_PORT}}"
IRODORI_HF_CHECKPOINT="${IRODORI_HF_CHECKPOINT:-Aratako/Irodori-TTS-600M-v3-VoiceDesign}"
IRODORI_VOICES_DIR="${IRODORI_VOICES_DIR:-${ROOT_DIR}/assets/voices}"
IRODORI_DEFAULT_VOICE="${IRODORI_DEFAULT_VOICE:-vd_husky_30s_c}"
IRODORI_STARTUP_TIMEOUT="${IRODORI_STARTUP_TIMEOUT:-900}"
IRODORI_PID=""

export IRODORI_HF_CHECKPOINT IRODORI_VOICES_DIR IRODORI_DEFAULT_VOICE

cleanup() {
  if [[ -n "${IRODORI_PID}" ]] && kill -0 "${IRODORI_PID}" 2>/dev/null; then
    echo
    echo "Irodori-TTS Serverを終了しています…"
    kill "${IRODORI_PID}" 2>/dev/null || true
    wait "${IRODORI_PID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

if curl --silent --fail --max-time 2 "${IRODORI_TTS_URL}/health" >/dev/null 2>&1; then
  echo "Irodori-TTS Serverはすでに起動しています: ${IRODORI_TTS_URL}"
else
  if [[ ! -d "${IRODORI_SERVER_DIR}" ]]; then
    echo "Irodori-TTS Serverが見つかりません: ${IRODORI_SERVER_DIR}" >&2
    echo "READMEの手順で公式サーバーをセットアップするか、IRODORI_SERVER_DIRを指定してください。" >&2
    exit 1
  fi
  if ! command -v uv >/dev/null 2>&1; then
    echo "uvが見つかりません。先にuvをインストールしてください。" >&2
    exit 1
  fi

  echo "Irodori-TTS Serverを起動しています: ${IRODORI_TTS_URL}"
  echo "音声モデル: ${IRODORI_HF_CHECKPOINT} / デフォルト音声: ${IRODORI_DEFAULT_VOICE}"
  echo "初回はモデル取得と読込に数分かかります（最大 ${IRODORI_STARTUP_TIMEOUT} 秒待機）。"
  (
    cd "${IRODORI_SERVER_DIR}"
    exec uv run --no-sync python -m irodori_openai_tts --host "${IRODORI_HOST}" --port "${IRODORI_PORT}"
  ) &
  IRODORI_PID=$!

  started_at=${SECONDS}
  while (( SECONDS - started_at < IRODORI_STARTUP_TIMEOUT )); do
    if curl --silent --fail --max-time 2 "${IRODORI_TTS_URL}/health" >/dev/null 2>&1; then
      echo "Irodori-TTS Serverに接続しました。"
      break
    fi
    if ! kill -0 "${IRODORI_PID}" 2>/dev/null; then
      wait "${IRODORI_PID}" || true
      echo "Irodori-TTS Serverの起動に失敗しました。" >&2
      exit 1
    fi
    sleep 1
  done

  if ! curl --silent --fail --max-time 2 "${IRODORI_TTS_URL}/health" >/dev/null 2>&1; then
    echo "Irodori-TTS Serverが ${IRODORI_STARTUP_TIMEOUT} 秒以内に応答しませんでした。" >&2
    exit 1
  fi
fi

echo "VT Readerを起動します: http://localhost:${PORT:-4173}"
cd "${ROOT_DIR}"
IRODORI_TTS_URL="${IRODORI_TTS_URL}" npm start
