"""
Outfit swapping workflow loader.
"""

import copy
from pathlib import Path
from typing import Dict, List

from ..base import _load_workflow


# Ref image node IDs in order (titles 12→18_INPUT_IMAGE_REF)
_OUTFIT_REF_NODES: List[str] = ["11", "2", "3", "4", "5", "6", "7"]


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
    """Patch Outfit_Swapping_V1_API.json for a single run.
    
    ref_images: list of up to 7 filenames; only provided slots are patched.
    The remaining ref nodes keep whatever default filename is in the JSON.
    Prompt goes to node 30 (102_POSITIVE_PROMPT_INPUT).
    
    Args:
        main_image: The main subject image filename.
        ref_images: List of reference image filenames (up to 7).
        prompt: The positive prompt for the workflow.
        client_path: The client path (e.g., "Deployed/HD").
        product_path: The product path (e.g., "ProjectName").
        filename_prefix: The filename prefix (e.g., "Shot001").
        positive_prompt: Additional positive prompt (optional).
        username: The username for tracking (optional).
        
    Returns:
        The patched workflow dictionary.
    """
    workflow_dir = Path(__file__).parent
    workflow = copy.deepcopy(_load_workflow("Outfit_Swapping_V1_API", workflow_dir))

    # Main subject image
    workflow["1"]["inputs"]["image"] = main_image

    # Reference images — patch only slots the caller supplied; track which node IDs
    # are actually populated so we can rebuild the BatchImagesNode accurately.
    populated_ref_nodes: List[str] = []
    for node_id, filename in zip(_OUTFIT_REF_NODES, ref_images):
        if filename:
            workflow[node_id]["inputs"]["image"] = filename
            populated_ref_nodes.append(node_id)

    # Rebuild BatchImagesNode (10) from scratch — only include images we actually have.
    # The JSON default wires all 8 slots to placeholder filenames; any unpopulated slot
    # would cause ComfyUI to error with "Invalid image file".
    batch_inputs = workflow["10"]["inputs"]
    for key in list(batch_inputs.keys()):
        if key.startswith("images.image"):
            del batch_inputs[key]
    batch_inputs["images.image0"] = ["1", 0]          # main image always first
    for i, node_id in enumerate(populated_ref_nodes, start=1):
        batch_inputs[f"images.image{i}"] = [node_id, 0]

    # Prompt → node 30 (102_POSITIVE_PROMPT_INPUT)
    workflow["30"]["inputs"]["value"] = prompt

    # Output path nodes — concat chain 13/14/15/16 → nodes 27→28→29 → MetaSaver 26
    workflow["13"]["inputs"]["value"] = "ComfyUI"      # base path (always fixed)
    workflow["14"]["inputs"]["value"] = client_path    # 95_CLIENT_PATH
    workflow["15"]["inputs"]["value"] = product_path   # 96_PRODUCT_PATH
    workflow["16"]["inputs"]["value"] = filename_prefix  # 97_FILENAME
    workflow["20"]["inputs"]["value"] = username         # 98_USER

    return workflow