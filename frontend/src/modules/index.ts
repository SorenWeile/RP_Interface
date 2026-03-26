import type { ComponentType } from 'react'

export interface WorkflowModule {
  /** URL-safe identifier, shown in the hub grid */
  id: string
  /** Display name on the module card */
  title: string
  /** One-line description on the module card */
  description: string
  /** Lucide icon (or any FC accepting className) */
  icon?: ComponentType<{ className?: string }>
  /** The full-page component rendered when this module is active */
  component: ComponentType
}

// ── Registry ─────────────────────────────────────────────────────────────────
// Add new modules here. No other files need to change.

import upscalerModule from './upscaler'
import upscalerReworkModule from './upscaler-rework'
import outfitSwappingModule from './outfit-swapping'
import panoramaModule from './panorama'

export const modules: WorkflowModule[] = [
  upscalerModule,
  upscalerReworkModule,
  outfitSwappingModule,
  panoramaModule,
]
