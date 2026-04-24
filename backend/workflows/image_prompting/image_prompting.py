"""
Image prompting workflow loader.

Patch points (updated for INDGOutputPath + INDGFlexibleImageBatch):
  Nodes "667","670","671","672" → inputs.image : reference images 1–4 (LoadImage nodes)
  Node "677" → inputs.image_1..4 : INDGFlexibleImageBatch (wired dynamically)
  Node "666" → inputs.value      : prompt instruction (05_PROMPT_INSTRUCTION)
  Node "676" → inputs.client/product/filename : INDGOutputPath
  Node "658" → inputs.value      : username (98_USER)
  Node "31"  → inputs.seed       : randomised Gemini seed
"""

import copy
from pathlib import Path
from typing import Dict, List

from ..base import _load_workflow, _random_seed

# Reference image node IDs in slot order (image_1 through image_4 in the batch node)
_IMAGE_PROMPTING_REF_NODES: List[str] = ["667", "670", "671", "672"]


def load_image_prompting(
    ref_images: List[str],
    prompt: str,
    client_path: str,
    product_path: str,
    filename_prefix: str,
    username: str = "",
) -> Dict:
    workflow_dir = Path(__file__).parent
    workflow = copy.deepcopy(_load_workflow("Image_Prompting_V1_API", workflow_dir))

    # Manage INDGFlexibleImageBatch slots: image_1 is always required.
    # Remove optional slots (image_2+), then re-add only those with a provided image.
    # image_1 stays wired to node "667" (the first ref image, always required).
    batch_inputs = workflow["677"]["inputs"]
    for key in list(batch_inputs.keys()):
        if key.startswith("image_") and key != "image_1":
            del batch_inputs[key]

    for i, (node_id, filename) in enumerate(zip(_IMAGE_PROMPTING_REF_NODES, ref_images), start=1):
        # slot i=1 → image_1 (required, always wired); slots 2-4 → optional
        if filename:
            workflow[node_id]["inputs"]["image"] = filename
            if i > 1:
                batch_inputs[f"image_{i}"] = [node_id, 0]

    workflow["666"]["inputs"]["value"] = prompt

    workflow["676"]["inputs"]["client"]   = client_path
    workflow["676"]["inputs"]["product"]  = product_path
    workflow["676"]["inputs"]["filename"] = filename_prefix

    workflow["658"]["inputs"]["value"] = username
    workflow["31"]["inputs"]["seed"]   = _random_seed()

    return workflow
