import { Shirt } from 'lucide-react'
import OutfitSwapping from './OutfitSwapping'
import type { WorkflowModule } from '@/modules/index'

const outfitSwappingModule: WorkflowModule = {
  id: 'outfit-swapping',
  title: 'Outfit Swapping',
  description: 'Change the outfit of a character while keeping the same pose and background.',
  icon: Shirt,
  component: OutfitSwapping,
}

export default outfitSwappingModule
