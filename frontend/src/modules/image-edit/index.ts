import { Wand2 } from 'lucide-react'
import ImageEdit from './ImageEdit'
import type { WorkflowModule } from '@/modules/index'

const imageEditModule: WorkflowModule = {
  id: 'image-edit',
  title: 'Image Edit',
  description: 'Edit an image using a text instruction powered by Google Gemini.',
  icon: Wand2,
  component: ImageEdit,
}

export default imageEditModule
