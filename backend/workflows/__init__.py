"""
Workflow loaders package.
Exports all workflow loading functions for easy importing.
"""

from .upscale_rework.upscale_rework import load_upscale_rework
from .outfit_swapping.outfit_swapping import load_outfit_swapping
from .image_edit.image_edit import load_image_edit
from .panorama.panorama import load_panorama
from .image_prompting.image_prompting import load_image_prompting
from .magnific_upscaler.magnific_upscaler import load_magnific_upscaler
from .video_creation.video_creation import load_video_creation

__all__ = [
    "load_upscale_rework",
    "load_outfit_swapping",
    "load_image_edit",
    "load_panorama",
    "load_image_prompting",
    "load_magnific_upscaler",
    "load_video_creation",
]