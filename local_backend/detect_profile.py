#!/usr/bin/env python3
"""Print the recommended dependency/runtime profile for this machine."""

from engines.hardware import detect_hardware
from engines.runtime import recommended_profile


if __name__ == "__main__":
    print(recommended_profile(detect_hardware()))
