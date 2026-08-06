import os
import unittest
from unittest.mock import patch

from engines.hardware import detect_hardware


class HardwareDetectionTests(unittest.TestCase):
    def test_nvidia_smi_is_preferred_and_parsed(self):
        def runner(command):
            if "--query-gpu=name,memory.total,compute_cap" in command:
                return "NVIDIA GeForce RTX 3060 Ti, 8192, 8.6"
            return None

        with (
            patch.dict(os.environ, {"WSL_DISTRO_NAME": "Ubuntu-24.04"}, clear=False),
            patch("engines.hardware.platform.system", return_value="Linux"),
            patch("engines.hardware.platform.machine", return_value="x86_64"),
            patch("engines.hardware.shutil.which", return_value="/usr/bin/nvidia-smi"),
        ):
            hardware = detect_hardware(runner)

        self.assertTrue(hardware.is_wsl)
        self.assertIsNotNone(hardware.gpu)
        self.assertEqual(hardware.gpu.vendor, "nvidia")
        self.assertEqual(hardware.gpu.name, "NVIDIA GeForce RTX 3060 Ti")
        self.assertEqual(hardware.gpu.memory_mb, 8192)
        self.assertEqual(hardware.gpu.compute_capability, "8.6")

    def test_environment_override_supports_repeatable_detection(self):
        with (
            patch.dict(
                os.environ,
                {"WHISPER_GPU_VENDOR": "amd", "WHISPER_GPU_NAME": "Radeon Test GPU"},
                clear=False,
            ),
            patch("engines.hardware.platform.system", return_value="Windows"),
            patch("engines.hardware.platform.machine", return_value="AMD64"),
        ):
            hardware = detect_hardware(lambda _command: None)

        self.assertEqual(hardware.gpu.vendor, "amd")
        self.assertEqual(hardware.gpu.name, "Radeon Test GPU")


if __name__ == "__main__":
    unittest.main()
