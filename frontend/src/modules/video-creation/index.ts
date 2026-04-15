import { Film } from 'lucide-react'
import VideoCreation from './VideoCreation'
import type { WorkflowModule } from '@/modules/index'

const videoCreationModule: WorkflowModule = {
  id: 'video-creation',
  title: 'Video Creation',
  description: 'Generate smooth video clips between a first and last frame using LTX.',
  icon: Film,
  component: VideoCreation,
}

export default videoCreationModule
