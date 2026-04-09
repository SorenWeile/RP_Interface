"""
Simple upscale workflow loader.
"""

import copy
from pathlib import Path
from typing import Dict

from ..base import _load_workflow


def load_upscale(filename: str) -> Dict:
    """Load and patch the upscale workflow with the given filename.
    
    Args:
        filename: The input image filename.
        
    Returns:
        The patched workflow dictionary.
    """
    workflow_dir = Path(__file__).parent
    workflow = copy.deepcopy(_load_workflow("upscale", workflow_dir))
    workflow["2"]["inputs"]["image"] = filename
    return workflow