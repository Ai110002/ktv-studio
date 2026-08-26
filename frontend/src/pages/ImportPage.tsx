import { AudioLines, FileAudio, Link2, LoaderCircle, UploadCloud } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError, createJob, getJob, getJobs, uploadAudio, type Job } from '../api'
import JobProgress from '../components/JobProgress'

function filenameToTitle(filename: string): string {
  return filename.replace(/\.[^.]+$/, '').trim()
}

export default function ImportPage() {
  const navigate = useNavigate()
  const fileInput = useRef<HTMLInputElement>(null)
  const [url, setUrl] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [job, setJob] = useState<Job | null>(null)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [dragging, setDragging] = useState(false)

  const loadJob = useCallback(async (jobId: string) => {
    const latest = await getJob(jobId)
    setJob(latest)
    return latest
  }, [])

  useEffect(() => {
    let active = true
    void getJobs()
      .then((jobs) => {
        const resumable = jobs.find((item) => item.status === 'queued' || item.status === 'running')
        if (active && resumable) setJob(resumable)
      })
      .catch(() => {
        // 後端尚未啟動時，頁面仍可呈現匯入介面。
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!job) return
    if (job.status === 'done' && job.song_id) {
      const timer = window.setTimeout(() => navigate(`/studio/${job.song_id}`), 700)
      return () => window.clearTimeout(timer)
    }
    if (job.status === 'failed') return

    let active = true
    const poll = async () => {
      try {
        const latest = await getJob(job.job_id)
        if (active) setJob(latest)
      } catch (pollError) {
        if (active) setError(pollError instanceof Error ? pollError.message : '讀取工作進度失敗')
      }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 1000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [job?.job_id, job?.status, job?.song_id, navigate])

  const startYouTube = async () => {
    if (!url.trim()) {
      setError('請貼上 YouTube 網址')
      return
    }
    setError('')
    setSubmitting(true)
    try {
      const created = await createJob({ source_type: 'youtube', url: url.trim() })
      await loadJob(created.job_id)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '建立工作失敗')
    } finally {
      setSubmitting(false)
    }
  }

  const startUpload = async () => {
    if (!file) {
      setError('請先選擇音訊檔')
      return
    }
    setError('')
    setSubmitting(true)
    try {
      const uploaded = await uploadAudio(file)
      const created = await createJob({
        source_type: 'upload',
        upload_id: uploaded.upload_id,
        title: filenameToTitle(uploaded.filename),
      })
      await loadJob(created.job_id)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '上傳或建立工作失敗')
    } finally {
      setSubmitting(false)
    }
  }

  const retry = async () => {
    if (!job) return
    setError('')
    setSubmitting(true)
    try {
      const created = await createJob({
        source_type: job.source_type,
        url: job.url || undefined,
        upload_id: job.upload_id || undefined,
        title: job.title || undefined,
      })
      await loadJob(created.job_id)
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : '重新建立工作失敗')
    } finally {
      setSubmitting(false)
    }
  }

  const selectFile = (selected: File | undefined) => {
    if (!selected) return
    setFile(selected)
    setError('')
  }

  const handleDrop = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault()
    setDragging(false)
    selectFile(event.dataTransfer.files.item(0) || undefined)
  }

  if (job) {
    return (
      <div className="mx-auto max-w-2xl">
        <div className="mb-6 text-center">
          <p className="text-sm font-medium text-indigo-300">KTV Studio 處理站</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-white">正在為你準備錄唱室</h1>
          {job.title && <p className="mt-2 truncate text-slate-400">{job.title}</p>}
        </div>
        <JobProgress job={job} onRetry={() => void retry()} retrying={submitting} />
        {error && <p className="mt-4 text-center text-sm text-rose-300">{error}</p>}
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl">
      <section className="text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-indigo-400/25 bg-indigo-400/10 px-3 py-1 text-xs font-semibold tracking-wide text-indigo-200">
          <AudioLines size={14} aria-hidden="true" />
          全本機處理，音訊不離開你的電腦
        </span>
        <h1 className="mt-5 text-4xl font-black tracking-tight text-white sm:text-5xl">把喜歡的歌，唱成自己的版本。</h1>
        <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-slate-400">
          匯入 YouTube 連結或音訊檔，KTV Studio 會自動製作伴奏、字幕與可錄製的卡拉 OK 工作台。
        </p>
      </section>

      <section className="mt-10 grid gap-5 lg:grid-cols-2">
        <div className="panel p-5 sm:p-6">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-red-500/15 text-red-300"><Link2 size={20} /></span>
            <div>
              <h2 className="font-semibold text-white">從 YouTube 匯入</h2>
              <p className="text-sm text-slate-500">支援字幕優先與最佳音訊品質</p>
            </div>
          </div>
          <label className="mt-6 block text-sm font-medium text-slate-300" htmlFor="youtube-url">YouTube 網址</label>
          <input
            id="youtube-url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void startYouTube()
            }}
            placeholder="https://www.youtube.com/watch?v=…"
            className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950/75 px-3.5 py-3 text-sm text-white outline-none placeholder:text-slate-600 focus:border-indigo-400 focus:ring-3 focus:ring-indigo-500/15"
          />
          <button
            type="button"
            onClick={() => void startYouTube()}
            disabled={submitting}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-950/50 transition hover:brightness-110 disabled:opacity-50"
          >
            {submitting ? <LoaderCircle className="animate-spin" size={17} /> : <Link2 size={17} />}
            開始處理連結
          </button>
        </div>

        <div className="panel p-5 sm:p-6">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-violet-500/15 text-violet-300"><FileAudio size={20} /></span>
            <div>
              <h2 className="font-semibold text-white">上傳音訊檔</h2>
              <p className="text-sm text-slate-500">MP3、M4A、WAV、WebM 等常見格式</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            onDragEnter={() => setDragging(true)}
            onDragLeave={() => setDragging(false)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleDrop}
            className={`mt-6 flex min-h-32 w-full flex-col items-center justify-center rounded-xl border border-dashed px-4 py-6 text-center transition ${
              dragging ? 'border-indigo-300 bg-indigo-500/10' : 'border-slate-700 bg-slate-950/45 hover:border-indigo-400/60 hover:bg-indigo-500/5'
            }`}
          >
            <UploadCloud className="text-indigo-300" size={28} aria-hidden="true" />
            <span className="mt-3 text-sm font-medium text-slate-200">拖放音訊到這裡，或點擊選擇</span>
            <span className="mt-1 text-xs text-slate-500">所有檔案只會保留在本機</span>
            {file && <span className="mt-3 max-w-full truncate rounded-full bg-slate-800 px-3 py-1 text-xs text-indigo-200">{file.name}</span>}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="audio/*,.m4a,.webm"
            className="hidden"
            onChange={(event) => selectFile(event.target.files?.[0])}
          />
          <button
            type="button"
            onClick={() => void startUpload()}
            disabled={submitting || !file}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-indigo-400/40 bg-indigo-500/15 px-4 py-3 text-sm font-bold text-indigo-100 transition hover:bg-indigo-500/25 disabled:border-slate-800 disabled:bg-slate-900 disabled:text-slate-600"
          >
            {submitting ? <LoaderCircle className="animate-spin" size={17} /> : <UploadCloud size={17} />}
            上傳並開始處理
          </button>
        </div>
      </section>
      {error && <p className="mt-5 text-center text-sm text-rose-300">{error}</p>}
    </div>
  )
}
