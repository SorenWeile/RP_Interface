"""
Magnific upscaler workflow loader.
"""

import copy
from pathlib import Path
from typing import Dict

from ..base import _load_workflow

_VALID_SCALE_FACTORS = {"2x", "4x", "8x", "16x"}


def load_magnific_upscaler(
    filename: str,
    sharpen: int = 3,
    smart_grain: int = 3,
    ultra_detail: int = 30,
    scale_factor: str = "4x",
    client_path: str = "",
    product_path: str = "",
    filename_prefix: str = "",
    username: str = "",
) -> Dict:
    """Patch Magnific_Upscaler_V1_API.json for a single run.

    Magnific_Upscaler_V1_API.json patch points:
      Node "12" → inputs.image         : input image (11_INPUT_IMAGE)
      Node "17" → inputs.value         : sharpen (02_INPUT_SHARPEN, easy int)
      Node "18" → inputs.value         : smart grain (03_INPUT_SMART_GRAIN, easy int)
      Node "19" → inputs.value         : ultra detail (04_INPUT_ULTRA_DETAIL, easy int)
      Node "9"  → inputs.scale_factor  : scale factor (MagnificImageUpscalerPreciseV2Node)
      Node "2"  → inputs.value         : client path (95_CLIENT_PATH)
      Node "4"  → inputs.value         : product path (96_PRODUCT_PATH)
      Node "5"  → inputs.value         : filename prefix (97_FILENAME)
      Node "3"  → inputs.value         : username (98_USER)
      Path chain: 1("ComfyUI")/2/4/5 → concat 6→7→8 → MetaSaver 11

    Args:
        filename: The input image filename.
        sharpen: Sharpen intensity (02_INPUT_SHARPEN).
        smart_grain: Smart grain intensity (03_INPUT_SMART_GRAIN).
        ultra_detail: Ultra detail intensity (04_INPUT_ULTRA_DETAIL).
        scale_factor: Upscale factor — one of "2x", "4x", "8x", "16x".
        client_path: The client path (e.g., "Deployed/HD").
        product_path: The product path (e.g., "ProjectName").
        filename_prefix: The filename prefix (e.g., "Shot001").
        username: The username for tracking (optional).

    Returns:
        The patched workflow dictionary.
    """
    if scale_factor not in _VALID_SCALE_FACTORS:
        raise ValueError(f"scale_factor must be one of {_VALID_SCALE_FACTORS}, got {scale_factor!r}")

    workflow_dir = Path(__file__).parent
    workflow = copy.deepcopy(_load_workflow("Magnific_Upscaler_V1_API", workflow_dir))

    # Input image
    workflow["12"]["inputs"]["image"] = filename

    # Magnific parameters
    workflow["17"]["inputs"]["value"] = int(sharpen)
    workflow["18"]["inputs"]["value"] = int(smart_grain)
    workflow["19"]["inputs"]["value"] = int(ultra_detail)
    workflow["9"]["inputs"]["scale_factor"] = scale_factor

    # Output path nodes
    workflow["2"]["inputs"]["value"] = client_path      # 95_CLIENT_PATH
    workflow["4"]["inputs"]["value"] = product_path     # 96_PRODUCT_PATH
    workflow["5"]["inputs"]["value"] = filename_prefix  # 97_FILENAME
    workflow["3"]["inputs"]["value"] = username         # 98_USER

    return workflow
