export interface ApiHealth {
  status: string
}

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? ''

export async function getHealth(): Promise<ApiHealth> {
  const response = await fetch(`${apiBaseUrl}/health`)
  if (!response.ok) {
    throw new Error(`API health check failed with status ${response.status}.`)
  }
  return response.json() as Promise<ApiHealth>
}
