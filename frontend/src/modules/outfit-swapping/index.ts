import { Shirt } from 'lucide-react'
import OutfitSwapping from './OutfitSwapping'
import type { WorkflowModule } from '@/modules/index'

const outfitSwappingModule: WorkflowModule = {
  id: 'outfit-swapping',
  title: 'Outfit Swapping',
  description: 'Place a rider on a bike wearing outfit references (suit, helmet, boots, gloves) using Gemini.',
  icon: Shirt,
  component: OutfitSwapping,
}

export default outfitSwappingModule
