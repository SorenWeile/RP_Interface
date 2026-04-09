"""
Panorama outpainting workflow loader.
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
    """Patch Panorama_Workflow_V5_API.json for a single run.
    
    state_json is produced directly by the frontend PanoramaStickers editor.
    
    Panorama_Workflow_V5_API.json patch points:
      Node "56"  → state_json  : PanoramaStickers — full editor state from frontend
      Node "6"   → text        : positive prompt (panorama outpaint pass)
      Node "31"  → seed        : randomised KSampler seed
      Node "83"  → noise_seed  : randomised RandomNoise (img2img pass)
      Node "147" → noise_seed  : randomised RandomNoise (detail pass)
      Node "160" → value       : 95_CLIENT_PATH
      Node "162" → value       : 96_PRODUCT_PATH
      Node "163" → value       : 97_FILENAME
      Node "167" → value       : "Pano" subfolder (fixed in JSON, do NOT patch)
      Node "998" → value       : 98_USER (injected PrimitiveStringMultiline)
      Node "166" → meta_value_5: ["998", 0] — wired to user node
      Path chain: 158("ComfyUI")/160/162/167("Pano")/163 → concat 159→164→168→165 → MetaSaver 166
    
    Args:
        state_json: The PanoramaStickers editor state from the frontend.
        prompt: The positive prompt for the panorama outpaint pass.
        client_path: The client path (e.g., "HD").
        product_path: The product path (e.g., "Panorama").
        filename_prefix: The filename prefix (e.g., "Shot001").
        username: The username for tracking (optional).
        
    Returns:
        The patched workflow dictionary.
    """
    workflow_dir = Path(__file__).parent
    workflow = copy.deepcopy(_load_workflow("Panorama_Workflow_V5_API", workflow_dir))

    workflow["56"]["inputs"]["state_json"] = state_json
    workflow["6"]["inputs"]["text"] = prompt

    # Randomise all sampler seeds
    workflow["31"]["inputs"]["seed"] = _random_seed()
    workflow["83"]["inputs"]["noise_seed"] = _random_seed()
    workflow["147"]["inputs"]["noise_seed"] = _random_seed()

    # Output path nodes
    workflow["160"]["inputs"]["value"] = client_path
    workflow["162"]["inputs"]["value"] = product_path
    workflow["163"]["inputs"]["value"] = filename_prefix

    # Inject a PrimitiveStringMultiline node for the username and wire it to MetaSaver.
    # Use a high ID ("998") that will never clash with nodes in the workflow JSON.
    workflow["998"] = {
        "inputs": {"value": username},
        "class_type": "PrimitiveStringMultiline",
        "_meta": {"title": "98_USER"},
    }
    workflow["166"]["inputs"]["meta_value_5"] = ["998", 0]

    return workflow