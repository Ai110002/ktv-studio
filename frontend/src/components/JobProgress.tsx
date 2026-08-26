import { Check, CircleAlert, LoaderCircle } from 'lucide-react'
import type { Job, JobStep } from '../api'

const steps: Array<{ id: JobStep; label: string; description: string }> = [
  { id: 'fetch', label: '取得音訊', description: '下載或準備來源檔案' },
  { id: 'separate', label: '分離音軌', description: '製作人聲與純伴奏' },
  { id: 'transcribe', label: '辨識歌詞', description: '取得逐字或逐句時間軸' },
  { id: 'subtitles', label: '整理字幕', description: '轉繁體與羅馬拼音' },
  { id: 'finalize', label: '完成歌曲', description: '寫入可播放資料' },
]

interface JobProgressProps {
  job: Job
  onRetry: () => void
  retrying?: boolean
}

export default function JobProgress({ job, onRetry, retrying = false }: JobProgressProps) {
  const isFailed = job.status === 'failed'
  const isDone = job.status === 'done'

  return (
    <section className="panel overflow-hidden" aria-live="polite">
      <div className="border-b border-white/8 bg-slate-900/55 px-5 py-4 sm:px-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-white">處理進度</p>
            <p className="mt-1 text-sm text-slate-400">{job.message || '正在準備工作…'}</p>
          </div>
          <span className="rounded-full bg-indigo-400/10 px-2.5 py-1 text-xs font-medium text-indigo-200">
            {Math.round(job.progress * 100)}%
          </span>
        </div>
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-slate-800">
          <div
            className={`h-full rounded-full transition-all duration-500 ${isFailed ? 'bg-rose-500' : 'bg-gradient-to-r from-indigo-500 to-violet-400'}`}
            style={{ width: `${Math.max(2, Math.min(100, job.progress * 100))}%` }}
          />
        </div>
      </div>

      <ol className="divide-y divide-white/6 px-5 py-1 sm:px-6">
        {steps.map((step, index) => {
          const isCurrent = !isDone && !isFailed && job.step === step.id
          const isComplete = isDone || index < job.step_index
          const isError = isFailed && job.step === step.id
          return (
            <li key={step.id} className="flex items-center gap-4 py-3.5">
              <span
                className={`grid size-8 shrink-0 place-items-center rounded-full border ${
                  isError
                    ? 'border-rose-400/60 bg-rose-500/15 text-rose-300'
                    : isComplete
                      ? 'border-emerald-400/60 bg-emerald-500/15 text-emerald-300'
                      : isCurrent
                        ? 'border-indigo-300/70 bg-indigo-400/15 text-indigo-200'
                        : 'border-slate-700 bg-slate-900 text-slate-600'
                }`}
              >
                {isError ? (
                  <CircleAlert size={16} aria-label="失敗" />
                ) : isComplete ? (
                  <Check size={16} aria-label="完成" />
                ) : isCurrent ? (
                  <LoaderCircle className="animate-spin" size={16} aria-label="進行中" />
                ) : (
                  <span className="text-xs">{index + 1}</span>
                )}
              </span>
              <span>
                <span className={`block text-sm font-medium ${isCurrent ? 'text-white' : 'text-slate-300'}`}>{step.label}</span>
                <span className="block text-xs text-slate-500">{step.description}</span>
              </span>
            </li>
          )
        })}
      </ol>

      {isFailed && (
        <div className="border-t border-rose-400/15 bg-rose-950/20 px-5 py-4 sm:px-6">
          <p className="flex items-start gap-2 text-sm text-rose-200">
            <CircleAlert className="mt-0.5 shrink-0" size={16} aria-hidden="true" />
            <span>{job.error || '工作未能完成，請確認來源後重試。'}</span>
          </p>
          <button
            type="button"
            onClick={onRetry}
            disabled={retrying}
            className="mt-3 rounded-lg bg-rose-500 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-rose-400 disabled:opacity-50"
          >
            {retrying ? '正在重新建立工作…' : '重新處理'}
          </button>
        </div>
      )}
    </section>
  )
}
