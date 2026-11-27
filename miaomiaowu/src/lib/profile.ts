import { api } from '@/lib/api'

export interface ProfileResponse {
  username: string
  email: string
  nickname: string
  avatar_url: string
  role: string
  is_admin: boolean
}

export const profileQueryFn = async ({
  signal,
}: { signal?: AbortSignal } = {}): Promise<ProfileResponse> => {
  const response = await api.get<ProfileResponse>('/api/user/profile', {
    signal,
  })
  return response.data
}
