import { Layers } from 'lucide-react'
import UpscalerRework from './UpscalerRework'
import type { WorkflowModule } from '@/modules/index'

const upscalerReworkModule: WorkflowModule = {
  id: 'upscaler-rework',
  title: 'Batch Upscaler',
  description: 'Run up to 6 AI upscale models × N runs, producing 4K and 8K outputs per job.',
  icon: Layers,
  component: UpscalerRework,
}

export default upscalerReworkModule
