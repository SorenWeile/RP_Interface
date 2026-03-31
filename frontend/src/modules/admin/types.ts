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
  created_at: string
  updated_at: string
  clients: AdminClient[]
  projects: AdminProject[]
}
