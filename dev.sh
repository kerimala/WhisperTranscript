#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# WhisperForFiles – start everything
#
# Starts the Python backend (port 8001) AND the Next.js frontend (port 3000)
# in a single terminal with colour-coded output.
#
# Usage (from anywhere):  whisper          ← after the alias is installed
#          or directly:   bash dev.sh
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$PROJECT_DIR/local_backend"
VENV="$BACKEND_DIR/.venv"
DIARIZATION_VENV="$BACKEND_DIR/.venv-diarization"

# ── colours ──────────────────────────────────────────────────────────────────
CYAN=$'\033[1;36m'; GREEN=$'\033[1;32m'; YELLOW=$'\033[1;33m'
RED=$'\033[0;31m'; DIM=$'\033[2m'; RESET=$'\033[0m'

die()  { printf '%s✗  %s%s\n' "$RED" "$*" "$RESET" >&2; trap - INT TERM; kill 0 2>/dev/null; exit 1; }
ok()   { printf '%s✓  %s%s\n' "$GREEN" "$*" "$RESET"; }
info() { printf '%s▶  %s%s\n' "$YELLOW" "$*" "$RESET"; }

echo ""
echo "══════════════════════════════════════════════════════"
echo "  WhisperForFiles  –  dev startup"
echo "══════════════════════════════════════════════════════"
echo ""

# ── 1. Kill the whole process group when the user hits Ctrl+C ────────────────
cleanup() {
    trap - INT TERM
    printf '\n%s  Shutting everything down …%s\n' "$YELLOW" "$RESET"
    # kill 0 = send SIGTERM to every process in this process group
    kill 0 2>/dev/null
    wait 2>/dev/null
    exit 0
}
trap cleanup INT TERM

# ── 2. Check Node / npm ───────────────────────────────────────────────────────
command -v npm &>/dev/null \
    || die "npm not found. Install Node.js: https://nodejs.org"

if [[ ! -d "$PROJECT_DIR/node_modules" ]]; then
    info "node_modules missing – running npm install …"
    (cd "$PROJECT_DIR" && npm install --silent) \
        || die "npm install failed"
    ok "npm dependencies installed"
fi

# ── 3. Select the local inference profile ────────────────────────────────────
PROFILE="${WHISPER_PROFILE:-auto}"
if [[ "$PROFILE" == "auto" ]]; then
    if command -v python3 &>/dev/null; then
        PROFILE=$(python3 "$BACKEND_DIR/detect_profile.py" 2>/dev/null || printf 'universal-cpu')
    else
        PROFILE="universal-cpu"
    fi
fi

case "$PROFILE" in
    mac-mlx|nvidia-cuda|windows-nvidia|universal-cpu|universal-vulkan) ;;
    *) die "Unknown WHISPER_PROFILE=$PROFILE" ;;
esac

REQUIREMENTS_FILE="$BACKEND_DIR/requirements/$PROFILE.txt"
PROFILE_MARKER="$VENV/.installed-profile"
info "Local runtime profile: $PROFILE"

# ── 4. Set up Python backend ──────────────────────────────────────────────────
# Re-install if requirements.txt changed since the venv was last built.
NEEDS_INSTALL=false
if [[ ! -f "$VENV/bin/uvicorn" ]]; then
    NEEDS_INSTALL=true
elif [[ "$REQUIREMENTS_FILE" -nt "$VENV/bin/uvicorn" ]] \
    || [[ "$BACKEND_DIR/requirements/base.txt" -nt "$VENV/bin/uvicorn" ]] \
    || [[ ! -f "$PROFILE_MARKER" ]] \
    || [[ "$(<"$PROFILE_MARKER")" != "$PROFILE" ]]; then
    info "Runtime profile or requirements changed – reinstalling packages …"
    NEEDS_INSTALL=true
fi

if $NEEDS_INSTALL; then
    if [[ ! -f "$VENV/bin/python" ]]; then
        info "First run – setting up Python backend …"

        # Find Python 3.10+
        PYTHON=""
        for cand in python3.13 python3.12 python3.11 python3.10 python3; do
            if command -v "$cand" &>/dev/null; then
                ver=$("$cand" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
                maj=${ver%%.*}; min=${ver#*.}
                if [[ $maj -ge 3 && $min -ge 10 ]]; then PYTHON="$cand"; break; fi
            fi
        done
        [[ -z "$PYTHON" ]] && die "Python 3.10+ not found.  Install with: brew install python@3.11"

        info "Creating venv with $PYTHON …"
        "$PYTHON" -m venv "$VENV" || die "venv creation failed"
    fi

    info "Installing Python requirements for $PROFILE …"
    if [[ "$PROFILE" == "nvidia-cuda" ]]; then
        printf '%s⚠   CUDA runtime packages are large; this first install can download over 1 GB.%s\n' "$YELLOW" "$RESET"
    fi
    "$VENV/bin/pip" install --quiet --upgrade pip
    "$VENV/bin/pip" install --quiet -r "$REQUIREMENTS_FILE" \
        || die "pip install failed – see output above"
    printf '%s' "$PROFILE" > "$PROFILE_MARKER"

    ok "Python backend is ready"
else
    ok "Python backend already set up"
fi

# CTranslate2 needs the pip-installed CUDA libraries on its loader path.
if [[ "$PROFILE" == "nvidia-cuda" ]]; then
    CUDA_LIBRARY_PATH=$("$VENV/bin/python" -c 'import nvidia.cublas.lib, nvidia.cudnn.lib; print(next(iter(nvidia.cublas.lib.__path__)) + ":" + next(iter(nvidia.cudnn.lib.__path__)))') \
        || die "Could not resolve the CUDA runtime libraries"
    export LD_LIBRARY_PATH="$CUDA_LIBRARY_PATH${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi

# ── 5. HuggingFace token – read from .env.local and export to child processes ──
if [[ -z "${HF_TOKEN:-}" ]] && [[ -f "$PROJECT_DIR/.env.local" ]]; then
    _hf_line=$(grep "^HF_TOKEN=" "$PROJECT_DIR/.env.local" 2>/dev/null | head -1)
    _hf_val="${_hf_line#HF_TOKEN=}"   # strip the key= prefix
    [[ -n "$_hf_val" ]] && export HF_TOKEN="$_hf_val"
fi

if [[ -n "${HF_TOKEN:-}" ]] && "$DIARIZATION_VENV/bin/python" -c 'import pyannote.audio' 2>/dev/null; then
    ok "HF_TOKEN and Pyannote found  (speaker diarization available)"
elif [[ -n "${HF_TOKEN:-}" ]]; then
    printf '%s⚠   HF_TOKEN found, but optional Pyannote dependencies are not installed.%s\n' "$YELLOW" "$RESET"
    printf '    Install in an isolated venv to avoid CUDA conflicts:\n'
    printf '      python3 -m venv %s\n' "$DIARIZATION_VENV"
    printf '      %s/bin/pip install -r %s/requirements/diarization.txt\n' "$DIARIZATION_VENV" "$BACKEND_DIR"
else
    printf '%s⚠   HF_TOKEN not set – diarization disabled.%s\n' "$YELLOW" "$RESET"
    printf '    Add  HF_TOKEN=hf_…  to  .env.local  to enable it.\n'
fi

echo ""
printf '%s  Backend  →  http://127.0.0.1:8001%s\n' "$DIM" "$RESET"
printf '%s  Frontend →  http://localhost:3000%s\n'  "$DIM" "$RESET"
echo ""

# ── 6. Start backend ──────────────────────────────────────────────────────────
(
    cd "$BACKEND_DIR"
    "$VENV/bin/uvicorn" server:app --host 127.0.0.1 --port 8001 2>&1 \
        | while IFS= read -r line; do
            printf '%s[BE]%s %s\n' "$CYAN" "$RESET" "$line"
          done
) &

# Give uvicorn a moment so its startup banner appears before Next.js floods output
sleep 1

# ── 7. Start frontend ─────────────────────────────────────────────────────────
(
    cd "$PROJECT_DIR"
    npm run dev 2>&1 \
        | while IFS= read -r line; do
            printf '%s[FE]%s %s\n' "$GREEN" "$RESET" "$line"
          done
) &

printf '%s  Both services running.  Press Ctrl+C to stop both.%s\n\n' "$GREEN" "$RESET"

# Keep the script alive; cleanup trap fires on Ctrl+C
wait
