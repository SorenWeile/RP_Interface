"""
Workflow loader dispatcher.
Delegates to individual workflow modules for better modularity.
"""

# Import all workflow loaders from individual modules
from .upscale import load_upscale
from .upscale_rework import load_upscale_rework
from .outfit_swapping import load_outfit_swapping
from .image_edit import load_image_edit
from .panorama import load_panorama

# Export all functions for backward compatibility
__all__ = [
    "load_upscale",
    "load_upscale_rework", 
    "load_outfit_swapping",
    "load_image_edit",
    "load_panorama",
]