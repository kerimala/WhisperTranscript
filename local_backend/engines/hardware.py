from __future__ import annotations

import json
import os
import platform
import shutil
import subprocess
from dataclasses import asdict, dataclass
from typing import Callable


@dataclass(frozen=True)
class GpuInfo:
    vendor: str
    name: str
    memory_mb: int | None = None
    compute_capability: str | None = None


@dataclass(frozen=True)
class HardwareInfo:
    system: str
    machine: str
    is_wsl: bool
    gpu: GpuInfo | None

    def to_dict(self) -> dict:
        return asdict(self)


Runner = Callable[[list[str]], str | None]


def _run(command: list[str]) -> str | None:
    try:
        completed = subprocess.run(
            command,
            capture_output=True,
            check=False,
            text=True,
            timeout=5,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if completed.returncode != 0:
        return None
    value = completed.stdout.strip()
    return value or None


def _is_wsl() -> bool:
    if os.environ.get("WSL_DISTRO_NAME"):
        return True
    try:
        with open("/proc/version", "r", encoding="utf-8") as handle:
            return "microsoft" in handle.read().lower()
    except OSError:
        return False


def _parse_memory_mb(value: object) -> int | None:
    if value is None:
        return None
    text = str(value).strip().lower().replace("mib", "").replace("mb", "")
    try:
        raw = int(float(text))
    except ValueError:
        return None
    # Windows AdapterRAM is reported in bytes; nvidia-smi reports MiB.
    return round(raw / (1024 * 1024)) if raw > 1024 * 1024 else raw


def _detect_nvidia(runner: Runner) -> GpuInfo | None:
    candidates = ["nvidia-smi"]
    if os.path.exists("/usr/lib/wsl/lib/nvidia-smi"):
        candidates.insert(0, "/usr/lib/wsl/lib/nvidia-smi")

    for executable in candidates:
        if os.path.isabs(executable) or shutil.which(executable):
            output = runner([
                executable,
                "--query-gpu=name,memory.total,compute_cap",
                "--format=csv,noheader,nounits",
            ])
            if not output:
                continue
            fields = [part.strip() for part in output.splitlines()[0].split(",")]
            return GpuInfo(
                vendor="nvidia",
                name=fields[0],
                memory_mb=_parse_memory_mb(fields[1]) if len(fields) > 1 else None,
                compute_capability=fields[2] if len(fields) > 2 else None,
            )
    return None


def _vendor_from_name(name: str) -> str:
    lowered = name.lower()
    if "nvidia" in lowered:
        return "nvidia"
    if "amd" in lowered or "radeon" in lowered:
        return "amd"
    if "intel" in lowered or "arc" in lowered:
        return "intel"
    if "apple" in lowered:
        return "apple"
    return "unknown"


def _detect_windows_gpu(runner: Runner) -> GpuInfo | None:
    powershell = shutil.which("powershell.exe") or shutil.which("powershell")
    if not powershell:
        return None
    output = runner([
        powershell,
        "-NoProfile",
        "-Command",
        "Get-CimInstance Win32_VideoController | "
        "Where-Object {$_.PNPDeviceID -like 'PCI*'} | "
        "Select-Object Name,AdapterRAM | ConvertTo-Json -Compress",
    ])
    if not output:
        return None
    try:
        parsed = json.loads(output)
    except json.JSONDecodeError:
        return None
    devices = parsed if isinstance(parsed, list) else [parsed]
    preferred = sorted(
        devices,
        key=lambda item: _vendor_from_name(str(item.get("Name", ""))) == "unknown",
    )
    for item in preferred:
        name = str(item.get("Name", "")).strip()
        if name:
            return GpuInfo(
                vendor=_vendor_from_name(name),
                name=name,
                memory_mb=_parse_memory_mb(item.get("AdapterRAM")),
            )
    return None


def _detect_linux_gpu(runner: Runner) -> GpuInfo | None:
    if shutil.which("rocminfo"):
        output = runner(["rocminfo"])
        if output:
            for line in output.splitlines():
                if "Marketing Name:" in line:
                    name = line.split(":", 1)[1].strip()
                    if name:
                        return GpuInfo(vendor="amd", name=name)

    if shutil.which("lspci"):
        output = runner(["lspci"])
        if output:
            for line in output.splitlines():
                if any(marker in line.lower() for marker in ("vga", "3d controller", "display")):
                    vendor = _vendor_from_name(line)
                    if vendor != "unknown":
                        name = line.split(": ", 1)[-1].strip()
                        return GpuInfo(vendor=vendor, name=name)
    return None


def detect_hardware(runner: Runner = _run) -> HardwareInfo:
    system = platform.system().lower()
    machine = platform.machine().lower()
    is_wsl = _is_wsl()

    override_vendor = os.environ.get("WHISPER_GPU_VENDOR", "").strip().lower()
    override_name = os.environ.get("WHISPER_GPU_NAME", "").strip()
    if override_vendor:
        gpu = GpuInfo(vendor=override_vendor, name=override_name or f"{override_vendor} GPU")
        return HardwareInfo(system=system, machine=machine, is_wsl=is_wsl, gpu=gpu)

    gpu = _detect_nvidia(runner)
    if gpu is None and (system == "windows" or is_wsl):
        gpu = _detect_windows_gpu(runner)
    if gpu is None and system == "linux":
        gpu = _detect_linux_gpu(runner)
    if gpu is None and system == "darwin" and machine in {"arm64", "aarch64"}:
        gpu = GpuInfo(vendor="apple", name="Apple Silicon")

    return HardwareInfo(system=system, machine=machine, is_wsl=is_wsl, gpu=gpu)
