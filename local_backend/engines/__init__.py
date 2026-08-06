"""Runtime-selectable local Whisper engines."""

from .base import EngineMetadata, EngineUnavailableError, TranscriptionEngine
from .runtime import get_engine, get_runtime_status

__all__ = [
    "EngineMetadata",
    "EngineUnavailableError",
    "TranscriptionEngine",
    "get_engine",
    "get_runtime_status",
]
