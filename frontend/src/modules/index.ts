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
  /** Remove the max-width cap so the module can use the full content area */
  fullWidth?: boolean
  /** Remove all padding from the main container (e.g. full-bleed gallery) */
  noPadding?: boolean
  /** Hide the right AppSidebar when this module is active */
  hidesSidebar?: boolean
}

// ── Registry ─────────────────────────────────────────────────────────────────
// Add new modules here. No other files need to change.

import upscalerModule from './upscaler'
import upscalerReworkModule from './upscaler-rework'
import outfitSwappingModule from './outfit-swapping'
import panoramaModule from './panorama'
import imageEditModule from './image-edit'
import galleryModuleDefinition from './gallery'
import adminModuleDefinition from './admin'

/** The gallery entry — rendered full-bleed with its own panels. */
export const galleryModule: WorkflowModule = galleryModuleDefinition

/** Admin module — password-protected user/client/project management. */
export const adminModule: WorkflowModule = adminModuleDefinition

/** Standard workflow tool modules shown in the Workflow Tools section. */
export const workflowModules: WorkflowModule[] = [
  upscalerModule,
  upscalerReworkModule,
  outfitSwappingModule,
  panoramaModule,
  imageEditModule,
]

/** All modules combined (used by AppSidebar for navigation). */
export const modules: WorkflowModule[] = [galleryModule, adminModule, ...workflowModules]
