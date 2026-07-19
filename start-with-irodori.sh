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
RUNTIME_DIR="${ROUDOKU_RUNTIME_DIR:-${XDG_RUNTIME_DIR:-/tmp}/roudoku-app-${UID}}"
APP_PID_FILE="${RUNTIME_DIR}/app.pid"
IRODORI_PID_FILE="${RUNTIME_DIR}/irodori.pid"
ACTION="${1:-start}"
APP_PID=""
IRODORI_PID=""

export IRODORI_HF_CHECKPOINT IRODORI_VOICES_DIR IRODORI_DEFAULT_VOICE

usage() {
  echo "使い方: $0 [start|stop|restart|status]"
}

process_start_time() {
  local pid="$1"
  [[ -r "/proc/${pid}/stat" ]] || return 1
  # 2番目のcommフィールドは空白を含められるため、最後の`) `より後を
  # フィールド3として数える。開始時刻（フィールド22）は残りの20番目。
  sed 's/^.*) //' "/proc/${pid}/stat" | awk '{ print $20 }'
}

write_pid_file() {
  local file="$1" pid="$2" start_time
  start_time="$(process_start_time "${pid}")"
  mkdir -p "${RUNTIME_DIR}"
  printf '%s %s\n' "${pid}" "${start_time}" >"${file}"
}

managed_pid() {
  local file="$1" pid saved_start current_start
  [[ -r "${file}" ]] || return 1
  read -r pid saved_start <"${file}" || return 1
  [[ "${pid}" =~ ^[0-9]+$ && "${saved_start}" =~ ^[0-9]+$ ]] || return 1
  current_start="$(process_start_time "${pid}" 2>/dev/null)" || return 1
  [[ "${current_start}" == "${saved_start}" ]] || return 1
  printf '%s\n' "${pid}"
}

stop_managed() {
  local label="$1" file="$2" pid
  if ! pid="$(managed_pid "${file}")"; then
    rm -f "${file}"
    return 1
  fi

  echo "${label}を終了しています… (PID ${pid})"
  kill -TERM -- "-${pid}" 2>/dev/null || kill -TERM "${pid}" 2>/dev/null || true
  for _ in {1..100}; do
    if ! kill -0 "${pid}" 2>/dev/null; then
      rm -f "${file}"
      return 0
    fi
    sleep .1
  done
  echo "${label}が終了しないため強制終了します。" >&2
  kill -KILL -- "-${pid}" 2>/dev/null || kill -KILL "${pid}" 2>/dev/null || true
  rm -f "${file}"
}

legacy_app_pid() {
  local port="${PORT:-4173}" pid cwd command
  command -v ss >/dev/null 2>&1 || return 1
  pid="$(ss -ltnpH "sport = :${port}" 2>/dev/null | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' | head -n 1)"
  [[ "${pid}" =~ ^[0-9]+$ ]] || return 1
  cwd="$(readlink "/proc/${pid}/cwd" 2>/dev/null)" || return 1
  command="$(tr '\0' ' ' <"/proc/${pid}/cmdline" 2>/dev/null)" || return 1
  [[ "${cwd}" == "${ROOT_DIR}" && "${command}" == *"node dist/server.js"* ]] || return 1
  printf '%s\n' "${pid}"
}

stop_legacy_app() {
  local pid
  pid="$(legacy_app_pid)" || return 1
  echo "朗読娘の旧起動プロセスを終了しています… (PID ${pid})"
  kill -TERM "${pid}" 2>/dev/null || return 1
  for _ in {1..100}; do
    kill -0 "${pid}" 2>/dev/null || return 0
    sleep .1
  done
  echo "朗読娘の旧起動プロセスが終了しないため強制終了します。" >&2
  kill -KILL "${pid}" 2>/dev/null || true
}

stop_all() {
  if ! stop_managed "朗読娘" "${APP_PID_FILE}"; then
    stop_legacy_app || echo "朗読娘: このスクリプトが起動したプロセスはありません。"
  fi
  stop_managed "Irodori-TTS Server" "${IRODORI_PID_FILE}" \
    || echo "Irodori-TTS Server: このスクリプトが起動したプロセスはありません。"
  rmdir "${RUNTIME_DIR}" 2>/dev/null || true
}

status_all() {
  local pid
  if pid="$(managed_pid "${APP_PID_FILE}")"; then
    echo "朗読娘: 起動中 (PID ${pid}, http://localhost:${PORT:-4173})"
  elif pid="$(legacy_app_pid)"; then
    echo "朗読娘: 旧スクリプトから起動中 (PID ${pid}, http://localhost:${PORT:-4173})"
  else
    echo "朗読娘: 停止中"
  fi
  if pid="$(managed_pid "${IRODORI_PID_FILE}")"; then
    echo "Irodori-TTS Server: 起動中 (PID ${pid}, ${IRODORI_TTS_URL})"
  elif curl --silent --fail --max-time 2 "${IRODORI_TTS_URL}/health" >/dev/null 2>&1; then
    echo "Irodori-TTS Server: 外部プロセスとして起動中 (${IRODORI_TTS_URL})"
  else
    echo "Irodori-TTS Server: 停止中"
  fi
}

cleanup() {
  trap - EXIT INT TERM
  stop_all
}

start_all() {
  local existing_pid started_at
  if existing_pid="$(managed_pid "${APP_PID_FILE}")"; then
    echo "朗読娘はすでに起動しています (PID ${existing_pid})。"
    echo "再起動する場合: $0 restart"
    return 1
  fi
  if existing_pid="$(legacy_app_pid)"; then
    echo "朗読娘が旧スクリプトから起動しています (PID ${existing_pid})。" >&2
    echo "停止する場合: $0 stop / 再起動する場合: $0 restart" >&2
    return 1
  fi
  rm -f "${APP_PID_FILE}"
  if ! managed_pid "${IRODORI_PID_FILE}" >/dev/null; then
    rm -f "${IRODORI_PID_FILE}"
  fi
  if ! command -v setsid >/dev/null 2>&1; then
    echo "setsidが見つかりません。util-linuxをインストールしてください。" >&2
    return 1
  fi

  trap cleanup EXIT INT TERM
  if curl --silent --fail --max-time 2 "${IRODORI_TTS_URL}/health" >/dev/null 2>&1; then
    echo "Irodori-TTS Serverはすでに起動しています: ${IRODORI_TTS_URL}"
  else
    if [[ ! -d "${IRODORI_SERVER_DIR}" ]]; then
      echo "Irodori-TTS Serverが見つかりません: ${IRODORI_SERVER_DIR}" >&2
      echo "READMEの手順で公式サーバーをセットアップするか、IRODORI_SERVER_DIRを指定してください。" >&2
      return 1
    fi
    if ! command -v uv >/dev/null 2>&1; then
      echo "uvが見つかりません。先にuvをインストールしてください。" >&2
      return 1
    fi

    echo "Irodori-TTS Serverを起動しています: ${IRODORI_TTS_URL}"
    echo "音声モデル: ${IRODORI_HF_CHECKPOINT} / デフォルト音声: ${IRODORI_DEFAULT_VOICE}"
    echo "初回はモデル取得と読込に数分かかります（最大 ${IRODORI_STARTUP_TIMEOUT} 秒待機）。"
    setsid bash -c 'cd "$1" && exec uv run --no-sync python -m irodori_openai_tts --host "$2" --port "$3"' \
      _ "${IRODORI_SERVER_DIR}" "${IRODORI_HOST}" "${IRODORI_PORT}" &
    IRODORI_PID=$!
    write_pid_file "${IRODORI_PID_FILE}" "${IRODORI_PID}"

    started_at=${SECONDS}
    while (( SECONDS - started_at < IRODORI_STARTUP_TIMEOUT )); do
      if curl --silent --fail --max-time 2 "${IRODORI_TTS_URL}/health" >/dev/null 2>&1; then
        echo "Irodori-TTS Serverに接続しました。"
        break
      fi
      if ! kill -0 "${IRODORI_PID}" 2>/dev/null; then
        wait "${IRODORI_PID}" || true
        echo "Irodori-TTS Serverの起動に失敗しました。" >&2
        return 1
      fi
      sleep 1
    done
    if ! curl --silent --fail --max-time 2 "${IRODORI_TTS_URL}/health" >/dev/null 2>&1; then
      echo "Irodori-TTS Serverが ${IRODORI_STARTUP_TIMEOUT} 秒以内に応答しませんでした。" >&2
      return 1
    fi
  fi

  echo "朗読娘を起動します: http://localhost:${PORT:-4173}"
  cd "${ROOT_DIR}"
  setsid env IRODORI_TTS_URL="${IRODORI_TTS_URL}" npm start &
  APP_PID=$!
  write_pid_file "${APP_PID_FILE}" "${APP_PID}"
  wait "${APP_PID}" || true
}

case "${ACTION}" in
  start) start_all ;;
  stop) stop_all ;;
  restart)
    stop_all
    # 旧スクリプトのEXITトラップによるIrodori終了を待ってから再判定する。
    sleep 1
    start_all
    ;;
  status) status_all ;;
  -h|--help|help) usage ;;
  *)
    usage >&2
    exit 2
    ;;
esac
