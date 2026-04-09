"""
Upscale rework (batch) workflow loader.
"""

import copy
from typing import Dict

from .base import _load_workflow, _random_seed


def load_upscale_rework(
    filename: str,
    model_name: str,
    run_index: int,
    client_path: str,
    product_path: str,
    filename_prefix: str,
    username: str = "",
) -> Dict:
    """Patch Upscaler_Rework_API.json for a single batch run.
    
    The model shortname and run index are automatically appended to the filename
    prefix so every output is uniquely identifiable in the ComfyUI output folder.
    
    Args:
        filename: The input image filename.
        model_name: The upscale model name.
        run_index: The run index for batch processing.
        client_path: The client path (e.g., "Deployed/HD").
        product_path: The product path (e.g., "ProjectName").
        filename_prefix: The filename prefix (e.g., "Shot001").
        username: The username for tracking.
        
    Returns:
        The patched workflow dictionary.
    """
    workflow = copy.deepcopy(_load_workflow("Upscaler_Batch_V2_API"))

    # Image input
    workflow["18"]["inputs"]["image"] = filename

    # Upscale model — node 167 feeds both the 4K (62) and 8K (128) branches
    workflow["167"]["inputs"]["model_name"] = model_name

    # Output path nodes
    workflow["173"]["inputs"]["value"] = client_path   # client path (concat node 172 feeds 174→175/176→177/178)
    workflow["15"]["inputs"]["value"] = product_path   # 96_PRODUCT_PATH

    # Build a unique filename prefix: "<user_prefix>_<model_short>_r<NN>_"
    # Strip extension and truncate so paths stay reasonable
    model_short = model_name.rsplit(".", 1)[0][:24]
    workflow["16"]["inputs"]["value"] = f"{filename_prefix}_{model_short}_r{run_index:02d}_"

    # User
    workflow["1"]["inputs"]["value"] = username             # 98_USER

    # Randomise seeds so each run produces a different result.
    # ComfyUI uses the literal seed from the API payload; the "randomise"
    # setting in the UI has no effect on API submissions.
    workflow["46"]["inputs"]["noise_seed"] = _random_seed()   # RandomNoise (Flux 4K path)
    workflow["165"]["inputs"]["noise_seed"] = _random_seed()  # RandomNoise (Flux 8K path)
    workflow["72"]["inputs"]["seed"] = _random_seed()         # KSampler (SDXL 4K upscale)
    workflow["130"]["inputs"]["seed"] = _random_seed()        # KSampler (SDXL 8K upscale)

    return workflow