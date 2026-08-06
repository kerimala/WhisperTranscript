#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# WhisperForFiles – Local Metal backend: setup & start
#
# Usage:  bash local_backend/setup_and_start.sh
#         (run from the project root OR from inside local_backend/)
#
# What it does:
#   1. Finds Python 3.10+
#   2. Creates a venv at  local_backend/.venv  if it doesn't exist
#   3. Installs / updates Python requirements (skips if already satisfied)
#   4. Starts the FastAPI server on http://127.0.0.1:8001
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# Always work relative to the local_backend/ directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

VENV_DIR=".venv"
REQUIREMENTS="requirements.txt"
HOST="127.0.0.1"
PORT=8001

# ── colour helpers ────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; RESET='\033[0m'
ok()   { echo -e "${GREEN}✓${RESET}  $*"; }
info() { echo -e "${YELLOW}→${RESET}  $*"; }
fail() { echo -e "${RED}✗${RESET}  $*" >&2; exit 1; }

echo ""
echo "══════════════════════════════════════════════════════"
echo "  WhisperForFiles – Local Metal backend"
echo "══════════════════════════════════════════════════════"
echo ""

# ── 1. Find Python 3.10+ ─────────────────────────────────────────────────────
PYTHON=""
for candidate in python3.13 python3.12 python3.11 python3.10 python3; do
    if command -v "$candidate" &>/dev/null; then
        version=$("$candidate" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
        major=${version%%.*}
        minor=${version#*.}
        if [[ "$major" -ge 3 && "$minor" -ge 10 ]]; then
            PYTHON="$candidate"
            ok "Python $version  ($( command -v "$candidate" ))"
            break
        fi
    fi
done

if [[ -z "$PYTHON" ]]; then
    fail "Python 3.10 or newer is required.\n   Install with:  brew install python@3.11"
fi

# ── 2. ffmpeg (needed for audio loading) ─────────────────────────────────────
if command -v ffmpeg &>/dev/null; then
    ok "ffmpeg  ($(ffmpeg -version 2>&1 | head -1 | awk '{print $3}'))"
else
    echo ""
    echo -e "${YELLOW}⚠${RESET}  ffmpeg not found."
    echo "   Install with:  brew install ffmpeg"
    echo "   (transcription will fail without it)"
    echo ""
fi

# ── 3. Create / reuse venv ────────────────────────────────────────────────────
if [[ ! -d "$VENV_DIR" ]]; then
    info "Creating virtual environment at $SCRIPT_DIR/$VENV_DIR …"
    "$PYTHON" -m venv "$VENV_DIR"
    ok "Virtual environment created"
else
    ok "Virtual environment already exists"
fi

PY="$VENV_DIR/bin/python"
PIP="$VENV_DIR/bin/pip"

# ── 4. Install / update requirements ─────────────────────────────────────────
info "Checking Python requirements …"

# Use pip install with --upgrade only for the first install
# Subsequent runs use --quiet so output is clean on repeat runs
"$PIP" install --quiet --upgrade pip

if "$PIP" install --quiet -r "$REQUIREMENTS"; then
    ok "All requirements satisfied"
else
    fail "pip install failed.  Check the output above for details."
fi

# ── 5. Quick sanity-check imports ─────────────────────────────────────────────
info "Verifying key imports …"
IMPORT_ERRORS=0

for pkg in fastapi uvicorn mlx_whisper; do
    if "$PY" -c "import $pkg" 2>/dev/null; then
        ok "  import $pkg"
    else
        echo -e "${RED}✗${RESET}  import $pkg  (not installed or import error)"
        IMPORT_ERRORS=$(( IMPORT_ERRORS + 1 ))
    fi
done

# pyannote is optional (only needed for diarization)
if "$PY" -c "import pyannote.audio" 2>/dev/null; then
    ok "  import pyannote.audio (diarization available)"
else
    echo -e "${YELLOW}⚠${RESET}  import pyannote.audio failed – diarization will be skipped"
    echo "   If you need diarization, run:  $PIP install 'pyannote.audio>=3.1'"
fi

if [[ "$IMPORT_ERRORS" -gt 0 ]]; then
    fail "$IMPORT_ERRORS required package(s) failed to import.  See above."
fi

# ── 6. Check for HuggingFace token ───────────────────────────────────────────
if [[ -n "${HF_TOKEN:-}" ]]; then
    ok "HF_TOKEN is set in the environment (diarization will work)"
elif [[ -f "$SCRIPT_DIR/../.env.local" ]] && grep -q "^HF_TOKEN=" "$SCRIPT_DIR/../.env.local" 2>/dev/null; then
    ok "HF_TOKEN found in .env.local (diarization will work)"
else
    echo -e "${YELLOW}⚠${RESET}  HF_TOKEN not found – diarization will be skipped unless"
    echo "   you enter the token in the UI or add it to .env.local"
fi

# ── 7. Start server ───────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}Starting server on http://${HOST}:${PORT}${RESET}"
echo "Press Ctrl+C to stop."
echo ""

exec "$VENV_DIR/bin/uvicorn" server:app \
    --host "$HOST" \
    --port "$PORT" \
    --reload
