"""
Workflow loader and patcher.
Each workflow has a load_* function that reads the JSON and patches runtime values.

upscale.json patch points:
  Node "2"  → inputs.image : input image filename

Upscaler_Rework_API.json patch points:
  Node "18"  → inputs.image        : input image filename
  Node "167" → inputs.model_name   : upscale model (feeds both 4K and 8K branches)
  Node "14"  → inputs.value        : 95_CLIENT_PATH  (e.g. "Deployed/HD")
  Node "15"  → inputs.value        : 96_PRODUCT_PATH (e.g. "ProjectName")
  Node "16"  → inputs.value        : 97_FILENAME prefix
                                      (model shortname + run index baked in automatically)

Outfit_Swapping.json patch points:
  Node "1"  → inputs.image   : 11_INPUT_IMAGE_LATENT (main subject image)
  Node "11" → inputs.image   : 12_INPUT_IMAGE_REF    (ref image 1)
  Node "2"  → inputs.image   : 13_INPUT_IMAGE_REF    (ref image 2)
  Node "3"  → inputs.image   : 14_INPUT_IMAGE_REF    (ref image 3)
  Node "4"  → inputs.image   : 15_INPUT_IMAGE_REF    (ref image 4)
  Node "5"  → inputs.image   : 16_INPUT_IMAGE_REF    (ref image 5)
  Node "6"  → inputs.image   : 17_INPUT_IMAGE_REF    (ref image 6)
  Node "7"  → inputs.image   : 18_INPUT_IMAGE_REF    (ref image 7)
  Node "23" → inputs.text    : 05_PROMPT_POSITIVE_INSTRUCTION
  Node "13" → inputs.value   : DEFAULT_PATH (reset to "ComfyUI" — JSON has "ComfyUI/Deployed/Rider" hardcoded)
  Node "14" → inputs.value   : 95_CLIENT_PATH
  Node "15" → inputs.value   : 96_PRODUCT_PATH
  Node "16" → inputs.value   : 97_FILENAME prefix
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
) -> dict:
    """
    Patch Upscaler_Rework_API.json for a single batch run.
    The model shortname and run index are automatically appended to the filename
    prefix so every output is uniquely identifiable in the ComfyUI output folder.
    """
    workflow = copy.deepcopy(_load("Upscaler_Rework_API"))

    # Image input
    workflow["18"]["inputs"]["image"] = filename

    # Upscale model — node 167 feeds both the 4K (62) and 8K (128) branches
    workflow["167"]["inputs"]["model_name"] = model_name

    # Output path nodes
    workflow["14"]["inputs"]["value"] = client_path    # 95_CLIENT_PATH
    workflow["15"]["inputs"]["value"] = product_path   # 96_PRODUCT_PATH

    # Build a unique filename prefix: "<user_prefix>_<model_short>_r<NN>_"
    # Strip extension and truncate so paths stay reasonable
    model_short = model_name.rsplit(".", 1)[0][:24]
    workflow["16"]["inputs"]["value"] = f"{filename_prefix}_{model_short}_r{run_index:02d}_"

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

    # Output path nodes — match Batch Upscaler convention:
    # DEFAULT_PATH = "ComfyUI", then client_path/product_path/filename are appended.
    # The workflow JSON has "ComfyUI/Deployed/Rider" hardcoded in node "13"; we
    # reset it to just "ComfyUI" so the final path is ComfyUI/{client}/{product}/{file}.
    workflow["13"]["inputs"]["value"] = "ComfyUI"      # DEFAULT_PATH (reset hardcoded prefix)
    workflow["14"]["inputs"]["value"] = client_path    # 95_CLIENT_PATH
    workflow["15"]["inputs"]["value"] = product_path   # 96_PRODUCT_PATH
    workflow["16"]["inputs"]["value"] = filename_prefix  # 97_FILENAME

    return workflow


def load_panorama(
    state_json: str,
    prompt: str = "Fill the green spaces according to the image. Outpaint as a seamless 360 equirectangular panorama (2:1). Keep the horizon level. Match left and right edges.",
    filename_prefix: str = "ComfyUI",
) -> dict:
    """
    Patch Panorama_Workflow_API.json for a single run.
    state_json is produced directly by the frontend PanoramaStickers editor.

    Panorama_Workflow_API.json patch points:
      Node "56" → state_json  : PanoramaStickers — full editor state from frontend
      Node "6"  → text        : positive prompt
      Node "31" → seed        : randomised KSampler seed
      Node "66" → filename_prefix : SaveImage output name
    """
    workflow = copy.deepcopy(_load("Panorama_Workflow_API"))

    workflow["56"]["inputs"]["state_json"] = state_json
    workflow["6"]["inputs"]["text"] = prompt
    workflow["31"]["inputs"]["seed"] = _random_seed()
    workflow["66"]["inputs"]["filename_prefix"] = filename_prefix

    return workflow
