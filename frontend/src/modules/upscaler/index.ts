import { Maximize2 } from 'lucide-react'
import Upscaler from './Upscaler'
import type { WorkflowModule } from '@/modules/index'

const upscalerModule: WorkflowModule = {
  id: 'upscaler',
  title: 'Image Upscaler',
  description: 'Upscale images using AI models. Drag, drop, and upscale.',
  icon: Maximize2,
  component: Upscaler,
}

export default upscalerModule
