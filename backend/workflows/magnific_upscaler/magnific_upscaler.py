"""
Magnific upscaler workflow loader.

Patch points (updated for INDGOutputPath node):
  Node "12" → inputs.image         : input image (11_INPUT_IMAGE)
  Node "17" → inputs.value         : sharpen (02_INPUT_SHARPEN)
  Node "18" → inputs.value         : smart grain (03_INPUT_SMART_GRAIN)
  Node "19" → inputs.value         : ultra detail (04_INPUT_ULTRA_DETAIL)
  Node "9"  → inputs.scale_factor  : scale factor
  Node "20" → inputs.client/product/filename : INDGOutputPath (replaces nodes 2/4/5 + concat chain)
  Node "3"  → inputs.value         : username (98_USER)
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
    if scale_factor not in _VALID_SCALE_FACTORS:
        raise ValueError(f"scale_factor must be one of {_VALID_SCALE_FACTORS}, got {scale_factor!r}")

    workflow_dir = Path(__file__).parent
    workflow = copy.deepcopy(_load_workflow("Magnific_Upscaler_V1_API", workflow_dir))

    workflow["12"]["inputs"]["image"] = filename

    workflow["17"]["inputs"]["value"] = int(sharpen)
    workflow["18"]["inputs"]["value"] = int(smart_grain)
    workflow["19"]["inputs"]["value"] = int(ultra_detail)
    workflow["9"]["inputs"]["scale_factor"] = scale_factor

    workflow["20"]["inputs"]["client"]   = client_path
    workflow["20"]["inputs"]["product"]  = product_path
    workflow["20"]["inputs"]["filename"] = filename_prefix

    workflow["3"]["inputs"]["value"] = username

    return workflow
