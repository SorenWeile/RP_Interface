import { Workflow } from 'lucide-react'
import ComfyUI from './ComfyUI'

export default {
  id: 'comfyui',
  title: 'ComfyUI',
  description: 'Open the ComfyUI node editor running in the container',
  icon: Workflow,
  component: ComfyUI,
  fullWidth: true,
  noPadding: true,
  hidesSidebar: true,
}
