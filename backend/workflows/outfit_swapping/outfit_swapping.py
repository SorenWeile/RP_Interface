"""
Outfit swapping workflow loader.

Patch points (updated for INDGOutputPath + INDGFlexibleImageBatch):
  Node "1"      → inputs.image       : main subject image (11_INPUT_IMAGE_LATENT)
  Nodes "2"–"7" → inputs.image       : reference images (up to 6)
  Node "31"     → inputs.image_1..7  : INDGFlexibleImageBatch (wired dynamically)
  Node "30"     → inputs.value       : prompt (102_POSITIVE_PROMPT_INPUT)
  Node "32"     → inputs.client/product/filename : INDGOutputPath
  Node "20"     → inputs.value       : username (98_USER)
  Node "22"     → inputs.seed        : randomised seed
"""

import copy
from pathlib import Path
from typing import Dict, List

from ..base import _load_workflow, _random_seed

# Reference image node IDs — up to 6 refs (nodes 2–7)
_OUTFIT_REF_NODES: List[str] = ["2", "3", "4", "5", "6", "7"]


def load_outfit_swapping(
    main_image: str,
    ref_images: List[str],
    prompt: str,
    client_path: str,
    product_path: str,
    filename_prefix: str,
    positive_prompt: str = "",
    username: str = "",
) -> Dict:
    workflow_dir = Path(__file__).parent
    workflow = copy.deepcopy(_load_workflow("Outfit_Swapping_V1_API", workflow_dir))

    workflow["1"]["inputs"]["image"] = main_image

    # Manage INDGFlexibleImageBatch slots: image_1 is always wired to main (node "1").
    # Remove all optional slots (image_2+), then re-add only those with a provided image.
    batch_inputs = workflow["31"]["inputs"]
    for key in list(batch_inputs.keys()):
        if key.startswith("image_") and key != "image_1":
            del batch_inputs[key]

    for i, (node_id, ref_filename) in enumerate(zip(_OUTFIT_REF_NODES, ref_images), start=2):
        if ref_filename:
            workflow[node_id]["inputs"]["image"] = ref_filename
            batch_inputs[f"image_{i}"] = [node_id, 0]

    workflow["30"]["inputs"]["value"] = prompt

    workflow["32"]["inputs"]["client"]   = client_path
    workflow["32"]["inputs"]["product"]  = product_path
    workflow["32"]["inputs"]["filename"] = filename_prefix

    workflow["20"]["inputs"]["value"] = username
    workflow["22"]["inputs"]["seed"]  = _random_seed()

    return workflow
