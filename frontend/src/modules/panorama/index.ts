import { Globe } from 'lucide-react'
import Panorama from './Panorama'
import type { WorkflowModule } from '@/modules/index'

const panoramaModule: WorkflowModule = {
  id: 'panorama',
  title: 'Panorama Outpainting',
  description: 'Place a starting image and outpaint it into a full 360° equirectangular panorama.',
  icon: Globe,
  component: Panorama,
  fullWidth: true,
}

export default panoramaModule
