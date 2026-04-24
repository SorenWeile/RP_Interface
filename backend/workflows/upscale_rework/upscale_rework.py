"""
Upscale rework (batch) workflow loader.

Patch points (updated for INDGOutputPath nodes):
  Node "18"  → inputs.image        : input image (11_INPUT_IMAGE_LATENT)
  Node "167" → inputs.model_name   : upscale model
  Node "181" → inputs.client/product/filename : INDGOutputPath (8K saver path)
  Node "182" → inputs.client/product/filename : INDGOutputPath (4K saver path)
  Node "1"   → inputs.value        : username (98_USER)
  Node "46"  → inputs.noise_seed   : RandomNoise (Flux 4K path)
  Node "165" → inputs.noise_seed   : RandomNoise (Flux 8K path)
  Node "72"  → inputs.seed         : KSampler (SDXL 4K upscale)
  Node "130" → inputs.seed         : KSampler (SDXL 8K upscale)
"""

import copy
from pathlib import Path
from typing import Dict

from ..base import _load_workflow, _random_seed


def load_upscale_rework(
    filename: str,
    model_name: str,
    run_index: int,
    client_path: str,
    product_path: str,
    filename_prefix: str,
    username: str = "",
) -> Dict:
    workflow_dir = Path(__file__).parent
    workflow = copy.deepcopy(_load_workflow("Upscaler_Batch_V2_API", workflow_dir))

    workflow["18"]["inputs"]["image"] = filename
    workflow["167"]["inputs"]["model_name"] = model_name

    model_short = model_name.rsplit(".", 1)[0][:24]
    unique_prefix = f"{filename_prefix}_{model_short}_r{run_index:02d}_"

    for node_id in ("181", "182"):
        workflow[node_id]["inputs"]["client"]   = client_path
        workflow[node_id]["inputs"]["product"]  = product_path
        workflow[node_id]["inputs"]["filename"] = unique_prefix

    workflow["1"]["inputs"]["value"] = username

    workflow["46"]["inputs"]["noise_seed"]  = _random_seed()
    workflow["165"]["inputs"]["noise_seed"] = _random_seed()
    workflow["72"]["inputs"]["seed"]        = _random_seed()
    workflow["130"]["inputs"]["seed"]       = _random_seed()

    return workflow
