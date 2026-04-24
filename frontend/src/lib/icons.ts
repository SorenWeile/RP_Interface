import type { LucideIcon } from 'lucide-react'
import {
  Sparkles, Palette, Paintbrush, Wand2, Camera, ImageIcon, Film, Video,
  Layers, Box, Folder, FileIcon, Star, Heart, Crown, Flame,
  Zap, Dna, Mountain, Bike, Shirt, Globe, Eye, Hash,
  Type, SlidersHorizontal, ToggleLeft, Dices, List, Wrench, Settings, Images,
  Scissors, Pencil, BrainCircuit, Cpu, Lightbulb, Telescope, Rocket,
  Package, Layers3, Grid3X3, Shapes,
} from 'lucide-react'

const ICON_MAP: Record<string, LucideIcon> = {
  sparkles:   Sparkles,
  palette:    Palette,
  brush:      Paintbrush,
  wand:       Wand2,
  camera:     Camera,
  image:      ImageIcon,
  film:       Film,
  video:      Video,
  layers:     Layers,
  box:        Box,
  folder:     Folder,
  file:       FileIcon,
  star:       Star,
  heart:      Heart,
  crown:      Crown,
  flame:      Flame,
  zap:        Zap,
  dna:        Dna,
  mountain:   Mountain,
  bike:       Bike,
  shirt:      Shirt,
  globe:      Globe,
  eye:        Eye,
  hash:       Hash,
  text:       Type,
  sliders:    SlidersHorizontal,
  toggle:     ToggleLeft,
  dice:       Dices,
  list:       List,
  wrench:     Wrench,
  admin:      Settings,
  gallery:    Images,
  scissors:   Scissors,
  pencil:     Pencil,
  brain:      BrainCircuit,
  cpu:        Cpu,
  bulb:       Lightbulb,
  telescope:  Telescope,
  rocket:     Rocket,
  package:    Package,
  layers3:    Layers3,
  grid:       Grid3X3,
  shapes:     Shapes,
  paintbrush: Paintbrush,
}

export const ICON_LIBRARY = [
  'sparkles', 'palette', 'brush', 'wand', 'camera', 'image', 'film', 'video',
  'layers', 'box', 'folder', 'star', 'heart', 'crown', 'flame', 'zap',
  'dna', 'mountain', 'bike', 'shirt', 'globe', 'eye', 'hash', 'sliders',
  'toggle', 'dice', 'list', 'wrench', 'brain', 'cpu', 'bulb', 'rocket',
] as const

export type IconName = typeof ICON_LIBRARY[number]

export function getIcon(name: string): LucideIcon {
  return ICON_MAP[name] ?? Wrench
}
