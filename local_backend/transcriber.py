import mlx_whisper

# Use mlx_whisper directly — the maintained Apple MLX library.
# mlx-community/whisper-large-v3-turbo is the best balance for M4 MacBook Air 24 GB:
#   • Turbo from large-v3: incredibly fast with full multilingual (English, German, etc.) support
#   • natively supports code-switching, which distil-whisper lacked.
#   • float16 weights: low Metal RAM (24 GB unified = plenty of headroom)
#   • Auto-downloaded from HuggingFace on first run, cached afterwards
MODEL_REPO = "mlx-community/whisper-large-v3-turbo"


def transcribe(audio_path: str, language: str | None = None) -> dict:
    """Transcribe audio using mlx_whisper (Metal-accelerated).

    Args:
        audio_path: Path to the audio file.
        language: ISO-639-1 language code (e.g. "de", "en"). If None,
                  Whisper auto-detects from the first 30 seconds.

    Returns dict with keys: text, segments (list with start/end/text), language.
    """
    kwargs: dict = {
        "path_or_hf_repo": MODEL_REPO,
        "verbose": False,
    }
    if language:
        kwargs["language"] = language

    result = mlx_whisper.transcribe(audio_path, **kwargs)
    return result  # contains result["segments"] with start/end/text


def unload_model():
    """Release the cached Whisper model from memory.

    Called between transcription and diarization so both models
    don't compete for the same Metal RAM pool.
    """
    try:
        from mlx_whisper.transcribe import ModelHolder
        ModelHolder.model = None
    except Exception:
        pass

    try:
        import mlx.core as mx
        mx.clear_cache()
    except Exception:
        pass

    try:
        import gc
        gc.collect()
    except Exception:
        pass
