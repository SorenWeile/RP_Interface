"""
Seed data for built-in tools.  Read once at startup; never at request time.

path_nodes format: {"node_id": "X"} — single INDGOutputPath node
                   {"node_ids": ["X","Y"]} — multiple INDGOutputPath nodes (upscale_rework)
"""

import json
from pathlib import Path


def _wf(rel_path: str) -> str:
    """Load a workflow JSON file as a string (only called during seeding)."""
    return (Path(__file__).parent / "workflows" / rel_path).read_text(encoding="utf-8")


BUILTIN_TOOLS = [
    # ── Magnific Upscaler ───────────────────────────────────────────────────
    {
        "id": "magnific-upscaler",
        "name": "Magnific Upscaler",
        "description": "Upscale 2×–16× with sharpening and detail controls",
        "icon": "ZoomIn",
        "fields_json": json.dumps([
            {
                "id": "image",
                "label": "Input Image",
                "type": "image",
                "node_id": "12",
                "input_key": "image",
                "required": True,
            },
            {
                "id": "scale_factor",
                "label": "Scale Factor",
                "type": "select",
                "node_id": "9",
                "input_key": "scale_factor",
                "options": ["2x", "4x", "8x", "16x"],
                "default": "4x",
                "required": False,
            },
            {
                "id": "sharpen",
                "label": "Sharpen",
                "type": "slider",
                "node_id": "17",
                "input_key": "value",
                "min": 0, "max": 10, "step": 1, "default": 3,
                "required": False,
            },
            {
                "id": "smart_grain",
                "label": "Smart Grain",
                "type": "slider",
                "node_id": "18",
                "input_key": "value",
                "min": 0, "max": 10, "step": 1, "default": 3,
                "required": False,
            },
            {
                "id": "ultra_detail",
                "label": "Ultra Detail",
                "type": "slider",
                "node_id": "19",
                "input_key": "value",
                "min": 0, "max": 50, "step": 1, "default": 30,
                "required": False,
            },
        ]),
        "path_nodes": json.dumps({"node_id": "20"}),
        "auto_nodes": json.dumps([
            {"node_id": "3", "input_key": "value", "strategy": "username"},
        ]),
        "workflow": _wf("magnific_upscaler/Magnific_Upscaler_V1_API.json"),
    },

    # ── Upscale Rework ──────────────────────────────────────────────────────
    # Model selection and batch runs are handled by the custom endpoint.
    # Two INDGOutputPath nodes (181 = 8K saver, 182 = 4K saver).
    {
        "id": "upscale-rework",
        "name": "Upscale Rework",
        "description": "Batch upscale with multiple AI models and runs",
        "icon": "Layers",
        "fields_json": json.dumps([
            {
                "id": "image",
                "label": "Input Image",
                "type": "image",
                "node_id": "18",
                "input_key": "image",
                "required": True,
            },
        ]),
        "path_nodes": json.dumps({"node_ids": ["181", "182"]}),
        "auto_nodes": json.dumps([
            {"node_id": "1",   "input_key": "value",      "strategy": "username"},
            {"node_id": "46",  "input_key": "noise_seed", "strategy": "random_seed"},
            {"node_id": "165", "input_key": "noise_seed", "strategy": "random_seed"},
            {"node_id": "72",  "input_key": "seed",       "strategy": "random_seed"},
            {"node_id": "130", "input_key": "seed",       "strategy": "random_seed"},
        ]),
        "workflow": _wf("upscale_rework/Upscaler_Batch_V2_API.json"),
    },

    # ── Outfit Swapping ─────────────────────────────────────────────────────
    # INDGFlexibleImageBatch node 31: image_1=main(1), image_2-7=refs(2-7).
    {
        "id": "outfit-swapping",
        "name": "Outfit Swapping",
        "description": "Swap outfits using reference images",
        "icon": "Shirt",
        "fields_json": json.dumps([
            {
                "id": "main_image",
                "label": "Subject Image",
                "type": "image",
                "node_id": "1",
                "input_key": "image",
                "required": True,
            },
            {
                "id": "ref_image_1",
                "label": "Reference Image 1",
                "type": "image",
                "node_id": "2",
                "input_key": "image",
                "required": True,
            },
            {
                "id": "ref_image_2",
                "label": "Reference Image 2",
                "type": "image",
                "node_id": "3",
                "input_key": "image",
                "required": False,
            },
            {
                "id": "ref_image_3",
                "label": "Reference Image 3",
                "type": "image",
                "node_id": "4",
                "input_key": "image",
                "required": False,
            },
            {
                "id": "ref_image_4",
                "label": "Reference Image 4",
                "type": "image",
                "node_id": "5",
                "input_key": "image",
                "required": False,
            },
            {
                "id": "ref_image_5",
                "label": "Reference Image 5",
                "type": "image",
                "node_id": "6",
                "input_key": "image",
                "required": False,
            },
            {
                "id": "ref_image_6",
                "label": "Reference Image 6",
                "type": "image",
                "node_id": "7",
                "input_key": "image",
                "required": False,
            },
            {
                "id": "prompt",
                "label": "Prompt",
                "type": "textarea",
                "node_id": "30",
                "input_key": "value",
                "required": False,
                "placeholder": "Describe the outfit to apply…",
                "rows": 4,
            },
        ]),
        "path_nodes": json.dumps({"node_id": "32"}),
        "auto_nodes": json.dumps([
            {"node_id": "20", "input_key": "value", "strategy": "username"},
            {"node_id": "22", "input_key": "seed",  "strategy": "random_seed"},
        ]),
        "workflow": _wf("outfit_swapping/Outfit_Swapping_V1_API.json"),
    },

    # ── Panorama ────────────────────────────────────────────────────────────
    {
        "id": "panorama",
        "name": "Panorama Outpainting",
        "description": "360° panorama outpainting with interactive stickers",
        "icon": "Globe",
        "fields_json": json.dumps([
            {
                "id": "state_json",
                "label": "Panorama State",
                "type": "textarea",
                "node_id": "56",
                "input_key": "state_json",
                "required": True,
                "rows": 4,
            },
            {
                "id": "prompt",
                "label": "Prompt",
                "type": "textarea",
                "node_id": "6",
                "input_key": "text",
                "required": False,
                "placeholder": "Fill the green spaces according to the image…",
                "rows": 4,
            },
        ]),
        "path_nodes": json.dumps({"node_id": "170"}),
        "auto_nodes": json.dumps([
            {"node_id": "31",  "input_key": "seed",       "strategy": "random_seed"},
            {"node_id": "83",  "input_key": "noise_seed", "strategy": "random_seed"},
            {"node_id": "147", "input_key": "noise_seed", "strategy": "random_seed"},
        ]),
        "workflow": _wf("panorama/Panorama_Workflow_V5_API.json"),
    },

    # ── Image Edit ──────────────────────────────────────────────────────────
    # INDGFlexibleImageBatch node 69: image_1=main(11), image_2-5=refs(61,62,63,68).
    {
        "id": "image-edit",
        "name": "Image Edit",
        "description": "Edit images with text prompts and optional reference images",
        "icon": "Pencil",
        "fields_json": json.dumps([
            {
                "id": "image",
                "label": "Input Image",
                "type": "image",
                "node_id": "11",
                "input_key": "image",
                "required": True,
            },
            {
                "id": "prompt",
                "label": "Prompt Instruction",
                "type": "textarea",
                "node_id": "36",
                "input_key": "value",
                "required": True,
                "placeholder": "Describe the edit to apply…",
                "rows": 5,
            },
            {
                "id": "ref_image_1",
                "label": "Reference Image 1",
                "type": "image",
                "node_id": "61",
                "input_key": "image",
                "required": False,
            },
            {
                "id": "ref_image_2",
                "label": "Reference Image 2",
                "type": "image",
                "node_id": "62",
                "input_key": "image",
                "required": False,
            },
            {
                "id": "ref_image_3",
                "label": "Reference Image 3",
                "type": "image",
                "node_id": "63",
                "input_key": "image",
                "required": False,
            },
            {
                "id": "ref_image_4",
                "label": "Reference Image 4",
                "type": "image",
                "node_id": "68",
                "input_key": "image",
                "required": False,
            },
        ]),
        "path_nodes": json.dumps({"node_id": "70"}),
        "auto_nodes": json.dumps([
            {"node_id": "46", "input_key": "value", "strategy": "username"},
            {"node_id": "35", "input_key": "seed",  "strategy": "random_seed"},
        ]),
        "workflow": _wf("image_edit/image_edit_V3_API.json"),
    },

    # ── Image Prompting ─────────────────────────────────────────────────────
    # INDGFlexibleImageBatch node 677: image_1-4=refs(667,670,671,672).
    {
        "id": "image-prompting",
        "name": "Image Prompting",
        "description": "Generate from reference images and a text prompt",
        "icon": "ImagePlus",
        "fields_json": json.dumps([
            {
                "id": "ref_image_1",
                "label": "Reference Image 1",
                "type": "image",
                "node_id": "667",
                "input_key": "image",
                "required": True,
            },
            {
                "id": "ref_image_2",
                "label": "Reference Image 2",
                "type": "image",
                "node_id": "670",
                "input_key": "image",
                "required": False,
            },
            {
                "id": "ref_image_3",
                "label": "Reference Image 3",
                "type": "image",
                "node_id": "671",
                "input_key": "image",
                "required": False,
            },
            {
                "id": "ref_image_4",
                "label": "Reference Image 4",
                "type": "image",
                "node_id": "672",
                "input_key": "image",
                "required": False,
            },
            {
                "id": "prompt",
                "label": "Prompt Instruction",
                "type": "textarea",
                "node_id": "666",
                "input_key": "value",
                "required": True,
                "placeholder": "Describe what to generate…",
                "rows": 5,
            },
        ]),
        "path_nodes": json.dumps({"node_id": "676"}),
        "auto_nodes": json.dumps([
            {"node_id": "658", "input_key": "value", "strategy": "username"},
            {"node_id": "31",  "input_key": "seed",  "strategy": "random_seed"},
        ]),
        "workflow": _wf("image_prompting/Image_Prompting_V1_API.json"),
    },

    # ── Video Creation ──────────────────────────────────────────────────────
    {
        "id": "video-creation",
        "name": "Video Creation",
        "description": "Generate video from first and last frames",
        "icon": "Video",
        "fields_json": json.dumps([
            {
                "id": "first_frame",
                "label": "First Frame",
                "type": "image",
                "node_id": "31",
                "input_key": "image",
                "required": True,
            },
            {
                "id": "last_frame",
                "label": "Last Frame",
                "type": "image",
                "node_id": "39",
                "input_key": "image",
                "required": True,
            },
            {
                "id": "prompt",
                "label": "Prompt",
                "type": "textarea",
                "node_id": "146",
                "input_key": "value",
                "required": True,
                "placeholder": "Describe the motion…",
                "rows": 4,
            },
            {
                "id": "length",
                "label": "Length (frames)",
                "type": "slider",
                "node_id": "102",
                "input_key": "value",
                "min": 25, "max": 125, "step": 1, "default": 121,
                "required": False,
            },
        ]),
        "path_nodes": json.dumps({"node_id": "173"}),
        "auto_nodes": json.dumps([
            {"node_id": "165", "input_key": "value",      "strategy": "username"},
            {"node_id": "172", "input_key": "seed",       "strategy": "random_seed"},
            {"node_id": "100", "input_key": "noise_seed", "strategy": "random_seed"},
        ]),
        "workflow": _wf("video_creation/LTX_IMG2Video_v01_API.json"),
    },
]
