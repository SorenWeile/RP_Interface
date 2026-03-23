"""
Workflow loader and patcher.
Each workflow has a load_* function that reads the JSON and patches runtime values.

upscale.json patch points:
  Node "2" -> inputs.image : input image filename
"""

import json
import copy
from pathlib import Path

WORKFLOWS_DIR = Path(__file__).parent


def _load(name: str) -> dict:
    path = WORKFLOWS_DIR / f"{name}.json"
    with open(path) as f:
        return json.load(f)


def load_upscale(filename: str) -> dict:
    workflow = copy.deepcopy(_load("upscale"))
    workflow["2"]["inputs"]["image"] = filename
    return workflow
