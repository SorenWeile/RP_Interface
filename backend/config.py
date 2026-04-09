"""
Configuration file for the ComfyUI Workflow UI.
Centralizes hardcoded values and settings for better maintainability.
"""

# Upscale rework models
UPSCALE_REWORK_MODELS = [
    "4xUltrasharp_4xUltrasharpV10.pt",
    "4xLexicaDAT2_otf.pth",
    "4xRealWebPhoto_v4.pth",
    "4xPurePhoto-RealPLSKR.pth",
    "4xRealWebPhoto_v3_atd.pth",
    "4xNomos8kSCHAT-L.pth",
]

# Default values for workflows
DEFAULT_PANORAMA_PROMPT = (
    "Fill the green spaces according to the image. "
    "Outpaint as a seamless 360 equirectangular panorama (2:1). "
    "Keep the horizon level. Match left and right edges."
)

DEFAULT_CLIENT_PATH = "HD"
DEFAULT_PRODUCT_PATH = "Panorama"
DEFAULT_FILENAME_PREFIX = "Shot001"

# Batch processing limits
MIN_RUNS_PER_MODEL = 1
MAX_RUNS_PER_MODEL = 10
MIN_BATCH_COUNT = 1
MAX_BATCH_COUNT = 10

# ComfyUI settings
COMFYUI_HOST = "127.0.0.1:3001"
COMFYUI_TIMEOUT = 3.0

# File extensions
ALLOWED_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg"}