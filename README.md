# AI Toolhouse

A clean React frontend for simplified ComfyUI workflows, designed to run alongside ComfyUI on a RunPod instance. Drop an image, hit a button — no graph editor needed.

## Architecture

```
[ React Frontend ]  ──HTTP/WS──►  [ FastAPI :8000 ]  ──HTTP/WS──►  [ ComfyUI :8188 ]
      (served as static build from FastAPI)                  (localhost only)
```

Only **port 8000** needs to be exposed in your RunPod template.

---

## Workflow Modules

| Module | Description |
|---|---|
| **Magnific Upscaler** | Upscale images 2×–16× with AI-driven sharpening, smart grain, and ultra detail controls |
| **Batch Upscaler** | Advanced batch upscaling with multiple Real-ESRGAN models × N runs |
| **Outfit Swapping** | Swap outfits on a subject using up to 7 reference images |
| **Panorama Outpainting** | Create 360° panoramas with interactive sticker placement |
| **Image Edit** | Edit images with detailed text prompts (batch support, up to 4 reference images) |
| **Image Prompting** | Generate images from a prompt + up to 4 product reference images via Google Gemini |
| **Video Creation** | Generate video clips from a first and last frame using LTX, with adjustable length |
| **Gallery** | Browse, play, organize, and download all generated images and videos |
| **Admin Panel** | User, group, client, and project management |

---

## Key Features

- **Batch Processing** — Queue multiple runs of Image Edit, Image Prompting, and Video Creation workflows; track progress with run-dot indicators and download results as ZIP
- **Real-time Progress** — WebSocket-based progress tracking with percentage bar
- **Gallery with Video Playback** — Browse images and videos in one unified gallery; videos play inline with native controls
- **Output Path Control** — Client / Product / Filename dropdowns on every tool for organised output
- **Machine Monitoring** — Live GPU VRAM, RAM, and queue status
- **User Authentication** — Token-based login; group permissions control which modules each user can see
- **Admin Panel** — Manage users, groups, clients, and projects; assign allowed apps per group

---

## Project Structure

```
├── backend/
│   ├── main.py                    # FastAPI app — all API endpoints
│   ├── comfy_client.py            # ComfyUI HTTP + WebSocket client
│   ├── gallery.py                 # Gallery file browser, thumbnails, metadata
│   ├── user_management.py         # Auth, users, groups, clients, projects
│   ├── config.py                  # Shared constants (models, limits, paths)
│   └── workflows/
│       ├── base.py                # _load_workflow(), _random_seed()
│       ├── upscale_rework/        # Batch upscaler workflow
│       ├── magnific_upscaler/     # Magnific upscaler workflow
│       ├── outfit_swapping/       # Outfit swapping workflow
│       ├── panorama/              # Panorama outpainting workflow
│       ├── image_edit/            # Image edit workflow
│       ├── image_prompting/       # Image prompting workflow
│       └── video_creation/        # Video creation workflow (LTX)
├── frontend/
│   └── src/
│       ├── modules/
│       │   ├── magnific-upscaler/ # Magnific Upscaler UI
│       │   ├── upscaler-rework/   # Batch Upscaler UI
│       │   ├── outfit-swapping/   # Outfit Swapping UI
│       │   ├── panorama/          # Panorama Editor UI
│       │   ├── image-edit/        # Image Edit UI
│       │   ├── image-prompting/   # Image Prompting UI
│       │   ├── video-creation/    # Video Creation UI
│       │   ├── gallery/           # Gallery browser + video player
│       │   └── admin/             # Admin panel
│       ├── components/            # Shared UI (DropZone, ClientProjectPicker, …)
│       └── api/client.ts          # All API call functions
├── Dockerfile
└── start.sh
```

---

## Workflows

### Magnific Upscaler

Upscale an image using the Magnific Precise V2 model with full parameter control.

**Patch points in `Magnific_Upscaler_V1_API.json`:**

| Node | Field | Description |
|---|---|---|
| `"12"` | `inputs.image` | Input image (`11_INPUT_IMAGE`) |
| `"17"` | `inputs.value` | Sharpen (`02_INPUT_SHARPEN`) |
| `"18"` | `inputs.value` | Smart Grain (`03_INPUT_SMART_GRAIN`) |
| `"19"` | `inputs.value` | Ultra Detail (`04_INPUT_ULTRA_DETAIL`) |
| `"9"` | `inputs.scale_factor` | Scale factor — `"2x"` / `"4x"` / `"8x"` / `"16x"` |
| `"2"` `"4"` `"5"` | `inputs.value` | Output path (client / product / filename) |
| `"3"` | `inputs.value` | Username (`98_USER`) |

---

### Batch Upscaler

Run multiple Real-ESRGAN models × N runs in parallel, producing 4K/8K outputs.

**Endpoint:** `POST /api/workflow/upscale_rework`

Available models (configured in `config.py`):
- `4xUltrasharp_4xUltrasharpV10.pt`
- `4xLexicaDAT2_otf.pth`
- `4xRealWebPhoto_v4.pth`
- `4xPurePhoto-RealPLSKR.pth`
- `4xRealWebPhoto_v3_atd.pth`
- `4xNomos8kSCHAT-L.pth`

---

### Outfit Swapping

Swap outfits on a subject using up to 7 reference images.

**Patch points in `Outfit_Swapping_V1_API.json`:**

| Node | Description |
|---|---|
| `"1"` | Main subject image |
| `"11"` `"2"`–`"7"` | Reference images (up to 7) |
| `"30"` | Positive prompt (`102_POSITIVE_PROMPT_INPUT`) |
| `"13"`–`"16"` | Output path components |
| `"20"` | Username (`98_USER`) |

---

### Panorama Outpainting

Create 360° panoramas with interactive sticker placement.

**Patch points in `Panorama_Workflow_V5_API.json`:**

| Node | Description |
|---|---|
| State JSON | Panorama sticker positions from the editor |
| Prompt node | Positive prompt |
| Path nodes | Output path components |

---

### Image Edit

Edit images with text prompts and up to 4 reference images. Supports batch runs (1–10).

**Patch points in `image_edit_V3_API.json`:**

| Node | Description |
|---|---|
| `"11"` | Input image (`11_INPUT_IMAGE_LATENT`) |
| `"36"` | Prompt instruction (`05_PROMPT_INSTRUCTION`) |
| `"61"`–`"63"` `"68"` | Reference images (up to 4) |
| `"66"` | BatchImagesNode (rebuilt dynamically) |
| `"45"` `"55"` `"56"` | Output path (client / product / filename) |
| `"46"` | Username (`98_USER`) |
| `"35"` | Gemini seed (randomised per run) |

---

### Image Prompting

Generate images from a detailed prompt and up to 4 product reference images via Google Gemini. Supports batch runs (1–10).

**Patch points in `Image_Prompting_V1_API.json`:**

| Node | Description |
|---|---|
| `"667"` `"670"` `"671"` `"672"` | Reference images 1–4 (`11`–`14_INPUT_IMAGE_LATENT`) |
| `"669"` | BatchImagesNode (rebuilt dynamically) |
| `"666"` | Prompt instruction (`05_PROMPT_INSTRUCTION`) |
| `"656"` `"657"` `"655"` | Output path (client / product / filename) |
| `"658"` | Username (`98_USER`) |
| `"31"` | Gemini seed (randomised per run) |

---

### Video Creation

Generate video clips between a first and last frame using the LTX model. Length is configurable from 25 to 125 frames at 25 fps (1–5 seconds).

**Patch points in `LTX_IMG2Video_v01_API.json`:**

| Node | Description |
|---|---|
| `"31"` | First frame image (`11_INPUT_IMAGE_LATENT - First Frame`) |
| `"39"` | Last frame image (`12_INPUT_IMAGE_LATENT - Last Frame`) |
| `"146"` | Positive prompt (`05_PROMPT_INSTRUCTION`) |
| `"102"` | Frame count / length (25–125) |
| `"163"` `"164"` `"162"` | Output path (client / product / filename) |
| `"165"` | Username (`98_USER`) |
| `"172"` | Seed (randomised per run) |

The negative prompt (node `"148"`) and frame rate (node `"114"`, fixed at 25 fps) are not exposed in the UI.

---

## Gallery

The gallery browses the ComfyUI output directory and supports both images and videos.

### Supported formats

| Type | Extensions |
|---|---|
| Images | `.png` `.jpg` `.jpeg` `.gif` `.webp` `.bmp` |
| Videos | `.mp4` `.webm` `.mov` |

### Features

- **Folder tree** — Navigate client/project folder hierarchy
- **Detail view** — Full-size image viewer with zoom/pan; inline `<video>` player with native controls for video files
- **Grid view** — Thumbnail grid with multi-select, batch favourite, batch delete
- **Thumbnail strip** — Quick navigation; video files show a film-icon placeholder
- **Favourites** — Star any file; filter to favourites only
- **Rename / Move / Delete** — Right-click context menu on any file or folder
- **Metadata panel** — View embedded ComfyUI prompt, seed, and workflow data
- **Download** — Single file or entire folder as ZIP
- **Admin filter** — Admins can filter the gallery by client, project, or user

---

## API Endpoints

### Workflow Execution

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/workflow/magnific_upscaler` | Run Magnific upscale |
| `POST` | `/api/workflow/upscale_rework` | Create batch upscale job |
| `POST` | `/api/workflow/outfit_swapping` | Run outfit swap |
| `POST` | `/api/workflow/panorama` | Run panorama outpainting |
| `POST` | `/api/workflow/image_edit` | Run single image edit |
| `POST` | `/api/workflow/image_edit/batch` | Run batch image edit |
| `POST` | `/api/workflow/image_prompting/batch` | Run batch image prompting |
| `POST` | `/api/workflow/video_creation` | Run video creation |

### Batch Management

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/batch/{batch_id}` | Get batch status and job list |
| `POST` | `/api/batch/{batch_id}/cancel` | Cancel pending jobs |
| `GET` | `/api/batch/{batch_id}/download` | Download all outputs as ZIP |

### Utility

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/upload` | Upload image to ComfyUI |
| `GET` | `/api/status/{prompt_id}` | Check job status (returns `images` + `videos`) |
| `GET` | `/api/image` | Proxy image from ComfyUI |
| `GET` | `/api/video` | Proxy video from ComfyUI (correct MIME type) |
| `GET` | `/api/monitor/stats` | GPU/RAM/queue statistics |
| `GET` | `/api/workflow/upscale_rework/models` | List available upscale models |

### WebSocket

| Endpoint | Description |
|---|---|
| `WS /ws/{client_id}` | Real-time progress events for a running job |

---

## Admin Panel

- **Users** — Create/edit/delete users; assign group and allowed projects
- **Groups** — Define roles with named permission sets; toggle which apps each group can access
- **Clients** — Manage client records linked to output paths
- **Projects** — Manage project records linked to clients

Group permissions control which workflow modules appear for each user. Available module IDs:

`gallery` · `magnific-upscaler` · `upscaler-rework` · `outfit-swapping` · `panorama` · `image-edit` · `image-prompting` · `video-creation`

---

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
| `COMFYUI_OUTPUT_DIR` | Auto-detected | ComfyUI output directory |

---

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

---

## Adding a New Workflow

1. **Export from ComfyUI** in API format (Settings → Enable Dev Mode → Save \[API Format\])
2. **Place JSON** in `backend/workflows/<name>/`
3. **Create loader** `backend/workflows/<name>/<name>.py` — use `_load_workflow()` and `_random_seed()` from `..base`
4. **Register** in `backend/workflows/__init__.py`
5. **Add endpoint** in `backend/main.py`
6. **Add API function** in `frontend/src/api/client.ts`
7. **Create module** in `frontend/src/modules/<name>/`:
   - `index.ts` — `WorkflowModule` descriptor (id, title, description, icon, component)
   - `<Name>.tsx` — UI component
8. **Register module** in `frontend/src/modules/index.ts` → `workflowModules` array
9. **Add to admin** in `frontend/src/modules/admin/GroupsTab.tsx` → `ALL_MODULES` array

The module will automatically appear in the workflow grid and sidebar.

---

## Tech Stack

### Backend
- **FastAPI** — Web framework and API server
- **HTTPX** — Async HTTP client for ComfyUI communication
- **WebSockets** — Real-time progress updates
- **SQLite** — User, group, and gallery database
- **Pillow** — Thumbnail generation and PNG metadata stripping

### Frontend
- **React 18** — UI framework
- **TypeScript** — Type-safe development
- **Vite** — Fast development server and bundler
- **TailwindCSS** — Utility-first styling
- **shadcn/ui** — Accessible UI components
- **lucide-react** — Icon library
