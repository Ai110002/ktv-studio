import {
  ArrowLeft,
  CircleAlert,
  LoaderCircle,
  Pause,
  Play,
  SkipBack,
  Volume2,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { audioUrl, formatDuration, getSong, getSubtitles, type Song, type Subtitles } from '../api'
import { useAudioEngine } from '../components/AudioEngine'
import Equalizer from '../components/Equalizer'
import KTVLyrics from '../components/KTVLyrics'
import RecorderPanel from '../components/RecorderPanel'

function StudioWorkspace({ song, subtitles }: { song: Song; subtitles: Subtitles | null }) {
  const navigate = useNavigate()
  const audioRef = useRef<HTMLAudioElement>(null)
  const { engine, error: engineError } = useAudioEngine(audioRef)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(song.duration || 0)
  const [masterVolume, setMasterVolume] = useState(0.9)
  const [playError, setPlayError] = useState('')

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
          <p className="mt-1 text-sm text-slate-400">{song.artist || '未知歌手'} <span className="mx-1 text-slate-700">·</span> {song.language === 'ja' ? '日文字幕含羅馬拼音' : song.language === 'zh' ? '繁體中文字幕' : 'KTV 字幕'}</p>
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
      <KTVLyrics subtitles={subtitles} audioRef={audioRef} />
      <div className="grid gap-5 xl:grid-cols-2">
        <Equalizer engine={engine} masterVolume={masterVolume} onMasterVolumeChange={changeMasterVolume} />
        <RecorderPanel songId={song.id} engine={engine} />
      </div>
    </div>
  )
}

export default function StudioPage() {
  const { songId } = useParams<{ songId: string }>()
  const [song, setSong] = useState<Song | null>(null)
  const [subtitles, setSubtitles] = useState<Subtitles | null>(null)
  const [error, setError] = useState('')

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
  return <StudioWorkspace song={song} subtitles={subtitles} />
}
