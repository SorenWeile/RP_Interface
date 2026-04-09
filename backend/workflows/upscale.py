"""
Simple upscale workflow loader.
"""

import copy
from typing import Dict

from .base import _load_workflow


def load_upscale(filename: str) -> Dict:
    """Load and patch the upscale workflow with the given filename.
    
    Args:
        filename: The input image filename.
        
    Returns:
        The patched workflow dictionary.
    """
    workflow = copy.deepcopy(_load_workflow("upscale"))
    workflow["2"]["inputs"]["image"] = filename
    return workflow