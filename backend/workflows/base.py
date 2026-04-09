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


def _load_workflow(name: str, workflow_dir: Path) -> Dict[str, Any]:
    """Load a workflow JSON file by name from a specific directory.
    
    Args:
        name: The name of the workflow file (without .json extension).
        workflow_dir: The directory containing the workflow JSON file.
        
    Returns:
        The loaded workflow as a dictionary.
        
    Raises:
        FileNotFoundError: If the workflow file does not exist.
        json.JSONDecodeError: If the workflow file is not valid JSON.
    """
    path = workflow_dir / f"{name}.json"
    if not path.exists():
        raise FileNotFoundError(f"Workflow file {name}.json not found in {workflow_dir}")
    with open(path) as f:
        return json.load(f)