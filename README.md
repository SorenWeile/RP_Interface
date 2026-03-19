# ComfyUI Workflow UI

A clean React frontend for simplified ComfyUI workflows, designed to run alongside ComfyUI on a RunPod instance. Drop an image, hit a button — no graph editor needed.

## Architecture

```
[ React Frontend ]  ──HTTP/WS──►  [ FastAPI :8000 ]  ──HTTP/WS──►  [ ComfyUI :8188 ]
      (served as static build from FastAPI)                  (localhost only)
```

Only **port 8000** needs to be exposed in your RunPod template.

## Structure

```
├── backend/
│   ├── main.py               # FastAPI app
│   ├── comfy_client.py       # ComfyUI HTTP + WebSocket client
│   ├── workflows/
│   │   ├── loader.py         # Workflow patchers (patch points documented here)
│   │   └── upscale.json      # Upscale workflow (API format)
│   └── requirements.txt
├── frontend/
│   └── src/
│       ├── App.tsx
│       ├── components/
│       │   └── Upscaler.tsx
│       └── api/client.ts
├── Dockerfile
└── start.sh
```

## Workflows

### Upscale

Upscales an image using a Real-ESRGAN model loaded in ComfyUI.

**Patch points in `upscale.json`:**
- Node `"10"` → `inputs.image` — input filename
- Node `"15"` → `inputs.scale_by` — scale factor (default `2.0`)

> **Important:** Replace `backend/workflows/upscale.json` with your own export from ComfyUI
> *(Dev Mode → Save \[API Format\])* and update the node IDs in `backend/workflows/loader.py` to match.

## RunPod / Docker

### Build & run

```bash
docker build -t comfyui-workflow-ui .
docker run -p 8000:8000 comfyui-workflow-ui
```

The `start.sh` entrypoint:
1. Starts ComfyUI on `127.0.0.1:8188`
2. Waits until ComfyUI is ready
3. Starts FastAPI on `0.0.0.0:8000`

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `COMFYUI_HOST` | `127.0.0.1:8188` | ComfyUI address |
| `API_PORT` | `8000` | FastAPI port |

## Local Development

```bash
# Backend
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# Frontend (separate terminal)
cd frontend
npm install
npm run dev   # Vite on :5173, proxies /api and /ws → :8000
```

## Adding a New Workflow

1. Export the workflow from ComfyUI in API format
2. Drop the JSON in `backend/workflows/`
3. Add a `load_<name>` function in `backend/workflows/loader.py`
4. Add a `POST /api/workflow/<name>` route in `backend/main.py`
5. Add a React component in `frontend/src/components/`
