"""
Workflow loader and patcher.
Each workflow has a load_* function that reads the JSON and patches runtime values.

upscale.json patch points:
  Node "2"  → inputs.image : input image filename

Upscaler_Rework_API.json patch points:
  Node "18"  → inputs.image        : input image filename
  Node "167" → inputs.model_name   : upscale model (feeds both 4K and 8K branches)
  Node "173" → inputs.value        : client path  (e.g. "Deployed/HD")
  Node "15"  → inputs.value        : product path (e.g. "ProjectName")
  Node "16"  → inputs.value        : filename prefix (model shortname + run index baked in automatically)
  Path chain: 171("ComfyUI")/173/15 → split into 4K(node 175/177) and 8K(node 176/178) → MetaSaver 99+132

Outfit_Swapping.json patch points:
  Node "1"  → inputs.image   : main subject image (LoadImage)
  Node "11" → inputs.image   : ref image 1
  Node "2"  → inputs.image   : ref image 2
  Node "3"  → inputs.image   : ref image 3
  Node "4"  → inputs.image   : ref image 4
  Node "5"  → inputs.image   : ref image 5
  Node "6"  → inputs.image   : ref image 6
  Node "7"  → inputs.image   : ref image 7
  Node "23" → inputs.text    : positive prompt (Text Multiline)
  Node "13" → inputs.value   : base path — always "ComfyUI"
  Node "14" → inputs.value   : client path  (e.g. "Deployed/HD")
  Node "15" → inputs.value   : product path (e.g. "ProjectName")
  Node "16" → inputs.value   : filename prefix
  Path chain: 13/14/15/16 → concat nodes 27→28→29 → MetaSaver 26
"""

import json
import copy
import random
from pathlib import Path

_MAX_SEED = 2**53 - 1  # ComfyUI accepts up to 53-bit seeds


def _random_seed() -> int:
    return random.randint(0, _MAX_SEED)

WORKFLOWS_DIR = Path(__file__).parent


def _load(name: str) -> dict:
    path = WORKFLOWS_DIR / f"{name}.json"
    with open(path) as f:
        return json.load(f)


def load_upscale(filename: str) -> dict:
    workflow = copy.deepcopy(_load("upscale"))
    workflow["2"]["inputs"]["image"] = filename
    return workflow


def load_upscale_rework(
    filename: str,
    model_name: str,
    run_index: int,
    client_path: str,
    product_path: str,
    filename_prefix: str,
    username: str = "",
) -> dict:
    """
    Patch Upscaler_Rework_API.json for a single batch run.
    The model shortname and run index are automatically appended to the filename
    prefix so every output is uniquely identifiable in the ComfyUI output folder.
    """
    workflow = copy.deepcopy(_load("Upscaler_Batch_V2_API"))

    # Image input
    workflow["18"]["inputs"]["image"] = filename

    # Upscale model — node 167 feeds both the 4K (62) and 8K (128) branches
    workflow["167"]["inputs"]["model_name"] = model_name

    # Output path nodes
    workflow["173"]["inputs"]["value"] = client_path   # client path (concat node 172 feeds 174→175/176→177/178)
    workflow["15"]["inputs"]["value"] = product_path   # 96_PRODUCT_PATH

    # Build a unique filename prefix: "<user_prefix>_<model_short>_r<NN>_"
    # Strip extension and truncate so paths stay reasonable
    model_short = model_name.rsplit(".", 1)[0][:24]
    workflow["16"]["inputs"]["value"] = f"{filename_prefix}_{model_short}_r{run_index:02d}_"

    # User
    workflow["1"]["inputs"]["value"] = username             # 98_USER

    # Randomise seeds so each run produces a different result.
    # ComfyUI uses the literal seed from the API payload; the "randomise"
    # setting in the UI has no effect on API submissions.
    workflow["46"]["inputs"]["noise_seed"] = _random_seed()   # RandomNoise (Flux 4K path)
    workflow["165"]["inputs"]["noise_seed"] = _random_seed()  # RandomNoise (Flux 8K path)
    workflow["72"]["inputs"]["seed"] = _random_seed()         # KSampler (SDXL 4K upscale)
    workflow["130"]["inputs"]["seed"] = _random_seed()        # KSampler (SDXL 8K upscale)

    return workflow


# Ref image node IDs in order (titles 12→18_INPUT_IMAGE_REF)
_OUTFIT_REF_NODES = ["11", "2", "3", "4", "5", "6", "7"]

# Image edit reference image node IDs (actual IDs in the JSON file)
_IMAGE_EDIT_REF_NODES = ["61", "62", "63", "68"]  # 12_INPUT_IMAGE_REFERENCE_01 → 15_INPUT_IMAGE_REFERENCE_04


def load_outfit_swapping(
    main_image: str,
    ref_images: list[str],
    prompt: str,
    client_path: str,
    product_path: str,
    filename_prefix: str,
    positive_prompt: str = "",
    username: str = "",
) -> dict:
    """
    Patch Outfit_Swapping_V1_API.json for a single run.

    ref_images: list of up to 7 filenames; only provided slots are patched.
    The remaining ref nodes keep whatever default filename is in the JSON.
    Prompt goes to node 30 (102_POSITIVE_PROMPT_INPUT).
    """
    workflow = copy.deepcopy(_load("Outfit_Swapping_V1_API"))

    # Main subject image
    workflow["1"]["inputs"]["image"] = main_image

    # Reference images — patch only the slots the caller supplied
    for node_id, filename in zip(_OUTFIT_REF_NODES, ref_images):
        workflow[node_id]["inputs"]["image"] = filename

    # Prompt → node 30 (102_POSITIVE_PROMPT_INPUT)
    workflow["30"]["inputs"]["value"] = prompt

    # Output path nodes — concat chain 13/14/15/16 → nodes 27→28→29 → MetaSaver 26
    workflow["13"]["inputs"]["value"] = "ComfyUI"      # base path (always fixed)
    workflow["14"]["inputs"]["value"] = client_path    # 95_CLIENT_PATH
    workflow["15"]["inputs"]["value"] = product_path   # 96_PRODUCT_PATH
    workflow["16"]["inputs"]["value"] = filename_prefix  # 97_FILENAME
    workflow["20"]["inputs"]["value"] = username         # 98_USER

    return workflow


def load_image_edit(
    filename: str,
    prompt: str,
    ref_images: list[str],
    client_path: str,
    product_path: str,
    filename_prefix: str,
    username: str = "",
) -> dict:
    """
    Patch image_edit_V3_API.json for a single run.

    image_edit_V3_API.json patch points:
      Node "11"  → inputs.image   : input image (LoadImage)
      Node "36"  → inputs.value   : prompt instruction (05_PROMPT_INSTRUCTION)
      Node "61"  → inputs.image   : reference image 1 (12_INPUT_IMAGE_REFERENCE_01)
      Node "62"  → inputs.image   : reference image 2 (13_INPUT_IMAGE_REFERENCE_02)
      Node "63"  → inputs.image   : reference image 3 (14_INPUT_IMAGE_REFERENCE_03)
      Node "68"  → inputs.image   : reference image 4 (15_INPUT_IMAGE_REFERENCE_04)
      Node "66"  → inputs        : BatchImagesNode that collects main + reference images
      Node "45"  → inputs.value   : client path  (95_CLIENT_PATH)
      Node "55"  → inputs.value   : product path (96_PRODUCT_PATH)
      Node "56"  → inputs.value   : filename prefix (97_FILENAME)
      Node "46"  → inputs.value   : username (98_USER)
      Node "35"  → inputs.seed    : randomised Gemini seed
      Path chain: 40("ComfyUI")/45/55/56 → concat 57→58→59 → MetaSaver 37
    """
    workflow = copy.deepcopy(_load("image_edit_V3_API"))

    # Main image
    workflow["11"]["inputs"]["image"] = filename
    
    # Reference images — add to BatchImagesNode only if provided
    # The BatchImagesNode (66) should only include images that actually exist
    batch_images_inputs = workflow["66"]["inputs"]
    
    # Build the images list dynamically based on what's provided
    images_list = []
    if filename:
        images_list.append(["11", 0])  # Main image
    
    # Add reference images only if they exist
    ref_node_mapping = ["61", "62", "63", "68"]  # Reference image nodes
    for i, ref_filename in enumerate(ref_images):
        if ref_filename:
            # Only add reference images that were actually provided
            ref_node_id = ref_node_mapping[i]
            workflow[ref_node_id]["inputs"]["image"] = ref_filename
            images_list.append([ref_node_id, 0])
    
    # Update the BatchImagesNode with only the images we have
    # The node expects a specific structure, so we need to update it carefully
    for key in list(batch_images_inputs.keys()):
        if key.startswith("images.image"):
            # Remove existing image references
            del batch_images_inputs[key]
    
    # Add back only the images we actually have
    for i, image_ref in enumerate(images_list):
        batch_images_inputs[f"images.image{i}"] = image_ref
    
    # Prompt and paths
    workflow["36"]["inputs"]["value"] = prompt
    workflow["45"]["inputs"]["value"] = client_path
    workflow["55"]["inputs"]["value"] = product_path
    workflow["56"]["inputs"]["value"] = filename_prefix
    workflow["46"]["inputs"]["value"] = username         # 98_USER
    workflow["35"]["inputs"]["seed"] = _random_seed()

    return workflow


def load_panorama(
    state_json: str,
    prompt: str = "Fill the green spaces according to the image. Outpaint as a seamless 360 equirectangular panorama (2:1). Keep the horizon level. Match left and right edges.",
    client_path: str = "HD",
    product_path: str = "Panorama",
    filename_prefix: str = "Shot001",
    username: str = "",
) -> dict:
    """
    Patch Panorama_Workflow_V5_API.json for a single run.
    state_json is produced directly by the frontend PanoramaStickers editor.

    Panorama_Workflow_V5_API.json patch points:
      Node "56"  → state_json  : PanoramaStickers — full editor state from frontend
      Node "6"   → text        : positive prompt (panorama outpaint pass)
      Node "31"  → seed        : randomised KSampler seed
      Node "83"  → noise_seed  : randomised RandomNoise (img2img pass)
      Node "147" → noise_seed  : randomised RandomNoise (detail pass)
      Node "160" → value       : 95_CLIENT_PATH
      Node "162" → value       : 96_PRODUCT_PATH
      Node "163" → value       : 97_FILENAME
      Node "167" → value       : "Pano" subfolder (fixed in JSON, do NOT patch)
      Node "998" → value       : 98_USER (injected PrimitiveStringMultiline)
      Node "166" → meta_value_5: ["998", 0] — wired to user node
      Path chain: 158("ComfyUI")/160/162/167("Pano")/163 → concat 159→164→168→165 → MetaSaver 166
    """
    workflow = copy.deepcopy(_load("Panorama_Workflow_V5_API"))

    workflow["56"]["inputs"]["state_json"] = state_json
    workflow["6"]["inputs"]["text"] = prompt

    # Randomise all sampler seeds
    workflow["31"]["inputs"]["seed"] = _random_seed()
    workflow["83"]["inputs"]["noise_seed"] = _random_seed()
    workflow["147"]["inputs"]["noise_seed"] = _random_seed()

    # Output path nodes
    workflow["160"]["inputs"]["value"] = client_path
    workflow["162"]["inputs"]["value"] = product_path
    workflow["163"]["inputs"]["value"] = filename_prefix

    # Inject a PrimitiveStringMultiline node for the username and wire it to MetaSaver.
    # Use a high ID ("998") that will never clash with nodes in the workflow JSON.
    workflow["998"] = {
        "inputs": {"value": username},
        "class_type": "PrimitiveStringMultiline",
        "_meta": {"title": "98_USER"},
    }
    workflow["166"]["inputs"]["meta_value_5"] = ["998", 0]

    return workflow
