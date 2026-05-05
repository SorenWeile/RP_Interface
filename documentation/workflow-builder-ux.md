# Workflow Builder — UX Design

## Overview

The Workflow Builder lets a user upload any ComfyUI workflow JSON and turn it into a first-class tool
in the app, indistinguishable from the hand-coded modules. The experience has two distinct parts:

1. **The Builder** — a 3-step wizard for creating the tool (done once, by a power user).
2. **The Runner** — the auto-generated form for using the saved tool (used repeatedly, by anyone).

---

## Part 1 — The Builder Wizard

### Entry point

A "Custom Tools" section appears at the bottom of the sidebar, below the Workflow Tools group.
It always contains a **"+ New Tool"** item. Any saved custom tools appear above it.

On the hub (ModuleGrid), Custom Tools gets its own row, same as the Gallery / Workflow Tools rows,
with each saved tool as a tile and a "+ New Tool" tile at the end.

---

### Step 1 — Upload & Inspect

**Screen layout:**
```
┌─────────────────────────────────────────────────────────┐
│  Step 1 of 3 — Upload Workflow           ● ○ ○          │
├─────────────────────────────────────────────────────────┤
│                                                         │
│   ┌─────────────────────────────────────────────────┐   │
│   │                                                 │   │
│   │            ↓  Drop workflow.json                │   │
│   │        or click to browse (.json only)          │   │
│   │                                                 │   │
│   └─────────────────────────────────────────────────┘   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

The drop zone accepts `.json` only. The JSON is parsed entirely in the browser — nothing is
sent to the server at this step.

**After upload — parse summary appears above the table:**
```
 ✓  my_portrait_workflow.json
    47 nodes · 14 configurable inputs detected · 9 internal connections hidden
```

**The inspection table** shows every node input where the current value is a scalar
(string, number, boolean). Node-to-node wire connections (`[node_id, output_index]` arrays)
are filtered out entirely.

```
┌───────────┬────────────────────────────────┬──────────────────────────┬────────────┬──────────────────┬──────────────────┐
│ Node      │ Title (_meta)                  │ Class                    │ Input      │ Current value    │ Detected type    │
├───────────┼────────────────────────────────┼──────────────────────────┼────────────┼──────────────────┼──────────────────┤
│ 11        │ 11_INPUT_IMAGE_LATENT          │ LoadImage                │ image      │ example.png      │ 🖼  Image        │
│ 36        │ 05_PROMPT_INSTRUCTION          │ PrimitiveStringMultiline │ value      │ (empty)          │ ≡  Textarea      │
│ 22        │ 03_STEPS                       │ easy int                 │ value      │ 30               │ #  Number        │
│ 9         │ 02_SCALE_FACTOR                │ ScaleNode                │ scale_fac… │ "2x"             │ T  Text          │
│ 45        │ 95_CLIENT_PATH                 │ easy string              │ value      │ ComfyUI          │ 📁 Output Path   │
│ 55        │ 96_PRODUCT_PATH                │ easy string              │ value      │ (empty)          │ 📁 Output Path   │
│ 56        │ 97_FILENAME                    │ easy string              │ value      │ Shot001          │ 📁 Output Path   │
│ 46        │ 98_USER                        │ easy string              │ value      │ (empty)          │ 🔒 Auto (hidden) │
│ 35        │ seed                           │ GeminiImage2Node         │ seed       │ 120740410…       │ 🎲 Auto (random) │
└───────────┴────────────────────────────────┴──────────────────────────┴────────────┴──────────────────┴──────────────────┘
```

**Auto-detection rules** (applied to every row):

| Condition | Detected type |
|-----------|--------------|
| `class_type === "LoadImage"` and `input_key === "image"` | Image |
| `class_type === "easy int"` | Number (integer) |
| `class_type === "easy float"` | Number (float, step 0.1) |
| `class_type` contains `"Multiline"` or `"CLIPText"` | Textarea |
| `class_type` contains `"String"` and value is string | Text |
| value is `true` / `false` | Toggle |
| `input_key === "seed"` or title contains `"seed"` | Auto-random (hidden, seeded per-run) |
| title matches `*_USER` or `*98_USER*` | Auto-hidden (username injected by server) |
| title matches `*CLIENT_PATH*` / `*PRODUCT_PATH*` / `*FILENAME*` | Output Path |
| fallback | Text |

Rows detected as **Auto-random** or **Auto-hidden** are dimmed and have a badge
("randomised each run" / "injected by server") — they cannot be exposed as user fields,
but the user can see them and understand what happens.

**Output Path rows** are also handled specially (see Step 2).

The "Next" button activates as soon as the JSON parses without error.

---

### Step 2 — Configure Fields

This is the core of the wizard. It has a two-column layout:

```
┌──────────────────────────────────┬───────────────────────────────────┐
│  LEFT — Field list               │  RIGHT — Live form preview        │
│                                  │                                   │
│  [Output Path section]           │  ┌───────────────────────────┐   │
│  [Drag-reorderable field cards]  │  │  Input Image              │   │
│  [+ Add from table]              │  │  ┌─────────────────────┐  │   │
│                                  │  │  │ ↓ Drop image here   │  │   │
│                                  │  │  └─────────────────────┘  │   │
│                                  │  │                           │   │
│                                  │  │  Prompt Instruction       │   │
│                                  │  │  ┌─────────────────────┐  │   │
│                                  │  │  │                     │  │   │
│                                  │  │  │                     │  │   │
│                                  │  │  └─────────────────────┘  │   │
│                                  │  │                           │   │
│                                  │  │  Scale Factor             │   │
│                                  │  │  [──────────────── 2x ▾]  │   │
│                                  │  │                           │   │
│                                  │  │  ─────────────────────── │   │
│                                  │  │  [Client / Product / …]   │   │
│                                  │  │                           │   │
│                                  │  │  [    Generate    ]       │   │
│                                  │  └───────────────────────────┘   │
└──────────────────────────────────┴───────────────────────────────────┘
```

#### Left column — field list

**Output Path block (top, always)**

A special section at the top of the left column. If nodes with titles matching
`CLIENT_PATH`, `PRODUCT_PATH`, and `FILENAME` were detected in step 1, they are
automatically pre-filled here. The user can also manually assign or clear them.

```
┌───────────────────────────────────────┐
│  Output Path                      [?] │
│  Client node:   [45 · 95_CLIENT…  ▾]  │
│  Product node:  [55 · 96_PRODUCT… ▾]  │
│  Filename node: [56 · 97_FILENAME ▾]  │
│  (leave blank to hide path picker)    │
└───────────────────────────────────────┘
```

When at least one path node is assigned, the live preview shows a `ClientProjectPicker` at
the bottom, just like every other tool.

**Field cards**

Each exposed field appears as a draggable card:

```
┌── ⠿ drag handle ────────────────────────────────────────────────────┐
│  🖼  Input Image                                         [×] remove  │
│  node 11 · image                                                     │
│  Label:   [Input Image                              ]                │
│  Type:    [Image Upload         ▾]                                   │
│  Required: [●]  Yes / No                                             │
└─────────────────────────────────────────────────────────────────────┘

┌── ⠿ drag handle ────────────────────────────────────────────────────┐
│  ≡  Prompt Instruction                               [×] remove      │
│  node 36 · value                                                     │
│  Label:        [Prompt Instruction                  ]                │
│  Type:         [Textarea                            ▾]               │
│  Placeholder:  [Describe the edit to apply…         ]                │
│  Required:     [●]  Yes / No                                         │
└─────────────────────────────────────────────────────────────────────┘

┌── ⠿ drag handle ────────────────────────────────────────────────────┐
│  #  Steps                                            [×] remove      │
│  node 22 · value                                                     │
│  Label:    [Steps                                   ]                │
│  Type:     [Number                                  ▾]               │
│  Min: [1 ]   Max: [100]   Step: [1 ]   Default: [30 ]               │
│  Required: [●]  Yes / No                                             │
└─────────────────────────────────────────────────────────────────────┘

┌── ⠿ drag handle ────────────────────────────────────────────────────┐
│  ▤  Scale Factor                                     [×] remove      │
│  node 9 · scale_factor                                               │
│  Label:    [Scale Factor                            ]                │
│  Type:     [Select                                  ▾]               │
│  Options:  [2x] [4x] [8x] [16x]  [+ add option]                     │
│  Default:  [2x ▾]                                                    │
│  Required: [●]  Yes / No                                             │
└─────────────────────────────────────────────────────────────────────┘
```

**Control types available in the "Type" dropdown:**

| Type | Renders as | Extra options |
|------|-----------|--------------|
| Image Upload | DropZone | — |
| Text | `<input type="text">` | placeholder, default |
| Textarea | `<textarea>` | placeholder, rows (2–12), default |
| Number | `<input type="number">` | min, max, step, default |
| Slider | range slider + readout | min, max, step, default |
| Select | styled `<select>` | options list (pill input), default |
| Toggle | switch | default on/off |

**"+ Add from table" button**

Opens a popover listing all patchable inputs from step 1 that haven't been added yet as fields.
Clicking one instantly adds a new card at the bottom of the list with auto-detected defaults.

#### Right column — live preview

The preview re-renders in real time as the user edits field cards. It uses the same component
classes as real tools — the preview *is* the actual form, just with all inputs disabled. This
gives the user an exact picture of the final result.

#### Minimum requirement to advance

At least one non-path field must be added. If the user tries to proceed with zero fields,
an inline message reads: "Add at least one field before continuing."

---

### Step 3 — Name & Save

```
┌────────────────────────────────────────────────────────────┐
│  Step 3 of 3 — Name your tool              ○ ○ ●           │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  Tool name *                                               │
│  [Portrait Generator                                     ] │
│                                                            │
│  Short description                                         │
│  [Generate a portrait from a reference photo…            ] │
│                                                            │
│  Icon                                                      │
│  ┌───┬───┬───┬───┬───┬───┬───┬───┬───┬───┬───┬───┬───┐   │
│  │ 📷│ 🎨│ ✨│ 🖌│ 🎭│ 🔮│ 🌅│ 🏔│ 🎬│ 🖼│ 💡│ ⚡│ 🧬│   │
│  │   │ ✓ │   │   │   │   │   │   │   │   │   │   │   │   │
│  └───┴───┴───┴───┴───┴───┴───┴───┴───┴───┴───┴───┴───┘   │
│  (scrollable grid of lucide-react icon names)              │
│                                                            │
│  ┌─────────────────────────────────────────────────────┐  │
│  │  Preview tile                                       │  │
│  │  🎨 Portrait Generator                              │  │
│  │  Generate a portrait from a reference photo…        │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                            │
│  [← Back]                          [Save Tool →]          │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

- Tool name is required; client-side validates non-empty.
- Description is optional.
- Icon defaults to a generic "Layers" icon if nothing is chosen.
- "Save Tool" sends the full definition to the server. On success, the user is navigated
  directly to the new tool's runner page.

---

## Part 2 — The Runner (auto-generated tool)

The runner looks identical to any hand-coded module — same page shell, same sidebar item.

### Layout

```
┌─────────────────────────────────────────────────────────┐
│  ← Back      Portrait Generator                    ⋯     │
│              Generate a portrait from a reference photo  │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  (fields in configured order)                           │
│                                                         │
│  INPUT IMAGE *                                          │
│  ┌────────────────────────────────────────────────┐    │
│  │ ↓ Drop image here or click to browse           │    │
│  └────────────────────────────────────────────────┘    │
│                                                         │
│  ─────────────────────────────────────────────          │
│                                                         │
│  PROMPT INSTRUCTION *                                   │
│  ┌────────────────────────────────────────────────┐    │
│  │                                                │    │
│  │                                                │    │
│  └────────────────────────────────────────────────┘    │
│                                                         │
│  STEPS                                                  │
│  [────────────────────────────────── 30 ]               │
│                                                         │
│  SCALE FACTOR                                           │
│  [2x ▾]                                                 │
│                                                         │
│  ─────────────────────────────────────────────          │
│                                                         │
│  (ClientProjectPicker — if path nodes configured)       │
│                                                         │
│  [            Generate            ]                     │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

The `⋯` menu (top-right) offers: **Edit tool** (back to builder, step 2), **Delete tool**.

### Batch runs

If the tool definition contains at least one `auto_seed` auto-node (i.e. something is randomised
per run), a **Runs** slider appears above the Generate button — identical to the one on Image Edit.
Range 1–10. Tools with no seed nodes omit the slider; every run would produce the same output.

### Progress & Results

**Single run:** progress bar → result images/videos shown inline with a Download button.

**Batch run:** run-dot indicators (same as Image Edit) → "Download ZIP" button when all done.

"New run" resets to idle while keeping uploaded images in their slots, same as existing tools.

---

## Managing Custom Tools

### Edit flow

Clicking **Edit tool** from a runner opens the builder wizard pre-filled at **step 2** —
the uploaded workflow is already loaded, all fields are pre-configured. The user can:
- Reorder, add, or remove fields
- Change labels and control types
- Update path node assignments
- Jump to step 3 to rename/re-icon

Saving overwrites the existing tool definition (the workflow JSON does not change).

### Delete

Available from the `⋯` menu on the runner, and from the admin panel.
Shows a confirmation dialog: "Delete 'Portrait Generator'? This cannot be undone."
After deletion the sidebar item and hub tile disappear immediately.

### Built-in tools vs custom tools

The existing built-in tools (Magnific Upscaler, Image Edit, etc.) keep their hand-crafted React
UIs — they are **not** replaced by the generic runner. They continue to appear under "Workflow
Tools" in the sidebar, unchanged.

The "Custom Tools" sidebar section and hub row only show user-created tools (`is_builtin = false`).
The builder wizard is only for creating new custom tools, not for editing built-in ones.

### Admin panel

A "Custom Tools" tab in the admin panel lists all user-created tools (name, created date, field
count). Admins can delete any custom tool. Built-in tools are shown read-only in a separate list.
Group permissions include an entry per custom tool — by default a new tool is visible to all
groups; admins can restrict it.

---

## Error states

| Situation | Shown as |
|-----------|---------|
| Uploaded file is not valid JSON | Inline error under drop zone: "Not a valid JSON file." |
| JSON parses but has no patchable inputs | Warning banner: "No configurable inputs found in this workflow. Check that it was exported in API format." |
| Step 2: zero fields added, user clicks Next | Inline: "Add at least one field before continuing." |
| Step 3: tool name empty, user clicks Save | Field outline turns red, inline: "Tool name is required." |
| Save fails (server error) | Toast: "Could not save tool — try again." |
| Runner: required field empty, user clicks Generate | Each empty required field gets a red outline and label. |
| Runner: submission fails | Red error box below the button, same as existing tools. |
