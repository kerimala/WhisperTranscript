from __future__ import annotations

import importlib.util
import os
from dataclasses import dataclass
from functools import lru_cache

from .base import EngineMetadata, EngineUnavailableError, TranscriptionEngine
from .faster_whisper_engine import FasterWhisperEngine
from .hardware import HardwareInfo, detect_hardware
from .mlx_engine import MlxWhisperEngine
from .whisper_cpp_engine import WhisperCppEngine, resolve_binary, resolve_model_path


VALID_ENGINE_IDS = {"auto", "mlx", "cuda", "vulkan", "rocm", "cpu"}


@dataclass(frozen=True)
class Candidate:
    id: str
    available: bool
    reason: str | None

    def to_dict(self) -> dict:
        return {"id": self.id, "available": self.available, "reason": self.reason}


def _module_available(name: str) -> bool:
    try:
        return importlib.util.find_spec(name) is not None
    except (ImportError, ModuleNotFoundError, ValueError):
        return False


def recommended_profile(hardware: HardwareInfo) -> str:
    if hardware.system == "darwin" and hardware.machine in {"arm64", "aarch64"}:
        return "mac-mlx"
    if hardware.gpu and hardware.gpu.vendor == "nvidia":
        return "windows-nvidia" if hardware.system == "windows" else "nvidia-cuda"
    if hardware.gpu and hardware.gpu.vendor in {"amd", "intel"}:
        return "universal-vulkan"
    return "universal-cpu"


def candidate_order(hardware: HardwareInfo, requested: str) -> list[str]:
    if requested != "auto":
        return [requested]
    if hardware.system == "darwin" and hardware.machine in {"arm64", "aarch64"}:
        return ["mlx", "cpu"]
    vendor = hardware.gpu.vendor if hardware.gpu else None
    if vendor == "nvidia":
        return ["cuda", "vulkan", "cpu"]
    if vendor == "amd":
        # Vulkan is the safe cross-device default. A HIP/ROCm build cannot be
        # distinguished reliably from a Vulkan build by inspecting the CLI, so
        # ROCm remains an explicit WHISPER_ENGINE=rocm choice.
        return ["vulkan", "cpu"]
    if vendor == "intel":
        return ["vulkan", "cpu"]
    return ["cpu"]


def probe_candidate(engine_id: str, hardware: HardwareInfo) -> Candidate:
    vendor = hardware.gpu.vendor if hardware.gpu else None
    if engine_id == "mlx":
        if hardware.system != "darwin" or hardware.machine not in {"arm64", "aarch64"}:
            return Candidate(engine_id, False, "MLX requires Apple Silicon")
        available = _module_available("mlx_whisper")
        return Candidate(engine_id, available, None if available else "mlx-whisper is not installed")
    if engine_id == "cuda":
        if vendor != "nvidia":
            return Candidate(engine_id, False, "No NVIDIA GPU detected")
        available = _module_available("faster_whisper")
        if not available:
            return Candidate(engine_id, False, "faster-whisper is not installed")
        try:
            import ctranslate2

            if ctranslate2.get_cuda_device_count() < 1:
                return Candidate(engine_id, False, "CTranslate2 cannot access a CUDA device")
        except (ImportError, RuntimeError, OSError) as exc:
            return Candidate(engine_id, False, f"CUDA runtime is not ready: {exc}")
        return Candidate(engine_id, True, None)
    if engine_id in {"vulkan", "rocm"}:
        if engine_id == "rocm" and vendor != "amd":
            return Candidate(engine_id, False, "No AMD GPU detected")
        try:
            resolve_binary()
            resolve_model_path()
        except RuntimeError as exc:
            return Candidate(engine_id, False, str(exc))
        return Candidate(engine_id, True, None)
    if engine_id == "cpu":
        available = _module_available("faster_whisper")
        return Candidate(engine_id, available, None if available else "faster-whisper is not installed")
    return Candidate(engine_id, False, "Unknown engine")


def _create_engine(engine_id: str, hardware: HardwareInfo) -> TranscriptionEngine:
    gpu_name = hardware.gpu.name if hardware.gpu else "CPU"
    if engine_id == "mlx":
        return MlxWhisperEngine()
    if engine_id == "cuda":
        return FasterWhisperEngine(device="cuda", device_name=gpu_name)
    if engine_id == "cpu":
        return FasterWhisperEngine(device="cpu", device_name="CPU")
    if engine_id in {"vulkan", "rocm"}:
        return WhisperCppEngine(accelerator=engine_id, device_name=gpu_name)
    raise EngineUnavailableError(f"Unknown engine: {engine_id}")


def _requested_engine() -> tuple[str, str | None]:
    raw = os.environ.get("WHISPER_ENGINE", "auto").strip().lower() or "auto"
    aliases = {
        "metal": "mlx",
        "nvidia": "cuda",
        "amd": "rocm",
        "whisper.cpp": "vulkan",
        "faster-whisper": "cpu",
    }
    requested = aliases.get(raw, raw)
    if requested not in VALID_ENGINE_IDS:
        return "auto", f"Unknown WHISPER_ENGINE={raw!r}; using auto detection"
    return requested, None


@lru_cache(maxsize=1)
def get_runtime_status() -> dict:
    hardware = detect_hardware()
    requested, warning = _requested_engine()
    order = candidate_order(hardware, requested)
    candidates = [probe_candidate(engine_id, hardware) for engine_id in order]
    selected = next((candidate for candidate in candidates if candidate.available), None)
    metadata: EngineMetadata | None = None
    if selected:
        metadata = _create_engine(selected.id, hardware).metadata

    return {
        "status": "ok" if selected else "unavailable",
        "available": selected is not None,
        "requestedEngine": requested,
        "selectedEngine": selected.id if selected else None,
        "recommendedProfile": recommended_profile(hardware),
        "warning": warning,
        "hardware": hardware.to_dict(),
        "engine": metadata.to_dict() if metadata else None,
        "candidates": [candidate.to_dict() for candidate in candidates],
    }


@lru_cache(maxsize=1)
def get_engine() -> TranscriptionEngine:
    status = get_runtime_status()
    selected = status["selectedEngine"]
    if not selected:
        reasons = "; ".join(
            f"{item['id']}: {item['reason']}" for item in status["candidates"] if item["reason"]
        )
        raise EngineUnavailableError(
            "No local Whisper engine is available. "
            f"Recommended profile: {status['recommendedProfile']}. {reasons}"
        )
    hardware = detect_hardware()
    return _create_engine(selected, hardware)


def clear_runtime_cache() -> None:
    get_engine.cache_clear()
    get_runtime_status.cache_clear()
