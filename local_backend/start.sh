#!/bin/bash
set -e
cd "$(dirname "$0")"
uvicorn server:app --host 127.0.0.1 --port 8001 --reload
