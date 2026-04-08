# ComfyUI Workflow UI

A clean React frontend for simplified ComfyUI workflows, designed to run alongside ComfyUI on a RunPod instance. Drop an image, hit a button — no graph editor needed.

## Architecture

```
[ React Frontend ]  ──HTTP/WS──►  [ FastAPI :8000 ]  ──HTTP/WS──►  [ ComfyUI :8188 ]
      (served as static build from FastAPI)                  (localhost only)
```

Only **port 8000** needs to be exposed in your RunPod template. The Gallery module can optionally expose port 3002.

## Features

### Workflow Modules

- **Upscaler**: Simple image upscaling using Real-ESRGAN
- **Upscaler Rework**: Advanced batch upscaling with multiple models (4xUltrasharp, 4xLexicaDAT2, etc.)
- **Outfit Swapping**: Swap outfits using reference images (up to 7 references)
- **Panorama Outpainting**: Create 360° panoramas with interactive stickers
- **Image Edit**: Edit images with text prompts (batch support available)
- **Gallery**: Browse, organize, and manage generated images
- **Admin Panel**: User and project management

### Key Features

- **Batch Processing**: Run multiple variations of upscale and image edit workflows
- **Real-time Progress**: WebSocket-based progress tracking
- **Image Management**: Rename, move, and organize images in the gallery
- **Machine Monitoring**: Track GPU/CPU usage and queue status
- **User Authentication**: Token-based authentication for multi-user environments

## Structure

```
├── backend/
│   ├── main.py               # FastAPI app with all API endpoints
│   ├── comfy_client.py       # ComfyUI HTTP + WebSocket client
│   ├── workflows/
│   │   ├── loader.py         # Workflow loaders and patchers
│   │   ├── upscale.json      # Original upscale workflow
│   │   ├── Upscaler_Batch_V2_API.json  # Batch upscale workflow
│   │   ├── Outfit_Swapping.json       # Outfit swapping workflow
│   │   ├── Panorama_Workflow_V5_API.json # Panorama workflow
│   │   ├── image_edit_V1_API.json     # Image edit workflow
│   │   └── __init__.py
│   ├── gallery.py            # Gallery image management
│   ├── user_management.py    # User authentication and DB
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── modules/           # Modular workflow components
│   │   │   ├── upscaler/      # Simple upscaler UI
│   │   │   ├── upscaler-rework/ # Batch upscaler UI
│   │   │   ├── outfit-swapping/ # Outfit swapping UI
│   │   │   ├── panorama/      # Panorama editor
│   │   │   ├── image-edit/    # Image edit UI
│   │   │   ├── gallery/       # Gallery browser
│   │   │   └── admin/         # Admin panel
│   │   ├── App.tsx           # Main application layout
│   │   ├── components/       # Shared UI components
│   │   └── api/client.ts      # API client utilities
│   ├── package.json
│   └── vite.config.ts
├── Dockerfile
└── start.sh
```

## Workflows

### Upscale (Simple)

Basic image upscaling using Real-ESRGAN.

**Patch points in `upscale.json`:**
- Node `"2"` → `inputs.image` — input filename

### Upscale Rework (Batch)

Advanced batch upscaling with multiple models and configurations.

**Patch points in `Upscaler_Batch_V2_API.json`:**
- Node `"18"` → `inputs.image` — input image filename
- Node `"167"` → `inputs.model_name` — upscale model name
- Node `"173"` → `inputs.value` — client path
- Node `"15"` → `inputs.value` — product path
- Node `"16"` → `inputs.value` — filename prefix

Available models:
- `4xUltrasharp_4xUltrasharpV10.pt`
- `4xLexicaDAT2_otf.pth`
- `4xRealWebPhoto_v4.pth`
- `4xPurePhoto-RealPLSKR.pth`
- `4xRealWebPhoto_v3_atd.pth`
- `4xNomos8kSCHAT-L.pth`

### Outfit Swapping

Swap outfits using reference images.

**Patch points in `Outfit_Swapping.json`:**
- Node `"1"` → `inputs.image` — main subject image
- Nodes `"11"`, `"2"`, `"3"`, `"4"`, `"5"`, `"6"`, `"7"` → `inputs.image` — reference images
- Node `"23"` → `inputs.text` — positive prompt
- Nodes `"13"`, `"14"`, `"15"`, `"16"` → `inputs.value` — output path components

### Panorama Outpainting

Create 360° panoramas with interactive sticker placement.

**Patch points in `Panorama_Workflow_V5_API.json`:**
- Node `"56"` → `state_json` — panorama stickers state
- Node `"6"` → `text` — positive prompt
- Nodes `"160"`, `"162"`, `"163"` → `inputs.value` — output path components

### Image Edit

Edit images using text prompts with optional batch processing.

**Patch points in `image_edit_V1_API.json`:**
- Node `"11"` → `inputs.image` — input image
- Node `"36"` → `inputs.value` — prompt instruction
- Nodes `"45"`, `"55"`, `"56"` → `inputs.value` — output path components

## RunPod / Docker

### Build & run

```bash
docker build -t comfyui-workflow-ui .
docker run -p 8000:8000 -p 3002:3002 comfyui-workflow-ui
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
| `COMFYUI_OUTPUT_DIR` | Auto-detected | ComfyUI output directory |

## API Endpoints

### Workflow Execution

- `POST /api/workflow/upscale` — Simple upscale
- `POST /api/workflow/upscale_rework` — Batch upscale
- `POST /api/workflow/outfit_swapping` — Outfit swapping
- `POST /api/workflow/panorama` — Panorama outpainting
- `POST /api/workflow/image_edit` — Single image edit
- `POST /api/workflow/image_edit/batch` — Batch image edit

### Batch Management

- `GET /api/batch/{batch_id}` — Get batch status
- `POST /api/batch/{batch_id}/cancel` — Cancel pending jobs
- `GET /api/batch/{batch_id}/download` — Download all images as ZIP

### Utility Endpoints

- `POST /api/upload` — Upload image to ComfyUI
- `GET /api/status/{prompt_id}` — Check job status
- `GET /api/image` — Proxy image from ComfyUI
- `GET /api/monitor/stats` — System and GPU statistics
- `GET /api/workflow/upscale_rework/models` — List available upscale models

### WebSocket

- `WS /ws/{client_id}` — Real-time progress updates

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

The Vite development server includes proxy configuration for API and WebSocket endpoints.

## Adding a New Workflow

1. **Export workflow from ComfyUI** in API format (Settings → Enable Dev Mode → Save [API Format])
2. **Add JSON file** to `backend/workflows/`
3. **Create loader function** in `backend/workflows/loader.py` with proper patch points
4. **Add API endpoint** in `backend/main.py`
5. **Create React module** in `frontend/src/modules/<name>/` with:
   - `index.ts` — Module descriptor
   - `<Name>.tsx` — UI component
6. **Register module** in `frontend/src/modules/index.ts`

The module will automatically appear in the workflow grid and sidebar.

## Gallery Features

- **Browse images** by client/project paths
- **Rename images** with inline editing
- **Move images** between folders with drag-and-drop
- **Copy actions** for quick path manipulation
- **Context menus** for bulk operations

## Admin Panel

- **User management**: Create, edit, and delete users
- **Authentication**: Token-based access control
- **Project configuration**: Manage client and product paths

## Tech Stack

### Backend
- FastAPI — Web framework and API server
- HTTPX — Async HTTP client for ComfyUI communication
- WebSockets — Real-time progress updates
- SQLite — User and gallery database

### Frontend
- React 18 — UI framework
- TypeScript — Type-safe development
- Vite — Fast development server and bundler
- TailwindCSS — Utility-first styling
- shadcn/ui — Accessible UI components
- lucide-react — Icon library

## Deployment Notes

- Only port 8000 needs to be exposed for basic functionality
- Port 3002 can be exposed for the Gallery module
- ComfyUI runs internally on port 8188 (not exposed)
- The React build is served as static files from FastAPI
