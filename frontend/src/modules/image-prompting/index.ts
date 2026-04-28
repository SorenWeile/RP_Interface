import { ImageIcon } from 'lucide-react'
import ImagePrompting from './ImagePrompting'
import type { WorkflowModule } from '@/modules/index'

const imagePromptingModule: WorkflowModule = {
  id: 'image-prompting',
  title: 'Image Prompting',
  description: 'Generate images from a detailed prompt and reference images using Google Gemini.',
  icon: ImageIcon,
  component: ImagePrompting,
  fullWidth: true,
}

export default imagePromptingModule
