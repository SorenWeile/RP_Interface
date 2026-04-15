"""
Video creation workflow loader (LTX IMG2Video).
"""

import copy
from pathlib import Path
from typing import Dict

from ..base import _load_workflow, _random_seed

# Frame rate is fixed at 25 fps in the workflow (node 114)
FRAME_RATE = 25
MIN_LENGTH = 25
MAX_LENGTH = 125


def load_video_creation(
    first_frame: str,
    last_frame: str,
    prompt: str,
    length: int = 121,
    client_path: str = "",
    product_path: str = "",
    filename_prefix: str = "",
    username: str = "",
) -> Dict:
    """Patch LTX_IMG2Video_v01_API.json for a single run.

    LTX_IMG2Video_v01_API.json patch points:
      Node "31"  → inputs.image   : first frame (11_INPUT_IMAGE_LATENT - First Frame)
      Node "39"  → inputs.image   : last frame  (12_INPUT_IMAGE_LATENT - Last Frame)
      Node "146" → inputs.value   : positive prompt (05_PROMPT_INSTRUCTION)
      Node "102" → inputs.value   : frame length (Length, 25–125)
      Node "163" → inputs.value   : client path (95_CLIENT_PATH)
      Node "164" → inputs.value   : product path (96_PRODUCT_PATH)
      Node "162" → inputs.value   : filename prefix (97_FILENAME)
      Node "165" → inputs.value   : username (98_USER)
      Node "172" → inputs.seed    : randomised seed (Seed)
      Path chain: 166("ComfyUI")/163/164/162 → concat 167→168→169 → MetaVideoSaver 171

    Args:
        first_frame: Filename of the first-frame image.
        last_frame: Filename of the last-frame image.
        prompt: Positive prompt instruction.
        length: Number of frames to generate (25–125). Seconds = length / 25 fps.
        client_path: The client path (e.g., "Deployed/HD").
        product_path: The product path (e.g., "ProjectName").
        filename_prefix: The filename prefix (e.g., "Video001").
        username: The username for tracking (optional).

    Returns:
        The patched workflow dictionary.
    """
    length = max(MIN_LENGTH, min(MAX_LENGTH, int(length)))

    workflow_dir = Path(__file__).parent
    workflow = copy.deepcopy(_load_workflow("LTX_IMG2Video_v01_API", workflow_dir))

    # Frame images
    workflow["31"]["inputs"]["image"] = first_frame
    workflow["39"]["inputs"]["image"] = last_frame

    # Prompt
    workflow["146"]["inputs"]["value"] = prompt

    # Length (frames)
    workflow["102"]["inputs"]["value"] = length

    # Output path nodes
    workflow["163"]["inputs"]["value"] = client_path      # 95_CLIENT_PATH
    workflow["164"]["inputs"]["value"] = product_path     # 96_PRODUCT_PATH
    workflow["162"]["inputs"]["value"] = filename_prefix  # 97_FILENAME
    workflow["165"]["inputs"]["value"] = username         # 98_USER

    # Randomise seed
    workflow["172"]["inputs"]["seed"] = _random_seed()

    return workflow
