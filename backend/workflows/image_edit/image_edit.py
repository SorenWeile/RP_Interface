"""
Image edit workflow loader.
"""

import copy
from pathlib import Path
from typing import Dict, List

from ..base import _load_workflow, _random_seed


# Image edit reference image node IDs (actual IDs in the JSON file)
_IMAGE_EDIT_REF_NODES: List[str] = ["61", "62", "63", "68"]  # 12_INPUT_IMAGE_REFERENCE_01 → 15_INPUT_IMAGE_REFERENCE_04


def load_image_edit(
    filename: str,
    prompt: str,
    ref_images: List[str],
    client_path: str,
    product_path: str,
    filename_prefix: str,
    username: str = "",
) -> Dict:
    """Patch image_edit_V3_API.json for a single run.
    
    image_edit_V3_API.json patch points:
      Node "11"  → inputs.image   : input image (LoadImage)
      Node "36"  → inputs.value   : prompt instruction (05_PROMPT_INSTRUCTION)
      Node "61"  → inputs.image   : reference image 1 (12_INPUT_IMAGE_REFERENCE_01)
      Node "62"  → inputs.image   : reference image 2 (13_INPUT_IMAGE_REFERENCE_02)
      Node "63"  → inputs.image   : reference image 3 (14_INPUT_IMAGE_REFERENCE_03)
      Node "68"  → inputs.image   : reference image 4 (15_INPUT_IMAGE_REFERENCE_04)
      Node "66"  → inputs        : BatchImagesNode that collects main + reference images
      Node "45"  → inputs.value   : client path  (95_CLIENT_PATH)
      Node "55"  → inputs.value   : product path (96_PRODUCT_PATH)
      Node "56"  → inputs.value   : filename prefix (97_FILENAME)
      Node "46"  → inputs.value   : username (98_USER)
      Node "35"  → inputs.seed    : randomised Gemini seed
      Path chain: 40("ComfyUI")/45/55/56 → concat 57→58→59 → MetaSaver 37
    
    Args:
        filename: The input image filename.
        prompt: The prompt instruction for the workflow.
        ref_images: List of reference image filenames (up to 4).
        client_path: The client path (e.g., "Deployed/HD").
        product_path: The product path (e.g., "ProjectName").
        filename_prefix: The filename prefix (e.g., "Shot001").
        username: The username for tracking (optional).
        
    Returns:
        The patched workflow dictionary.
    """
    workflow_dir = Path(__file__).parent
    workflow = copy.deepcopy(_load_workflow("image_edit_V3_API", workflow_dir))

    # Main image
    workflow["11"]["inputs"]["image"] = filename
    
    # Reference images — add to BatchImagesNode only if provided
    # The BatchImagesNode (66) should only include images that actually exist
    batch_images_inputs = workflow["66"]["inputs"]
    
    # Build the images list dynamically based on what's provided
    images_list: List = []
    if filename:
        images_list.append(["11", 0])  # Main image always first
    
    # Add reference images only if they exist
    ref_node_mapping = ["61", "62", "63", "68"]  # Reference image nodes
    for i, ref_filename in enumerate(ref_images):
        if ref_filename:
            # Only add reference images that were actually provided
            ref_node_id = ref_node_mapping[i]
            workflow[ref_node_id]["inputs"]["image"] = ref_filename
            images_list.append([ref_node_id, 0])
    
    # Update the BatchImagesNode with only the images we have
    # The node expects a specific structure, so we need to update it carefully
    for key in list(batch_images_inputs.keys()):
        if key.startswith("images.image"):
            # Remove existing image references
            del batch_images_inputs[key]
    
    # Add back only the images we actually have
    for i, image_ref in enumerate(images_list):
        batch_images_inputs[f"images.image{i}"] = image_ref
    
    # Prompt and paths
    workflow["36"]["inputs"]["value"] = prompt
    workflow["45"]["inputs"]["value"] = client_path
    workflow["55"]["inputs"]["value"] = product_path
    workflow["56"]["inputs"]["value"] = filename_prefix
    workflow["46"]["inputs"]["value"] = username         # 98_USER
    workflow["35"]["inputs"]["seed"] = _random_seed()

    return workflow