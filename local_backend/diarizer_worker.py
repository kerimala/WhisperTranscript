"""CLI entry point executed only by the isolated Pyannote environment."""

from __future__ import annotations

import argparse
import json
import os

from diarizer import diarize, unload_diarizer


def emit(payload: dict) -> None:
    """Write one machine-readable event without exposing credentials."""
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("audio_path")
    parser.add_argument("--min-speakers", type=int)
    parser.add_argument("--max-speakers", type=int)
    args = parser.parse_args()

    token = os.environ.get("HF_TOKEN", "").strip()
    if not token:
        raise RuntimeError("HF_TOKEN is not configured for the Pyannote worker")

    try:
        turns = diarize(
            args.audio_path,
            hf_token=token,
            min_speakers=args.min_speakers,
            max_speakers=args.max_speakers,
            progress_callback=lambda event: emit({"kind": "progress", **event}),
        )
        emit({"kind": "result", "turns": turns})
    finally:
        unload_diarizer()


if __name__ == "__main__":
    main()
