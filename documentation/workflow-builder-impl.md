# Workflow Builder — Implementation Plan

## Architecture decisions

- **All tools (built-in + custom) live in one SQLite table.** No JSON files read at runtime.
- **Built-in tools are seeded on first startup** from Python dicts in a seed file. The JSON files in
  `backend/workflows/` serve as the source-of-truth for the workflow blobs but are only touched during
  seeding, never at request time.
- **Generic patcher handles everything.** No per-workflow Python loader logic. The
  `INDGFlexibleImageBatch` custom ComfyUI node (in `INDG_CustomNodes`) eliminates the only case
  (Image Edit, Image Prompting) that previously needed special backend code.
- **Batch runs are also tracked in SQLite**, replacing the current in-memory dict. This makes batch
  state survive server restarts.
- **Docker stops copying workflow JSONs** once the DB is seeded. The Docker image only needs the
  FastAPI code; workflow data lives on the NAS / RunPod network volume in `users.db`.

---

## Data model

### `tools` table

Stores both built-in tools (`is_builtin = 1`) and user-created custom tools (`is_builtin = 0`).

```sql
CREATE TABLE IF NOT EXISTS tools (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    description  TEXT DEFAULT '',
    icon         TEXT DEFAULT 'Layers',
    is_builtin   INTEGER DEFAULT 0,
    fields_json  TEXT NOT NULL,        -- JSON: FieldDef[]
    path_nodes   TEXT,                 -- JSON: {client, product, filename} | NULL
    auto_nodes   TEXT DEFAULT '[]',    -- JSON: AutoNode[]
    workflow     TEXT NOT NULL,        -- full ComfyUI API JSON as text blob
    created_at   TEXT NOT NULL
);
```

### `batch_runs` table

Replaces the current in-memory batch job dict.

```sql
CREATE TABLE IF NOT EXISTS batch_runs (
    batch_id    TEXT NOT NULL,
    run_index   INTEGER NOT NULL,
    prompt_id   TEXT,
    status      TEXT DEFAULT 'queued',  -- queued / processing / done / error
    output_json TEXT,
    PRIMARY KEY (batch_id, run_index)
);
```

### Tool definition JSON schema

Every tool row's `fields_json` is an array of `FieldDef` objects:

```jsonc
[
  {
    "id": "subject_image",      // stable slug — used as form key
    "label": "Input Image",
    "type": "image",            // see field types below
    "node_id": "11",
    "input_key": "image",
    "required": true
  },
  {
    "id": "prompt",
    "label": "Prompt Instruction",
    "type": "textarea",
    "node_id": "36",
    "input_key": "value",
    "required": true,
    "placeholder": "Describe the edit to apply…",
    "rows": 6
  },
  {
    "id": "steps",
    "label": "Steps",
    "type": "number",
    "node_id": "22",
    "input_key": "value",
    "required": false,
    "min": 1, "max": 100, "step": 1, "default": 30
  },
  {
    "id": "scale_factor",
    "label": "Scale Factor",
    "type": "select",
    "node_id": "9",
    "input_key": "scale_factor",
    "options": ["2x", "4x", "8x", "16x"],
    "default": "2x"
  }
]
```

**Field types:** `image` | `text` | `textarea` | `number` | `slider` | `select` | `toggle`

`path_nodes` (optional):
```json
{ "client": "45", "product": "55", "filename": "56" }
```

`auto_nodes` — values injected automatically at run time, not exposed in the form:
```json
[
  { "node_id": "35", "input_key": "seed",  "strategy": "random_seed" },
  { "node_id": "46", "input_key": "value", "strategy": "username"    }
]
```

---

## Phase 0 — Custom ComfyUI node ✓ Done

**Repo: `INDG_CustomNodes`** — `nodes/flexible_image_batch.py` + `nodes/ram_cleanup.py` created.
`comfyui-docker/build/install_custom_nodes.sh` updated to clone `INDG_CustomNodes`.

`INDGFlexibleImageBatch` accepts `image_1` (required) through `image_7` (optional), concatenates
along dim=0, and auto-resizes mismatched dimensions.

**Remaining step (manual):** Open the Image Edit and Image Prompting workflows in ComfyUI,
replace the `BatchImagesNode` with `INDGFlexibleImageBatch`, re-export in API format, and drop
the updated JSONs into `backend/workflows/image_edit/` and `backend/workflows/image_prompting/`.
Once done, both workflows become pure patch maps and Phase 1 can proceed.

---

## Phase 1 — Backend: `backend/tools.py`

Replaces the planned `backend/custom_tools.py`. Handles all tools (built-in + custom) through one
module.

### 1.1  DB init

Called from `main.py` startup alongside `init_gallery_db()` and `init_user_db()`.

```python
def init_tools_db() -> None:
    """Create tools and batch_runs tables if they don't exist, then seed built-ins."""
    _create_tables()
    _seed_builtin_tools()
```

`_create_tables()` — runs the two CREATE TABLE IF NOT EXISTS statements above.

`_seed_builtin_tools()` — for each entry in `BUILTIN_TOOLS` (see 1.2), inserts the row only if
`id` doesn't already exist. This means re-deploying never overwrites user edits to built-in tools,
and the seed only runs once.

### 1.2  Seed data: `backend/tools_seed.py`

One Python dict per built-in tool:

```python
from pathlib import Path
import json

def _wf(name: str) -> str:
    """Load a workflow JSON as a string (used only during seeding)."""
    return (Path(__file__).parent / "workflows" / name).read_text()

BUILTIN_TOOLS = [
    {
        "id": "magnific-upscaler",
        "name": "Magnific Upscaler",
        "description": "Upscale 2×–16× with sharpening and detail controls",
        "icon": "ZoomIn",
        "is_builtin": 1,
        "fields_json": json.dumps([
            {"id": "image",        "label": "Input Image",   "type": "image",  "node_id": "12", "input_key": "image",        "required": True},
            {"id": "scale_factor", "label": "Scale Factor",  "type": "select", "node_id": "9",  "input_key": "scale_factor", "options": ["2x","4x","8x","16x"], "default": "4x"},
            {"id": "sharpen",      "label": "Sharpen",       "type": "slider", "node_id": "17", "input_key": "value",        "min": 0, "max": 10, "step": 1, "default": 3},
            {"id": "smart_grain",  "label": "Smart Grain",   "type": "slider", "node_id": "18", "input_key": "value",        "min": 0, "max": 10, "step": 1, "default": 3},
            {"id": "ultra_detail", "label": "Ultra Detail",  "type": "slider", "node_id": "19", "input_key": "value",        "min": 0, "max": 50, "step": 1, "default": 30},
        ]),
        "path_nodes": json.dumps({"client": "2", "product": "4", "filename": "5"}),
        "auto_nodes": json.dumps([
            {"node_id": "3", "input_key": "value", "strategy": "username"},
        ]),
        "workflow": _wf("magnific_upscaler/Magnific_Upscaler_V1_API.json"),
    },
    # … one entry per built-in tool (video_creation, outfit_swapping, panorama,
    #   image_edit, image_prompting, upscale_rework — each follows the same shape)
]
```

### 1.3  Generic patcher

```python
import copy, json, random

_MAX_SEED = 2**53 - 1

def apply_patches(tool_row: dict, values: dict, username: str = "") -> dict:
    """
    Load the workflow from tool_row and apply all field patches + auto_nodes.
    Returns a ready-to-submit ComfyUI workflow dict.
    """
    workflow = copy.deepcopy(json.loads(tool_row["workflow"]))
    fields   = json.loads(tool_row["fields_json"])
    auto     = json.loads(tool_row["auto_nodes"] or "[]")

    # Field patches
    for field in fields:
        value = values.get(field["id"], field.get("default"))
        if value is None:
            continue
        node = workflow.get(field["node_id"])
        if node:
            node["inputs"][field["input_key"]] = value

    # Path nodes  (passed in via values with reserved keys)
    path_nodes = json.loads(tool_row["path_nodes"] or "null")
    if path_nodes:
        for key, node_id in path_nodes.items():
            v = values.get(f"__path_{key}")
            if v and node_id and node_id in workflow:
                workflow[node_id]["inputs"]["value"] = v

    # Auto-nodes
    for spec in auto:
        node = workflow.get(spec["node_id"])
        if not node:
            continue
        if spec["strategy"] == "random_seed":
            node["inputs"][spec["input_key"]] = random.randint(0, _MAX_SEED)
        elif spec["strategy"] == "username":
            node["inputs"][spec["input_key"]] = username

    return workflow
```

### 1.4  CRUD helpers

```python
def load_tool(tool_id: str) -> dict          # raises 404 HTTPException if not found
def list_tools(include_builtin=True) -> list  # omits workflow blob
def save_tool(tool: dict) -> None             # INSERT OR REPLACE
def delete_tool(tool_id: str) -> None         # raises 404 if not found or is_builtin
```

### 1.5  FastAPI router in `backend/tools.py`

```python
router = APIRouter(prefix="/api/tools", tags=["tools"])
```

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/` | list all tools (no workflow blob) |
| `POST` | `/` | create custom tool |
| `GET` | `/{tool_id}` | full tool definition (with workflow) |
| `PUT` | `/{tool_id}` | update (forbidden on built-ins) |
| `DELETE` | `/{tool_id}` | delete (forbidden on built-ins) |
| `POST` | `/{tool_id}/run` | single-job execution |
| `POST` | `/{tool_id}/batch` | multi-run execution |
| `GET` | `/batch/{batch_id}` | batch status |
| `POST` | `/batch/{batch_id}/cancel` | cancel pending runs |
| `GET` | `/batch/{batch_id}/download` | ZIP download |

**Run endpoint** (single job):
1. `load_tool(tool_id)`
2. `apply_patches(tool, body.values, username)`
3. `await comfy_client.queue_workflow(wf, client_id)`
4. Return `{prompt_id, client_id}`

**Batch endpoint** (N runs):
1. Create `batch_id` (UUID)
2. Insert N rows into `batch_runs` (status=queued)
3. For each run: `apply_patches(tool, {**values, seed_override})` → queue → update row
4. Return `{batch_id, total}`

### 1.6  Register in `backend/main.py`

```python
from tools import router as tools_router, init_tools_db
app.include_router(tools_router)
# in startup event:
init_tools_db()
```

---

## Phase 2 — Migrate built-in tool backends to generic patcher

Once Phase 1 is working and the seed data is verified, swap the internals of the existing
FastAPI endpoints to use `apply_patches()` instead of the per-workflow Python loaders.

1. Update each route in `backend/main.py` to call `apply_patches(load_tool("<id>"), ...)` instead
   of the specific loader (`load_image_edit(...)`, `load_magnific_upscaler(...)`, etc.)
2. Delete the Python loader files (`backend/workflows/*/image_edit.py`, etc.) — they are no longer
   called
3. Update `backend/workflows/__init__.py` to empty
4. Keep the workflow JSON files in `backend/workflows/*/` — still used by the seed and for version
   control

**The existing frontend components (`ImageEdit.tsx`, `MagnificUpscaler.tsx`, etc.) are NOT
replaced.** They keep their hand-crafted UIs and continue calling the same API endpoints. Only the
backend plumbing changes. Migrating built-in tool UIs to the generic runner is optional and can
happen later if desired.

---

## Phase 3 — Frontend API layer

**Edit: `frontend/src/api/client.ts`** — add:

```ts
export async function listTools(): Promise<ToolSummary[]>
export async function getTool(id: string): Promise<ToolDef>
export async function createTool(def: CreateToolPayload): Promise<ToolSummary>
export async function updateTool(id: string, patch: UpdateToolPayload): Promise<ToolSummary>
export async function deleteTool(id: string): Promise<void>
export async function runTool(id: string, values: Record<string, unknown>, pathArgs: PathArgs, username?: string): Promise<{prompt_id: string; client_id: string}>
export async function runToolBatch(id: string, values: Record<string, unknown>, count: number, pathArgs: PathArgs, username?: string): Promise<{batch_id: string; total: number}>
```

**New file: `frontend/src/modules/workflow-builder/types.ts`**

```ts
export type FieldType = 'image' | 'text' | 'textarea' | 'number' | 'slider' | 'select' | 'toggle'

export interface FieldDef {
  id: string
  label: string
  type: FieldType
  node_id: string
  input_key: string
  required?: boolean
  placeholder?: string
  rows?: number
  min?: number; max?: number; step?: number
  default?: unknown
  options?: string[]
}

export interface PathNodes { client: string | null; product: string | null; filename: string | null }
export interface AutoNode  { node_id: string; input_key: string; strategy: 'random_seed' | 'username' }

export interface ToolSummary {
  id: string; name: string; description: string; icon: string
  is_builtin: boolean; created_at: string
}
export interface ToolDef extends ToolSummary {
  workflow: Record<string, unknown>
  fields: FieldDef[]
  path_nodes: PathNodes | null
  auto_nodes: AutoNode[]
}

// Used by the builder to describe what's detectable in a workflow JSON
export interface DetectedInput {
  node_id: string; title: string; class_type: string
  input_key: string; current_value: unknown
  detected_type: FieldType | 'auto_seed' | 'auto_user' | 'output_path'
}
```

---

## Phase 4 — Generic runner: `frontend/src/modules/custom-tool/`

### `FieldRenderer.tsx`

Shared by both the runner and the builder's live preview.

```tsx
interface FieldRendererProps {
  field: FieldDef
  value: unknown
  slot?: ImageSlot        // only for type === 'image'
  onChange: (id: string, value: unknown) => void
  onFile?: (id: string, file: File) => void
  onClearImage?: (id: string) => void
  disabled?: boolean
  error?: boolean
}
```

Switch on `field.type`:
- `image`    → `<DropZone>`
- `text`     → `<input type="text">`
- `textarea` → `<textarea rows={field.rows ?? 4}>`
- `number`   → `<input type="number" min max step>`
- `slider`   → `<input type="range">` + value readout
- `select`   → `<select>` with `field.options`
- `toggle`   → shadcn `<Switch>`

### `CustomTool.tsx`

```tsx
interface CustomToolProps { toolId: string }
```

1. On mount: `getTool(toolId)` → init `values` with each `field.default`
2. Image fields: upload via existing `/api/upload`, store filename in `imageSlots`
3. Submit: merge `imageSlots` filenames into `values`, call `runTool` or `runToolBatch`
4. Progress: poll `/api/status/{prompt_id}` (single) or `/api/tools/batch/{batch_id}` (multi)
5. Results: show images/videos with download buttons — same pattern as `MagnificUpscaler.tsx`

---

## Phase 5 — Builder wizard: `frontend/src/modules/workflow-builder/`

### Files

| File | Role |
|------|------|
| `index.ts` | `WorkflowModule` descriptor — id: `workflow-builder` |
| `WorkflowBuilder.tsx` | Wizard orchestrator (steps 1–3) |
| `steps/StepUpload.tsx` | Drop zone for `.json`, parse + detect, inspection table |
| `steps/StepFields.tsx` | Field cards + output path block + live preview |
| `steps/StepMeta.tsx` | Name, description, icon picker |
| `types.ts` | Shared TypeScript types (also used by custom-tool) |
| `utils.ts` | `detectInputs(workflow)` pure function |

### `detectInputs()` logic (in `utils.ts`)

For each node in the workflow:
- Skip inputs whose value is an array (wired node-to-node connections)
- Infer `detected_type` by class_type and input_key:
  - `LoadImage` + `input_key === "image"` → `image`
  - `easy int` → `number`
  - `easy float` → `number` (step: 0.1)
  - Contains `"Multiline"` or `"CLIPText"` → `textarea`
  - `input_key === "seed"` or title contains `"seed"` → `auto_seed`
  - title matches `*_USER` → `auto_user`
  - title matches `*CLIENT_PATH*` / `*PRODUCT_PATH*` / `*FILENAME*` → `output_path`
  - Fallback → `text`

### Wizard state (in `WorkflowBuilder.tsx`)

```ts
const [step, setStep]         = useState<1|2|3>(1)
const [workflowJson, ...]     // parsed ComfyUI JSON
const [detected, ...]         // DetectedInput[]
const [fields, setFields]     // FieldDef[] — ordered list user has configured
const [pathNodes, ...]        // PathNodes
const [autoNodes, ...]        // AutoNode[]
const [toolName, ...]
const [toolDesc, ...]
const [toolIcon, ...]
const [saving, ...]
```

On save (step 3): `createTool(payload)` → navigate to `/tool/{tool.id}`.

---

## Phase 6 — Dynamic module registration

### `frontend/src/context/ToolsContext.tsx`

```tsx
interface ToolsContextValue {
  tools: ToolSummary[]
  reload: () => Promise<void>
}
```

Fetches `listTools()` on mount. `reload()` is called after builder saves a new tool.

### Sidebar + hub

`AppSidebar.tsx` — add "Custom Tools" section below "Workflow Tools", reading from `ToolsContext`.
Only shows tools with `is_builtin === false`.

`ModuleGrid.tsx` — add "Custom Tools" row with tiles + "+ New Tool" tile.

### Routing (`App.tsx`)

```tsx
<Route path="/builder"        element={<WorkflowBuilder />} />
<Route path="/tool/:toolId"   element={<CustomToolPage />} />
```

`CustomToolPage` reads `toolId` from `useParams()`, renders `<CustomTool toolId={toolId} />`.

---

## Phase 7 — Admin panel

**New tab:** `frontend/src/modules/admin/CustomToolsTab.tsx`

Table: name, icon, description, created date, actions (delete, with confirmation).
Built-in tools shown read-only — no delete option.

**`GroupsTab.tsx`** — derive the `ALL_MODULES` array dynamically: static workflow module IDs
plus `ToolSummary[]` from `ToolsContext` (mapped to `{ id: "tool-{id}", label: tool.name }`).

---

## Build order

| Phase | What | Dependency |
|-------|------|-----------|
| 0 | `INDGFlexibleImageBatch` custom node | None — do first |
| 1 | `backend/tools.py` — DB, patcher, router | Phase 0 (updated workflow JSONs) |
| 2 | Retire old loaders | Phase 1 verified |
| 3 | Frontend API types + `client.ts` additions | Phase 1 |
| 4 | `FieldRenderer` + `CustomTool` runner | Phase 3 |
| 5 | Builder wizard | Phase 3 + 4 |
| 6 | Context, routing, sidebar, hub | Phase 4 |
| 7 | Admin panel additions | Phase 6 |

---

## Files to create

```
backend/
  tools.py              ← DB init, generic patcher, CRUD helpers, FastAPI router
  tools_seed.py         ← BUILTIN_TOOLS list (field maps + workflow blobs)

frontend/src/
  context/ToolsContext.tsx
  modules/
    workflow-builder/
      index.ts
      WorkflowBuilder.tsx
      types.ts
      utils.ts
      steps/StepUpload.tsx
      steps/StepFields.tsx
      steps/StepMeta.tsx
    custom-tool/
      CustomTool.tsx
      FieldRenderer.tsx
  modules/admin/CustomToolsTab.tsx

INDG_CustomNodes/
  __init__.py
  nodes/__init__.py
  nodes/flexible_image_batch.py
  nodes/ram_cleanup.py
```

## Files to edit

```
backend/main.py                          ← include tools router + init_tools_db()
frontend/src/App.tsx                     ← ToolsProvider, /builder + /tool/:id routes
frontend/src/api/client.ts               ← tool CRUD + run functions
frontend/src/components/AppSidebar.tsx   ← custom tools section
frontend/src/components/ModuleGrid.tsx   ← custom tools row
frontend/src/modules/index.ts            ← add builder module
frontend/src/modules/admin/GroupsTab.tsx ← dynamic ALL_MODULES
comfyui-docker/build/install_custom_nodes.sh ← add INDG_CustomNodes clone
```
