import unittest

from engines.hardware import GpuInfo, HardwareInfo
from engines.runtime import candidate_order, recommended_profile


class RuntimeSelectionTests(unittest.TestCase):
    def test_apple_silicon_prefers_mlx(self):
        hardware = HardwareInfo("darwin", "arm64", False, GpuInfo("apple", "Apple Silicon"))
        self.assertEqual(candidate_order(hardware, "auto"), ["mlx", "cpu"])
        self.assertEqual(recommended_profile(hardware), "mac-mlx")

    def test_nvidia_wsl_prefers_cuda(self):
        hardware = HardwareInfo("linux", "x86_64", True, GpuInfo("nvidia", "RTX 3060 Ti"))
        self.assertEqual(candidate_order(hardware, "auto"), ["cuda", "vulkan", "cpu"])
        self.assertEqual(recommended_profile(hardware), "nvidia-cuda")

    def test_native_windows_nvidia_gets_native_profile(self):
        hardware = HardwareInfo("windows", "amd64", False, GpuInfo("nvidia", "RTX 4080"))
        self.assertEqual(recommended_profile(hardware), "windows-nvidia")

    def test_amd_auto_mode_prefers_vulkan_then_cpu(self):
        hardware = HardwareInfo("linux", "x86_64", True, GpuInfo("amd", "Radeon RX 7900 XTX"))
        self.assertEqual(candidate_order(hardware, "auto"), ["vulkan", "cpu"])
        self.assertEqual(recommended_profile(hardware), "universal-vulkan")

    def test_rocm_can_be_requested_explicitly(self):
        hardware = HardwareInfo("linux", "x86_64", True, GpuInfo("amd", "Radeon RX 7900 XTX"))
        self.assertEqual(candidate_order(hardware, "rocm"), ["rocm"])

    def test_explicit_engine_disables_auto_fallback(self):
        hardware = HardwareInfo("linux", "x86_64", True, None)
        self.assertEqual(candidate_order(hardware, "cpu"), ["cpu"])


if __name__ == "__main__":
    unittest.main()
