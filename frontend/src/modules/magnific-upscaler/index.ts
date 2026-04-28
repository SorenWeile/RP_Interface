import { Sparkles } from 'lucide-react'
import MagnificUpscaler from './MagnificUpscaler'
import type { WorkflowModule } from '@/modules/index'

const magnificUpscalerModule: WorkflowModule = {
  id: 'magnific-upscaler',
  title: 'Magnific Upscaler',
  description: 'Upscale images up to 16× with AI-driven sharpening, smart grain, and ultra detail.',
  icon: Sparkles,
  component: MagnificUpscaler,
  fullWidth: true,
}

export default magnificUpscalerModule
