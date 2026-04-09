"""
Base classes and utilities for workflow loaders.
"""

import json
import random
from pathlib import Path
from typing import Dict, Any

_MAX_SEED = 2**53 - 1  # ComfyUI accepts up to 53-bit seeds


def _random_seed() -> int:
    """Generate a random seed for ComfyUI workflows."""
    return random.randint(0, _MAX_SEED)


WORKFLOWS_DIR = Path(__file__).parent


def _load_workflow(name: str) -> Dict[str, Any]:
    """Load a workflow JSON file by name.
    
    Args:
        name: The name of the workflow file (without .json extension).
        
    Returns:
        The loaded workflow as a dictionary.
        
    Raises:
        FileNotFoundError: If the workflow file does not exist.
        json.JSONDecodeError: If the workflow file is not valid JSON.
    """
    path = WORKFLOWS_DIR / f"{name}.json"
    if not path.exists():
        raise FileNotFoundError(f"Workflow file {name}.json not found in {WORKFLOWS_DIR}")
    with open(path) as f:
        return json.load(f)