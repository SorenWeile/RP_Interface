"""
Panorama outpainting workflow loader.

Patch points (updated for INDGOutputPath node, username node removed):
  Node "56"  → inputs.state_json   : PanoramaStickers editor state
  Node "6"   → inputs.text         : positive prompt
  Node "31"  → inputs.seed         : randomised KSampler seed
  Node "83"  → inputs.noise_seed   : randomised RandomNoise (img2img pass, if present)
  Node "147" → inputs.noise_seed   : randomised RandomNoise (detail pass, if present)
  Node "170" → inputs.client/product/filename : INDGOutputPath
"""

import copy
from pathlib import Path
from typing import Dict

from ..base import _load_workflow, _random_seed


def load_panorama(
    state_json: str,
    prompt: str = "Fill the green spaces according to the image. Outpaint as a seamless 360 equirectangular panorama (2:1). Keep the horizon level. Match left and right edges.",
    client_path: str = "HD",
    product_path: str = "Panorama",
    filename_prefix: str = "Shot001",
    username: str = "",
) -> Dict:
    workflow_dir = Path(__file__).parent
    workflow = copy.deepcopy(_load_workflow("Panorama_Workflow_V5_API", workflow_dir))

    workflow["56"]["inputs"]["state_json"] = state_json
    workflow["6"]["inputs"]["text"] = prompt

    workflow["31"]["inputs"]["seed"] = _random_seed()
    # Nodes 83 and 147 are optional (may vary between workflow versions)
    if "83" in workflow:
        workflow["83"]["inputs"]["noise_seed"] = _random_seed()
    if "147" in workflow:
        workflow["147"]["inputs"]["noise_seed"] = _random_seed()

    workflow["170"]["inputs"]["client"]   = client_path
    workflow["170"]["inputs"]["product"]  = product_path
    workflow["170"]["inputs"]["filename"] = filename_prefix

    return workflow
