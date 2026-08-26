import { SlidersHorizontal, Volume2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { EQ_FREQUENCIES, type AudioEngine } from './AudioEngine'

const presets = {
  平坦: [0, 0, 0, 0, 0, 0, 0],
  柔和: [0, 1, 2, 2, 0, -2, -4],
  去刺耳: [0, 0, 0, 0, -2, -4, -3],
  明亮: [0, 0, 0, 0, 1, 3, 4],
  低音加強: [4, 2, 0, 0, 0, 0, 0],
} as const

interface EqualizerProps {
  engine: AudioEngine | null
  masterVolume: number
  onMasterVolumeChange: (value: number) => void
}

export default function Equalizer({ engine, masterVolume, onMasterVolumeChange }: EqualizerProps) {
  const [gains, setGains] = useState<number[]>([0, 0, 0, 0, 0, 0, 0])

  useEffect(() => {
    if (!engine) return
    engine.masterGain.gain.setTargetAtTime(masterVolume, engine.context.currentTime, 0.015)
  }, [engine, masterVolume])

  const applyGains = (next: readonly number[]) => {
    const normalized = [...next]
    setGains(normalized)
    if (!engine) return
    engine.filters.forEach((filter, index) => {
      filter.gain.setTargetAtTime(normalized[index] ?? 0, engine.context.currentTime, 0.015)
    })
  }

  return (
    <section className="panel p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-lg bg-violet-500/15 text-violet-300"><SlidersHorizontal size={17} /></span>
          <div>
            <h2 className="text-sm font-semibold text-white">調音台</h2>
            <p className="text-xs text-slate-500">7 段伴奏 EQ</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5" aria-label="EQ 預設">
          {Object.keys(presets).map((name) => (
            <button
              type="button"
              key={name}
              onClick={() => applyGains(presets[name as keyof typeof presets])}
              className="rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-300 transition hover:border-indigo-400/50 hover:text-indigo-100"
            >
              {name}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5 grid grid-cols-7 gap-1.5 rounded-xl border border-white/6 bg-slate-950/45 px-2 py-4 sm:gap-3 sm:px-4">
        {EQ_FREQUENCIES.map((frequency, index) => (
          <label key={frequency} className="flex min-w-0 flex-col items-center gap-2 text-center">
            <span className="text-[11px] font-semibold tabular-nums text-indigo-200">{gains[index] > 0 ? '+' : ''}{gains[index]}<span className="hidden sm:inline"> dB</span></span>
            <input
              className="eq-slider h-32 w-4 accent-indigo-400"
              type="range"
              min="-12"
              max="12"
              step="1"
              value={gains[index]}
              aria-label={`${frequency} Hz 增益`}
              onChange={(event) => {
                const next = [...gains]
                next[index] = Number(event.target.value)
                applyGains(next)
              }}
              disabled={!engine}
            />
            <span className="text-[10px] text-slate-500">{frequency >= 1000 ? `${frequency / 1000}k` : frequency}</span>
          </label>
        ))}
      </div>

      <label className="mt-5 flex items-center gap-3 rounded-lg bg-slate-950/45 px-3 py-2.5">
        <Volume2 className="shrink-0 text-indigo-300" size={18} />
        <span className="min-w-20 text-sm font-medium text-slate-200">伴奏音量</span>
        <input
          type="range"
          min="0"
          max="1.2"
          step="0.01"
          value={masterVolume}
          aria-label="伴奏總音量"
          className="h-1.5 min-w-0 flex-1 accent-indigo-400"
          onChange={(event) => onMasterVolumeChange(Number(event.target.value))}
          disabled={!engine}
        />
        <span className="w-10 text-right text-xs tabular-nums text-slate-400">{Math.round(masterVolume * 100)}%</span>
      </label>
    </section>
  )
}
