import {
  ArrowLeft,
  CircleAlert,
  LoaderCircle,
  Pause,
  Play,
  SkipBack,
  Volume2,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { audioUrl, formatDuration, getJob, getSong, getSubtitles, submitLyrics, type Song, type Subtitles } from '../api'
import { useAudioEngine } from '../components/AudioEngine'
import Equalizer from '../components/Equalizer'
import KTVLyrics from '../components/KTVLyrics'
import RecorderPanel from '../components/RecorderPanel'
import SubtitleEditor from '../components/SubtitleEditor'
import VideoPanel from '../components/VideoPanel'

function subtitleSourceLabel(subtitles: Subtitles | null): string {
  if (subtitles?.source === 'youtube') return 'YouTube 字幕'
  if (subtitles?.source === 'lrclib') return '歌詞庫'
  if (subtitles?.source === 'whisper') return '語音辨識'
  if (subtitles?.source === 'manual') return '手動編輯'
  return '無字幕'
}

function LyricsRetranscriptionPanel({
  songId,
  subtitles,
  onSubtitlesUpdated,
}: {
  songId: string
  subtitles: Subtitles | null
  onSubtitlesUpdated: (subtitles: Subtitles) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [lyricsText, setLyricsText] = useState('')
  const [jobId, setJobId] = useState<string | null>(null)
  const [retranscribing, setRetranscribing] = useState(false)
  const [progressMessage, setProgressMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!jobId) return
    let active = true
    let polling = false

    const finishWithError = (message: string) => {
      if (!active) return
      setError(message)
      setProgressMessage('')
      setRetranscribing(false)
      setJobId(null)
    }

    const poll = async () => {
      if (!active || polling) return
      polling = true
      try {
        const job = await getJob(jobId)
        if (!active) return
        if (job.status === 'done') {
          try {
            const refreshed = await getSubtitles(songId)
            if (!active) return
            onSubtitlesUpdated(refreshed)
            setError('')
            setProgressMessage('')
            setRetranscribing(false)
            setJobId(null)
          } catch (refreshError) {
            finishWithError(refreshError instanceof Error ? `歌詞對齊已完成，但無法更新字幕：${refreshError.message}` : '歌詞對齊已完成，但無法更新字幕')
          }
          return
        }
        if (job.status === 'failed') {
          finishWithError(job.error || '歌詞對齊失敗，請稍後再試')
          return
        }
        setProgressMessage(`${job.message}（${Math.round(job.progress * 100)}%）`)
      } catch (pollError) {
        finishWithError(pollError instanceof Error ? `查詢歌詞對齊進度失敗：${pollError.message}` : '查詢歌詞對齊進度失敗')
      } finally {
        polling = false
      }
    }

    void poll()
    const timer = window.setInterval(() => void poll(), 1_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [jobId, onSubtitlesUpdated, songId])

  const toggleEditor = () => {
    if (retranscribing) return
    if (!expanded) {
      setLyricsText(subtitles?.lines.map((line) => line.text).join('\n') || '')
      setError('')
    }
    setExpanded((current) => !current)
  }

  const handleSubmit = async () => {
    const text = lyricsText.trim()
    if (!text) {
      setError('請先貼上正確歌詞')
      return
    }
    setError('')
    setProgressMessage('正在建立歌詞對齊工作…')
    setRetranscribing(true)
    try {
      const result = await submitLyrics(songId, text)
      setJobId(result.job_id)
    } catch (submitError) {
      setRetranscribing(false)
      setError(submitError instanceof Error ? `送出歌詞對齊失敗：${submitError.message}` : '送出歌詞對齊失敗，請稍後再試')
    }
  }

  return (
    <section className="space-y-3">
      <button
        type="button"
        onClick={toggleEditor}
        disabled={retranscribing}
        className="inline-flex items-center justify-center rounded-xl border border-indigo-400/25 bg-indigo-500/10 px-4 py-2.5 text-sm font-semibold text-indigo-100 transition hover:border-indigo-300/45 hover:bg-indigo-500/15 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {expanded ? '收起歌詞編輯' : '字幕不準？貼上正確歌詞對齊時間'}
      </button>

      {expanded && (
        <div className="rounded-2xl border border-slate-700/70 bg-slate-950/45 p-4 sm:p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h2 className="font-semibold text-slate-100">以正確歌詞對齊時間</h2>
              <p className="mt-1 text-sm text-slate-500">會完整保留你貼上的文字，只沿用既有字幕時間軸；不會重新辨識、下載或去人聲。</p>
            </div>
            <span className="text-xs tabular-nums text-slate-600">{lyricsText.length}/5000</span>
          </div>
          <label htmlFor="lyrics-user-input" className="sr-only">正確歌詞</label>
          <textarea
            id="lyrics-user-input"
            value={lyricsText}
            onChange={(event) => setLyricsText(event.target.value)}
            maxLength={5000}
            disabled={retranscribing}
            rows={9}
            placeholder="貼上這首歌的歌詞，系統只會把原文對齊既有時間軸"
            className="mt-4 min-h-48 w-full resize-y rounded-xl border border-slate-700 bg-slate-900/85 px-3 py-3 text-sm leading-6 text-slate-100 outline-none placeholder:text-slate-600 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/20 disabled:cursor-not-allowed disabled:opacity-60"
          />
          {error && <p className="mt-3 text-sm text-rose-300">{error}</p>}
          {retranscribing && (
            <p className="mt-3 flex items-center gap-2 text-sm text-indigo-200">
              <LoaderCircle className="animate-spin" size={16} />{progressMessage || '正在對齊歌詞時間'}
            </p>
          )}
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={retranscribing || !lyricsText.trim()}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-950/40 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {retranscribing && <LoaderCircle className="animate-spin" size={16} />}對齊時間
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

function StudioWorkspace({
  song,
  subtitles,
  onSubtitlesUpdated,
}: {
  song: Song
  subtitles: Subtitles | null
  onSubtitlesUpdated: (subtitles: Subtitles) => void
}) {
  const navigate = useNavigate()
  const audioRef = useRef<HTMLAudioElement>(null)
  const { engine, error: engineError } = useAudioEngine(audioRef)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(song.duration || 0)
  const [masterVolume, setMasterVolume] = useState(0.9)
  const [playError, setPlayError] = useState('')
  const [videoRecording, setVideoRecording] = useState(false)
  const editorSubtitles = useMemo<Subtitles>(
    () => subtitles || { language: song.language || 'und', source: 'manual', title: song.title, lines: [] },
    [song.language, song.title, subtitles],
  )

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const syncTime = () => setCurrentTime(audio.currentTime)
    const syncDuration = () => setDuration(Number.isFinite(audio.duration) ? audio.duration : song.duration)
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    const onEnded = () => setPlaying(false)
    audio.addEventListener('timeupdate', syncTime)
    audio.addEventListener('loadedmetadata', syncDuration)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('ended', onEnded)
    return () => {
      audio.removeEventListener('timeupdate', syncTime)
      audio.removeEventListener('loadedmetadata', syncDuration)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('ended', onEnded)
    }
  }, [song.duration])

  const togglePlayback = useCallback(async () => {
    const audio = audioRef.current
    if (!audio) return
    setPlayError('')
    try {
      await engine?.resume()
      if (audio.paused) await audio.play()
      else audio.pause()
    } catch (error) {
      setPlayError(error instanceof Error ? `無法播放音訊：${error.message}` : '無法播放音訊。')
    }
  }, [engine])

  const seek = (next: number) => {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = next
    setCurrentTime(next)
  }

  const changeMasterVolume = (value: number) => {
    setMasterVolume(value)
    if (engine) engine.masterGain.gain.setTargetAtTime(value, engine.context.currentTime, 0.015)
  }

  return (
    <div className="space-y-5">
      <audio ref={audioRef} src={audioUrl(song.id, 'instrumental')} preload="auto" />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <button
            type="button"
            onClick={() => navigate('/library')}
            className="inline-flex items-center gap-1.5 text-sm text-slate-500 transition hover:text-indigo-200"
          >
            <ArrowLeft size={15} />返回歌曲庫
          </button>
          <h1 className="mt-2 truncate text-2xl font-bold tracking-tight text-white sm:text-3xl">{song.title}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-400">
            <span>{song.artist || '未知歌手'} <span className="mx-1 text-slate-700">·</span> {song.language === 'ja' ? '日文字幕含羅馬拼音' : song.language === 'zh' ? '繁體中文字幕' : 'KTV 字幕'}</span>
            <span className="rounded-full border border-indigo-400/20 bg-indigo-500/10 px-2.5 py-1 text-[11px] font-semibold text-indigo-200">字幕來源：{subtitleSourceLabel(subtitles)}</span>
          </div>
        </div>
        <span className="rounded-full border border-indigo-400/20 bg-indigo-500/10 px-3 py-1.5 text-xs font-semibold text-indigo-200">本機錄唱室</span>
      </div>

      <section className="panel p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void togglePlayback()}
            className="grid size-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-lg shadow-indigo-950/60 transition hover:brightness-110"
            aria-label={playing ? '暫停' : '播放'}
          >
            {playing ? <Pause className="fill-current" size={19} /> : <Play className="ml-0.5 fill-current" size={19} />}
          </button>
          <button
            type="button"
            onClick={() => seek(Math.max(0, currentTime - 5))}
            className="grid size-9 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-800 hover:text-slate-200"
            aria-label="倒退五秒"
          >
            <SkipBack size={17} />
          </button>
          <span className="w-20 text-center text-xs tabular-nums text-slate-400">{formatDuration(currentTime)} / {formatDuration(duration)}</span>
          <input
            type="range"
            min="0"
            max={Math.max(duration, 0.01)}
            step="0.01"
            value={Math.min(currentTime, duration || currentTime)}
            onChange={(event) => seek(Number(event.target.value))}
            className="h-1.5 min-w-36 flex-1 accent-indigo-400"
            aria-label="播放進度"
          />
          <label className="flex items-center gap-2 rounded-lg bg-slate-950/55 px-2.5 py-2">
            <Volume2 size={16} className="text-indigo-300" aria-hidden="true" />
            <input
              type="range"
              min="0"
              max="1.2"
              step="0.01"
              value={masterVolume}
              onChange={(event) => changeMasterVolume(Number(event.target.value))}
              className="h-1.5 w-20 accent-indigo-400"
              aria-label="播放音量"
            />
          </label>
        </div>
        {playError && <p className="mt-3 text-sm text-rose-300">{playError}</p>}
      </section>

      {engineError && <p className="rounded-xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{engineError}</p>}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <VideoPanel songId={song.id} engine={engine} subtitles={subtitles} audioRef={audioRef} onRecordingChange={setVideoRecording} />
        <div className="space-y-4">
          <KTVLyrics subtitles={subtitles} audioRef={audioRef} />
          <SubtitleEditor
            songId={song.id}
            subtitles={editorSubtitles}
            audioRef={audioRef}
            duration={duration}
            onSubtitlesUpdated={onSubtitlesUpdated}
          />
          <LyricsRetranscriptionPanel songId={song.id} subtitles={subtitles} onSubtitlesUpdated={onSubtitlesUpdated} />
        </div>
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <Equalizer engine={engine} masterVolume={masterVolume} onMasterVolumeChange={changeMasterVolume} />
        <RecorderPanel songId={song.id} engine={engine} recordingLocked={videoRecording} />
      </div>
    </div>
  )
}

export default function StudioPage() {
  const { songId } = useParams<{ songId: string }>()
  const [song, setSong] = useState<Song | null>(null)
  const [subtitles, setSubtitles] = useState<Subtitles | null>(null)
  const [error, setError] = useState('')
  const handleSubtitlesUpdated = useCallback((updated: Subtitles) => setSubtitles(updated), [])

  useEffect(() => {
    if (!songId) return
    let active = true
    void Promise.all([
      getSong(songId),
      getSubtitles(songId).catch(() => null),
    ])
      .then(([loadedSong, loadedSubtitles]) => {
        if (!active) return
        setSong(loadedSong)
        setSubtitles(loadedSubtitles)
      })
      .catch((requestError) => {
        if (active) setError(requestError instanceof Error ? requestError.message : '讀取歌曲失敗')
      })
    return () => {
      active = false
    }
  }, [songId])

  if (error) {
    return (
      <div className="panel mx-auto grid min-h-72 max-w-xl place-items-center p-8 text-center">
        <div>
          <CircleAlert className="mx-auto text-rose-300" size={32} />
          <h1 className="mt-4 text-xl font-bold text-white">無法開啟錄唱室</h1>
          <p className="mt-2 text-sm text-slate-400">{error}</p>
        </div>
      </div>
    )
  }
  if (!song) {
    return <div className="flex min-h-80 items-center justify-center gap-2 text-slate-400"><LoaderCircle className="animate-spin" size={20} />正在載入錄唱室…</div>
  }
  return <StudioWorkspace song={song} subtitles={subtitles} onSubtitlesUpdated={handleSubtitlesUpdated} />
}
