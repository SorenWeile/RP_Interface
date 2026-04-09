"""
Workflow loaders package.
Exports all workflow loading functions for easy importing.
"""

from .upscale.upscale import load_upscale
from .upscale_rework.upscale_rework import load_upscale_rework
from .outfit_swapping.outfit_swapping import load_outfit_swapping
from .image_edit.image_edit import load_image_edit
from .panorama.panorama import load_panorama

__all__ = [
    "load_upscale",
    "load_upscale_rework",
    "load_outfit_swapping",
    "load_image_edit",
    "load_panorama",
]