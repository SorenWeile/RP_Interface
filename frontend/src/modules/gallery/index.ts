import { Images } from 'lucide-react'
import Gallery from './Gallery'

export default {
  id: 'gallery',
  title: 'Gallery',
  description: 'Browse and manage ComfyUI output images',
  icon: Images,
  component: Gallery,
  fullWidth: true,
  noPadding: true,
  hidesSidebar: true,
}
