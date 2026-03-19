"""
Workflow loader and patcher.
Each workflow has a load_* function that reads the JSON and patches runtime values.

upscale.json patch points:
  Node "10" -> inputs.image    : input image filename
  Node "15" -> inputs.scale_by : upscale factor (default 2.0)
"""

import json
import copy
from pathlib import Path

WORKFLOWS_DIR = Path(__file__).parent


def _load(name: str) -> dict:
    path = WORKFLOWS_DIR / f"{name}.json"
    with open(path) as f:
        return json.load(f)


def load_upscale(filename: str, scale_by: float = 2.0) -> dict:
    workflow = copy.deepcopy(_load("upscale"))
    workflow["10"]["inputs"]["image"] = filename
    workflow["15"]["inputs"]["scale_by"] = scale_by
    return workflow
