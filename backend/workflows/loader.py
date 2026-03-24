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
