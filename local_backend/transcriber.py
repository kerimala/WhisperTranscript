"""Backward-compatible wrapper around the auto-selected local engine."""

from engines.runtime import get_engine


def transcribe(audio_path: str, language: str | None = None) -> dict:
    return get_engine().transcribe(audio_path, language=language)


def unload_model():
    get_engine().unload()
