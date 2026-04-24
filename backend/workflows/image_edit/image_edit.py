"""
Image edit workflow loader.

Patch points (updated for INDGOutputPath + INDGFlexibleImageBatch):
  Node "11"     → inputs.image      : input image (11_INPUT_IMAGE_LATENT)
  Nodes "61"–"68" → inputs.image    : reference images 1–4 (LoadImage nodes)
  Node "69"     → inputs.image_1..5 : INDGFlexibleImageBatch (wired dynamically)
  Node "36"     → inputs.value      : prompt instruction (05_PROMPT_INSTRUCTION)
  Node "70"     → inputs.client/product/filename : INDGOutputPath
  Node "46"     → inputs.value      : username (98_USER)
  Node "35"     → inputs.seed       : randomised Gemini seed
"""

import copy
from pathlib import Path
from typing import Dict, List

from ..base import _load_workflow, _random_seed

# Reference image node IDs in slot order (image_2 through image_5 in the batch node)
_IMAGE_EDIT_REF_NODES: List[str] = ["61", "62", "63", "68"]


def load_image_edit(
    filename: str,
    prompt: str,
    ref_images: List[str],
    client_path: str,
    product_path: str,
    filename_prefix: str,
    username: str = "",
) -> Dict:
    workflow_dir = Path(__file__).parent
    workflow = copy.deepcopy(_load_workflow("image_edit_V3_API", workflow_dir))

    workflow["11"]["inputs"]["image"] = filename

    # Manage INDGFlexibleImageBatch slots: image_1 is always wired to main (node "11").
    # Remove all optional slots (image_2+), then re-add only those with a provided image.
    batch_inputs = workflow["69"]["inputs"]
    for key in list(batch_inputs.keys()):
        if key.startswith("image_") and key != "image_1":
            del batch_inputs[key]

    for i, (node_id, ref_filename) in enumerate(zip(_IMAGE_EDIT_REF_NODES, ref_images), start=2):
        if ref_filename:
            workflow[node_id]["inputs"]["image"] = ref_filename
            batch_inputs[f"image_{i}"] = [node_id, 0]

    workflow["36"]["inputs"]["value"] = prompt

    workflow["70"]["inputs"]["client"]   = client_path
    workflow["70"]["inputs"]["product"]  = product_path
    workflow["70"]["inputs"]["filename"] = filename_prefix

    workflow["46"]["inputs"]["value"] = username
    workflow["35"]["inputs"]["seed"]  = _random_seed()

    return workflow
