"""
Video creation workflow loader (LTX IMG2Video).

Patch points (updated for INDGOutputPath node):
  Node "31"  → inputs.image   : first frame (11_INPUT_IMAGE_LATENT - First Frame)
  Node "39"  → inputs.image   : last frame  (12_INPUT_IMAGE_LATENT - Last Frame)
  Node "146" → inputs.value   : positive prompt (05_PROMPT_INSTRUCTION)
  Node "102" → inputs.value   : frame length (25–125)
  Node "173" → inputs.client/product/filename : INDGOutputPath
  Node "165" → inputs.value   : username (98_USER)
  Node "172" → inputs.seed    : randomised seed
  Node "100" → inputs.noise_seed : randomised noise seed
"""

import copy
from pathlib import Path
from typing import Dict

from ..base import _load_workflow, _random_seed

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
    length = max(MIN_LENGTH, min(MAX_LENGTH, int(length)))

    workflow_dir = Path(__file__).parent
    workflow = copy.deepcopy(_load_workflow("LTX_IMG2Video_v01_API", workflow_dir))

    workflow["31"]["inputs"]["image"] = first_frame
    workflow["39"]["inputs"]["image"] = last_frame

    workflow["146"]["inputs"]["value"] = prompt
    workflow["102"]["inputs"]["value"] = length

    workflow["173"]["inputs"]["client"]   = client_path
    workflow["173"]["inputs"]["product"]  = product_path
    workflow["173"]["inputs"]["filename"] = filename_prefix

    workflow["165"]["inputs"]["value"]     = username
    workflow["172"]["inputs"]["seed"]      = _random_seed()
    workflow["100"]["inputs"]["noise_seed"] = _random_seed()

    return workflow
