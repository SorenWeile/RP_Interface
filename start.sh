#!/usr/bin/env bash
set -e

# Resolve ComfyUI output directory — RunPod mounts workspace at /workspace,
# so prefer that path if it exists; fall back to the Docker default.
if [ -z "$COMFYUI_OUTPUT_DIR" ]; then
  if [ -d "/workspace/ComfyUI/output" ]; then
    export COMFYUI_OUTPUT_DIR="/workspace/ComfyUI/output"
  else
    export COMFYUI_OUTPUT_DIR="/ComfyUI/output"
  fi
fi
echo "[start] COMFYUI_OUTPUT_DIR=${COMFYUI_OUTPUT_DIR}"

# 1. Start ComfyUI in background
echo "[start] Launching ComfyUI..."
python /ComfyUI/main.py --listen 127.0.0.1 --port 8188 &

# 2. Wait for ComfyUI to be ready
echo "[start] Waiting for ComfyUI on :8188..."
until curl -sf http://127.0.0.1:8188 > /dev/null 2>&1; do
  sleep 2
done
echo "[start] ComfyUI is ready."

# 3. Start FastAPI
PORT=${API_PORT:-8000}
echo "[start] Starting FastAPI on :${PORT}..."
cd /app/backend
exec uvicorn main:app --host 0.0.0.0 --port "${PORT}"
