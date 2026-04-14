"""
Image prompting workflow loader.
"""

import copy
from pathlib import Path
from typing import Dict, List

from ..base import _load_workflow, _random_seed


# Reference image node IDs in order (titles 11→14_INPUT_IMAGE_LATENT)
_IMAGE_PROMPTING_REF_NODES: List[str] = ["667", "670", "671", "672"]


def load_image_prompting(
    ref_images: List[str],
    prompt: str,
    client_path: str,
    product_path: str,
    filename_prefix: str,
    username: str = "",
) -> Dict:
    """Patch Image_Prompting_V1_API.json for a single run.

    Image_Prompting_V1_API.json patch points:
      Node "667" → inputs.image   : reference image 1 (11_INPUT_IMAGE_LATENT)
      Node "670" → inputs.image   : reference image 2 (12_INPUT_IMAGE_LATENT)
      Node "671" → inputs.image   : reference image 3 (13_INPUT_IMAGE_LATENT)
      Node "672" → inputs.image   : reference image 4 (14_INPUT_IMAGE_LATENT)
      Node "669" → inputs         : BatchImagesNode collecting all ref images
      Node "666" → inputs.value   : prompt instruction (05_PROMPT_INSTRUCTION)
      Node "656" → inputs.value   : client path (95_CLIENT_PATH)
      Node "657" → inputs.value   : product path (96_PRODUCT_PATH)
      Node "655" → inputs.value   : filename prefix (97_FILENAME)
      Node "658" → inputs.value   : username (98_USER)
      Node "31"  → inputs.seed    : randomised Gemini seed
      Path chain: 660("ComfyUI")/656/657/655 → concat 673→674→675 → MetaSaver 648

    Args:
        ref_images: List of reference image filenames (up to 4).
        prompt: The prompt instruction for the workflow.
        client_path: The client path (e.g., "Deployed/HD").
        product_path: The product path (e.g., "ProjectName").
        filename_prefix: The filename prefix (e.g., "Shot001").
        username: The username for tracking (optional).

    Returns:
        The patched workflow dictionary.
    """
    workflow_dir = Path(__file__).parent
    workflow = copy.deepcopy(_load_workflow("Image_Prompting_V1_API", workflow_dir))

    # Rebuild BatchImagesNode (669) — only include images actually provided
    batch_inputs = workflow["669"]["inputs"]
    for key in list(batch_inputs.keys()):
        if key.startswith("images.image"):
            del batch_inputs[key]

    slot = 0
    for node_id, filename in zip(_IMAGE_PROMPTING_REF_NODES, ref_images):
        if filename:
            workflow[node_id]["inputs"]["image"] = filename
            batch_inputs[f"images.image{slot}"] = [node_id, 0]
            slot += 1

    # Prompt
    workflow["666"]["inputs"]["value"] = prompt

    # Output path nodes
    workflow["656"]["inputs"]["value"] = client_path      # 95_CLIENT_PATH
    workflow["657"]["inputs"]["value"] = product_path     # 96_PRODUCT_PATH
    workflow["655"]["inputs"]["value"] = filename_prefix  # 97_FILENAME
    workflow["658"]["inputs"]["value"] = username         # 98_USER

    # Randomise seed on the Gemini node
    workflow["31"]["inputs"]["seed"] = _random_seed()

    return workflow
