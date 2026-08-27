export type JobStatus = 'queued' | 'running' | 'done' | 'failed'
export type JobStep = 'fetch' | 'separate' | 'transcribe' | 'subtitles' | 'finalize'

export interface Job {
  job_id: string
  status: JobStatus
  step: JobStep
  step_index: number
  total_steps: number
  progress: number
  message: string
  error: string | null
  song_id: string | null
  title: string
  source_type: 'youtube' | 'upload'
  url: string | null
  upload_id: string | null
  created_at: string
  updated_at: string
}

export interface SongFiles {
  original: string
  vocals: string
  instrumental: string
  cover: string
  cover_video?: string
}

export interface Song {
  id: string
  title: string
  artist: string
  source_type: 'youtube' | 'upload'
  source_url: string | null
  language: string
  duration: number
  created_at: string
  files: SongFiles
  status: 'ready' | 'incomplete'
  has_cover: boolean
  has_cover_video: boolean
}

export interface SubtitleWord {
  text: string
  romaji?: string
  start: number
  end: number
}

export interface SubtitleLine {
  start: number
  end: number
  text: string
  romaji?: string
  words: SubtitleWord[] | null
}

export interface Subtitles {
  language: string
  source: 'whisper' | 'youtube'
  title: string
  lines: SubtitleLine[]
}

export class ApiError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  if (!response.ok) {
    let message = `請求失敗（${response.status}）`
    try {
      const payload = (await response.json()) as { detail?: string }
      message = payload.detail || message
    } catch {
      // 沒有 JSON 錯誤內容時保留通用訊息。
    }
    throw new ApiError(message, response.status)
  }
  return response.json() as Promise<T>
}

export function createJob(input: {
  source_type: 'youtube' | 'upload'
  url?: string
  upload_id?: string
  title?: string
}) {
  return request<{ job_id: string }>('/api/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export async function uploadAudio(file: File) {
  const body = new FormData()
  body.append('file', file)
  return request<{ upload_id: string; filename: string }>('/api/upload', { method: 'POST', body })
}

export function getJob(jobId: string) {
  return request<Job>(`/api/jobs/${encodeURIComponent(jobId)}`)
}

export async function getJobs() {
  const result = await request<{ jobs: Job[] }>('/api/jobs')
  return result.jobs
}

export async function getSongs() {
  const result = await request<{ songs: Song[] }>('/api/songs')
  return result.songs
}

export function getSong(songId: string) {
  return request<Song>(`/api/songs/${encodeURIComponent(songId)}`)
}

export function getSubtitles(songId: string) {
  return request<Subtitles>(`/api/songs/${encodeURIComponent(songId)}/subtitles`)
}

export function deleteSong(songId: string) {
  return request<{ ok: boolean }>(`/api/songs/${encodeURIComponent(songId)}`, { method: 'DELETE' })
}

export async function exportRecording(songId: string, blob: Blob) {
  const body = new FormData()
  body.append('recording', blob, '錄音.webm')
  return request<{ url: string; filename: string }>(
    `/api/songs/${encodeURIComponent(songId)}/export`,
    { method: 'POST', body },
  )
}

export async function exportVideo(songId: string, blob: Blob) {
  const body = new FormData()
  body.append('recording', blob, 'cover錄影.webm')
  return request<{ url: string; filename: string }>(
    `/api/songs/${encodeURIComponent(songId)}/export-video`,
    { method: 'POST', body },
  )
}

export function openInJiaying(songId: string) {
  return request<{ ok: string; message: string }>(
    `/api/songs/${encodeURIComponent(songId)}/open-in-jiaying`,
    { method: 'POST' },
  )
}

export function audioUrl(songId: string, kind: keyof SongFiles): string {
  return `/api/songs/${encodeURIComponent(songId)}/audio/${kind}`
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—'
  const total = Math.round(seconds)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}
