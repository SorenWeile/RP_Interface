export interface AdminGroup {
  id: number
  name: string
  can_access_admin: boolean
  allowed_modules: string[]
  created_at: string
}

export interface AdminClient {
  id: number
  client_id: string
  name: string
  created_at: string
}

export interface AdminProject {
  id: number
  project_id: string
  name: string
  created_at: string
}

export interface AdminUser {
  id: number
  username: string
  email: string
  is_admin: boolean
  group: AdminGroup | null
  created_at: string
  updated_at: string
  clients: AdminClient[]
  projects: AdminProject[]
}
