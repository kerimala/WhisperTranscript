#!/usr/bin/env python3
"""Print and validate the locally selected Whisper runtime without loading a model."""

import json
import sys

from engines.runtime import get_runtime_status


def main() -> int:
    status = get_runtime_status()
    print(json.dumps(status, indent=2))
    if not status["available"]:
        print("No local engine is ready.", file=sys.stderr)
        return 1
    if "--health" in sys.argv:
        from fastapi.testclient import TestClient
        from server import app

        response = TestClient(app).get("/health")
        response.raise_for_status()
        health = response.json()
        if health.get("selectedEngine") != status["selectedEngine"]:
            print("Health endpoint and runtime selection disagree.", file=sys.stderr)
            return 1
        print(f"Health endpoint: {response.status_code} ({health['selectedEngine']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
