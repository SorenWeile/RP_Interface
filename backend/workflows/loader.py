"""
Workflow loader and patcher.
Each workflow has a load_* function that reads the JSON and patches runtime values.

upscale.json patch points:
  Node "2"  → inputs.image : input image filename

Upscaler_Rework_API.json patch points:
  Node "18"  → inputs.image        : input image filename
  Node "167" → inputs.model_name   : upscale model (feeds both 4K and 8K branches)
  Node "173" → inputs.value        : client path  (e.g. "Deployed/HD")
  Node "15"  → inputs.value        : product path (e.g. "ProjectName")
  Node "16"  → inputs.value        : filename prefix (model shortname + run index baked in automatically)
  Path chain: 171("ComfyUI")/173/15 → split into 4K(node 175/177) and 8K(node 176/178) → MetaSaver 99+132

Outfit_Swapping.json patch points:
  Node "1"  → inputs.image   : main subject image (LoadImage)
  Node "11" → inputs.image   : ref image 1
  Node "2"  → inputs.image   : ref image 2
  Node "3"  → inputs.image   : ref image 3
  Node "4"  → inputs.image   : ref image 4
  Node "5"  → inputs.image   : ref image 5
  Node "6"  → inputs.image   : ref image 6
  Node "7"  → inputs.image   : ref image 7
  Node "23" → inputs.text    : positive prompt (Text Multiline)
  Node "13" → inputs.value   : base path — always "ComfyUI"
  Node "14" → inputs.value   : client path  (e.g. "Deployed/HD")
  Node "15" → inputs.value   : product path (e.g. "ProjectName")
  Node "16" → inputs.value   : filename prefix
  Path chain: 13/14/15/16 → concat nodes 27→28→29 → MetaSaver 26
"""

import json
import copy
import random
from pathlib import Path

_MAX_SEED = 2**53 - 1  # ComfyUI accepts up to 53-bit seeds


def _random_seed() -> int:
    return random.randint(0, _MAX_SEED)

WORKFLOWS_DIR = Path(__file__).parent


def _load(name: str) -> dict:
    path = WORKFLOWS_DIR / f"{name}.json"
    with open(path) as f:
        return json.load(f)


def load_upscale(filename: str) -> dict:
    workflow = copy.deepcopy(_load("upscale"))
    workflow["2"]["inputs"]["image"] = filename
    return workflow


def load_upscale_rework(
    filename: str,
    model_name: str,
    run_index: int,
    client_path: str,
    product_path: str,
    filename_prefix: str,
    username: str = "",
) -> dict:
    """
    Patch Upscaler_Rework_API.json for a single batch run.
    The model shortname and run index are automatically appended to the filename
    prefix so every output is uniquely identifiable in the ComfyUI output folder.
    """
    workflow = copy.deepcopy(_load("Upscaler_Batch_V2_API"))

    # Image input
    workflow["18"]["inputs"]["image"] = filename

    # Upscale model — node 167 feeds both the 4K (62) and 8K (128) branches
    workflow["167"]["inputs"]["model_name"] = model_name

    # Output path nodes
    workflow["173"]["inputs"]["value"] = client_path   # client path (concat node 172 feeds 174→175/176→177/178)
    workflow["15"]["inputs"]["value"] = product_path   # 96_PRODUCT_PATH

    # Build a unique filename prefix: "<user_prefix>_<model_short>_r<NN>_"
    # Strip extension and truncate so paths stay reasonable
    model_short = model_name.rsplit(".", 1)[0][:24]
    workflow["16"]["inputs"]["value"] = f"{filename_prefix}_{model_short}_r{run_index:02d}_"

    # User
    workflow["1"]["inputs"]["value"] = username             # 98_USER

    # Randomise seeds so each run produces a different result.
    # ComfyUI uses the literal seed from the API payload; the "randomise"
    # setting in the UI has no effect on API submissions.
    workflow["46"]["inputs"]["noise_seed"] = _random_seed()   # RandomNoise (Flux 4K path)
    workflow["165"]["inputs"]["noise_seed"] = _random_seed()  # RandomNoise (Flux 8K path)
    workflow["72"]["inputs"]["seed"] = _random_seed()         # KSampler (SDXL 4K upscale)
    workflow["130"]["inputs"]["seed"] = _random_seed()        # KSampler (SDXL 8K upscale)

    return workflow


# Ref image node IDs in order (titles 12→18_INPUT_IMAGE_REF)
_OUTFIT_REF_NODES = ["11", "2", "3", "4", "5", "6", "7"]


def load_outfit_swapping(
    main_image: str,
    ref_images: list[str],
    prompt: str,
    client_path: str,
    product_path: str,
    filename_prefix: str,
    username: str = "",
) -> dict:
    """
    Patch Outfit_Swapping.json for a single run.

    ref_images: list of up to 7 filenames; only provided slots are patched.
    The remaining ref nodes keep whatever default filename is in the JSON.
    """
    workflow = copy.deepcopy(_load("Outfit_Swapping"))

    # Main subject image
    workflow["1"]["inputs"]["image"] = main_image

    # Reference images — patch only the slots the caller supplied
    for node_id, filename in zip(_OUTFIT_REF_NODES, ref_images):
        workflow[node_id]["inputs"]["image"] = filename

    # Prompt
    workflow["23"]["inputs"]["text"] = prompt

    # Output path nodes — concat chain 13/14/15/16 → nodes 27→28→29 → MetaSaver 26
    workflow["13"]["inputs"]["value"] = "ComfyUI"      # base path (always fixed)
    workflow["14"]["inputs"]["value"] = client_path    # 95_CLIENT_PATH
    workflow["15"]["inputs"]["value"] = product_path   # 96_PRODUCT_PATH
    workflow["16"]["inputs"]["value"] = filename_prefix  # 97_FILENAME
    workflow["20"]["inputs"]["value"] = username         # 98_USER

    return workflow


def load_image_edit(
    filename: str,
    prompt: str,
    client_path: str,
    product_path: str,
    filename_prefix: str,
    username: str = "",
) -> dict:
    """
    Patch image_edit_V1_API.json for a single run.

    image_edit_V1_API.json patch points:
      Node "11"  → inputs.image   : input image (LoadImage)
      Node "36"  → inputs.value   : prompt instruction (05_PROMPT_INSTRUCTION)
      Node "45"  → inputs.value   : client path  (95_CLIENT_PATH)
      Node "55"  → inputs.value   : product path (96_PRODUCT_PATH)
      Node "56"  → inputs.value   : filename prefix (97_FILENAME)
      Node "35"  → inputs.seed    : randomised Gemini seed
      Path chain: 40("ComfyUI")/45/55/56 → concat 57→58→59 → MetaSaver 37
    """
    workflow = copy.deepcopy(_load("image_edit_V1_API"))

    workflow["11"]["inputs"]["image"] = filename
    workflow["36"]["inputs"]["value"] = prompt
    workflow["45"]["inputs"]["value"] = client_path
    workflow["55"]["inputs"]["value"] = product_path
    workflow["56"]["inputs"]["value"] = filename_prefix
    workflow["46"]["inputs"]["value"] = username         # 98_USER
    workflow["35"]["inputs"]["seed"] = _random_seed()

    return workflow


def load_panorama(
    state_json: str,
    prompt: str = "Fill the green spaces according to the image. Outpaint as a seamless 360 equirectangular panorama (2:1). Keep the horizon level. Match left and right edges.",
    filename_prefix: str = "ComfyUI",
) -> dict:
    """
    Patch Panorama_Workflow_V3_API.json for a single run.
    state_json is produced directly by the frontend PanoramaStickers editor.

    Panorama_Workflow_V3_API.json patch points:
      Node "56"  → state_json       : PanoramaStickers — full editor state from frontend
      Node "6"   → text             : positive prompt
      Node "31"  → seed             : randomised KSampler seed
      Node "155" → filename_prefix  : SaveImage — final output name
    """
    workflow = copy.deepcopy(_load("Panorama_Workflow_V4_API"))

    workflow["56"]["inputs"]["state_json"] = state_json
    workflow["6"]["inputs"]["text"] = prompt
    workflow["31"]["inputs"]["seed"] = _random_seed()
    workflow["155"]["inputs"]["filename_prefix"] = filename_prefix

    return workflow
