import { Camera, CameraOff, Circle, Download, LoaderCircle, Scissors, Square } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { exportVideo, openInJiaying, type Subtitles } from '../api'
import type { AudioEngine, MicrophoneController } from './AudioEngine'

interface VideoPanelProps {
  songId: string
  engine: AudioEngine | null
  microphone: MicrophoneController
  subtitles: Subtitles | null
  audioRef: RefObject<HTMLAudioElement | null>
  onRecordingChange: (recording: boolean) => void
}

interface VideoSettings {
  fontFamily: string
  fontSize: number
  x: number
  y: number
  filter: string
  filterStrength: number
  burnSubtitles: boolean
}

const canvasWidth = 1280
const canvasHeight = 720
const defaultSettings: VideoSettings = { fontFamily: 'PingFang TC', fontSize: 48, x: 0.5, y: 0.85, filter: 'none', filterStrength: 0.8, burnSubtitles: true }
const fontOptions = [
  'PingFang TC',
  'Hiragino Maru Gothic ProN',
  'Hiragino Kaku Gothic ProN',
  'Noto Sans CJK TC',
  'Microsoft JhengHei',
  'Arial',
  'Helvetica Neue',
  'Georgia',
  'Courier New',
]

// 錄影濾鏡（參考剪映的濾鏡分類）：s 為強度 0~1，套用在鏡頭畫面上（字幕不套用）。
const filters: Record<string, { label: string; css: (s: number) => string }> = {
  none: { label: '原圖', css: () => 'none' },
  bright: { label: '美白', css: (s) => `brightness(${1 + 0.12 * s}) contrast(${1 - 0.05 * s}) saturate(${1 - 0.12 * s})` },
  vivid: { label: '鮮豔', css: (s) => `saturate(${1 + 0.5 * s}) contrast(${1 + 0.06 * s})` },
  warm: { label: '暖陽', css: (s) => `sepia(${0.28 * s}) saturate(${1 + 0.2 * s}) brightness(${1 + 0.04 * s})` },
  cool: { label: '冷冽', css: (s) => `saturate(${1 + 0.15 * s}) brightness(${1 + 0.04 * s}) hue-rotate(${-8 * s}deg)` },
  vintage: { label: '復古', css: (s) => `sepia(${0.45 * s}) contrast(${1 - 0.05 * s}) brightness(${1 - 0.03 * s}) saturate(${1 - 0.1 * s})` },
  mono: { label: '黑白', css: (s) => `grayscale(${s}) contrast(${1 + 0.06 * s})` },
}

function webcamError(error: unknown): string {
  if (error instanceof DOMException && ['NotAllowedError', 'SecurityError'].includes(error.name)) {
    return '鏡頭權限被拒絕。請在瀏覽器網站設定中允許此網站使用鏡頭後再試。'
  }
  if (error instanceof DOMException && error.name === 'NotFoundError') {
    return '找不到可用的鏡頭，請確認裝置已連接。'
  }
  return error instanceof Error ? `無法開啟鏡頭：${error.message}` : '無法開啟鏡頭。'
}

function videoSettingsKey(songId: string) {
  return `ktv-video-settings-${songId}`
}

function currentLine(subtitles: Subtitles | null, time: number) {
  const lines = subtitles?.lines || []
  return lines.find((line) => {
    if (line.blank || !line.text.trim() || time < line.start || time >= line.end) return false
    return line.words?.length ? line.words.some((word) => time >= word.start && time < word.end) : true
  })
}

/**
 * 依畫布寬度自動折行：有空格的語言（英/日羅馬字）按單詞折，
 * 無空格的語言（中日文）逐字元折。單一超長單詞也會強制折行。
 */
function wrapText(context: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  if (context.measureText(text).width <= maxWidth) return [text]
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length <= 1) {
    const lines: string[] = []
    let current = ''
    for (const char of text) {
      if (!current || context.measureText(current + char).width <= maxWidth) {
        current += char
      } else {
        lines.push(current)
        current = char
      }
    }
    if (current) lines.push(current)
    return lines
  }
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const test = current ? `${current} ${word}` : word
    if (context.measureText(test).width <= maxWidth) {
      current = test
    } else {
      if (current) lines.push(current)
      current = word
    }
  }
  if (current) lines.push(current)
  return lines
}

function formatRecordingTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`
}

export default function VideoPanel({ songId, engine, microphone, subtitles, audioRef, onRecordingChange }: VideoPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const webcamVideoRef = useRef<HTMLVideoElement>(null)
  const webcamStreamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const capturedStreamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const recordingStartedAtRef = useRef(0)
  const [webcamOpen, setWebcamOpen] = useState(false)
  const [recording, setRecording] = useState(false)
  const [recordingTime, setRecordingTime] = useState(0)
  const [exporting, setExporting] = useState(false)
  const [exportUrl, setExportUrl] = useState<string | null>(null)
  const [jiayingBusy, setJiayingBusy] = useState(false)
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const [settings, setSettings] = useState<VideoSettings>(defaultSettings)
  const { enable: enableMicrophone, error: microphoneIssue } = microphone

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(videoSettingsKey(songId))
      if (!stored) {
        setSettings(defaultSettings)
        return
      }
      const parsed = JSON.parse(stored) as Partial<VideoSettings>
      setSettings({
        fontFamily: fontOptions.includes(parsed.fontFamily || '') ? parsed.fontFamily! : defaultSettings.fontFamily,
        fontSize: typeof parsed.fontSize === 'number' ? Math.min(80, Math.max(28, parsed.fontSize)) : defaultSettings.fontSize,
        x: typeof parsed.x === 'number' ? Math.min(0.95, Math.max(0.05, parsed.x)) : defaultSettings.x,
        y: typeof parsed.y === 'number' ? Math.min(0.95, Math.max(0.05, parsed.y)) : defaultSettings.y,
        filter: parsed.filter && filters[parsed.filter] ? parsed.filter : defaultSettings.filter,
        filterStrength: typeof parsed.filterStrength === 'number' ? Math.min(1, Math.max(0, parsed.filterStrength)) : defaultSettings.filterStrength,
        burnSubtitles: parsed.burnSubtitles !== false,
      })
    } catch {
      setSettings(defaultSettings)
    }
  }, [songId])

  useEffect(() => {
    try {
      window.localStorage.setItem(videoSettingsKey(songId), JSON.stringify(settings))
    } catch {
      // 無痕模式或儲存空間滿時仍可在本次使用中調整字幕。
    }
  }, [settings, songId])

  const closeWebcam = useCallback(() => {
    webcamStreamRef.current?.getTracks().forEach((track) => track.stop())
    webcamStreamRef.current = null
    if (webcamVideoRef.current) webcamVideoRef.current.srcObject = null
    setWebcamOpen(false)
  }, [])

  const finishRecording = useCallback(async (mimeType: string) => {
    const chunks = chunksRef.current
    chunksRef.current = []
    capturedStreamRef.current?.getTracks().forEach((track) => track.stop())
    capturedStreamRef.current = null
    if (!chunks.length) {
      setError('錄影沒有取得任何資料，請確認鏡頭與麥克風後再試。')
      return
    }
    setExporting(true)
    setError('')
    try {
      const result = await exportVideo(songId, new Blob(chunks, { type: mimeType || 'video/webm' }))
      setExportUrl(result.url)
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : '匯出 Cover 影片失敗')
    } finally {
      setExporting(false)
    }
  }, [songId])

  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current
    if (recorder?.state === 'recording') recorder.stop()
    recorderRef.current = null
    setRecording(false)
    onRecordingChange(false)
  }, [onRecordingChange])

  useEffect(() => {
    return () => {
      stopRecording()
      closeWebcam()
      onRecordingChange(false)
    }
  }, [closeWebcam, onRecordingChange, stopRecording])

  useEffect(() => {
    if (!webcamOpen) return
    const canvas = canvasRef.current
    const video = webcamVideoRef.current
    if (!canvas || !video) return
    const context = canvas.getContext('2d')
    if (!context) return
    let frame = 0
    const render = () => {
      context.fillStyle = '#020617'
      context.fillRect(0, 0, canvasWidth, canvasHeight)
      // 鏡像顯示（像照鏡子）：預覽與錄製共用同一 canvas，所見即所得；字幕不鏡像。
      context.save()
      context.translate(canvasWidth, 0)
      context.scale(-1, 1)
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth && video.videoHeight) {
        const scale = Math.max(canvasWidth / video.videoWidth, canvasHeight / video.videoHeight)
        const width = video.videoWidth * scale
        const height = video.videoHeight * scale
        const filter = filters[settings.filter] || filters.none
        const filterCss = filter.css(settings.filterStrength)
        if (filterCss !== 'none') context.filter = filterCss
        context.drawImage(video, (canvasWidth - width) / 2, (canvasHeight - height) / 2, width, height)
        context.filter = 'none'
      }
      context.restore()

      const audio = audioRef.current
      const line = audio && !audio.paused ? currentLine(subtitles, audio.currentTime) : undefined
      if (settings.burnSubtitles && line) {
        const x = settings.x * canvasWidth
        const centerY = settings.y * canvasHeight
        context.save()
        context.textAlign = 'center'
        context.textBaseline = 'middle'
        context.lineJoin = 'round'
        context.strokeStyle = 'rgba(0, 0, 0, 0.9)'
        context.fillStyle = '#ffffff'
        context.shadowColor = 'rgba(0, 0, 0, 0.86)'
        context.shadowBlur = 8

        // 自動折行：超過兩行時縮小字體再試，避免歌詞超出畫面
        const maxWidth = canvasWidth - 80
        let drawSize = settings.fontSize
        context.font = `800 ${drawSize}px "${settings.fontFamily}"`
        let textLines = wrapText(context, line.text, maxWidth)
        while (textLines.length > 2 && drawSize > settings.fontSize * 0.6) {
          drawSize = Math.max(20, Math.round(drawSize * 0.85))
          context.font = `800 ${drawSize}px "${settings.fontFamily}"`
          textLines = wrapText(context, line.text, maxWidth)
        }
        const lineHeight = Math.round(drawSize * 1.25)
        const hasRomaji = subtitles?.language === 'ja' && Boolean(line.romaji)
        const romajiHeight = hasRomaji ? Math.max(18, Math.round(drawSize * 0.62)) : 0
        const blockHeight = textLines.length * lineHeight + romajiHeight
        // 垂直邊界保護：整塊字幕保持在畫布內
        const minTop = lineHeight / 2
        const maxTop = Math.max(minTop, canvasHeight - blockHeight - lineHeight / 2)
        const top = Math.min(Math.max(centerY - blockHeight / 2, minTop), maxTop)
        context.lineWidth = Math.max(3, drawSize * 0.11)
        textLines.forEach((textLine, index) => {
          const ty = top + index * lineHeight + lineHeight / 2
          context.strokeText(textLine, x, ty)
          context.fillText(textLine, x, ty)
        })
        if (hasRomaji && line.romaji) {
          context.font = `600 ${Math.max(20, drawSize * 0.48)}px "${settings.fontFamily}"`
          context.lineWidth = Math.max(2, drawSize * 0.055)
          const romajiY = top + textLines.length * lineHeight + romajiHeight / 2
          context.strokeText(line.romaji, x, romajiY)
          context.fillText(line.romaji, x, romajiY)
        }
        context.restore()
      }
      frame = window.requestAnimationFrame(render)
    }
    frame = window.requestAnimationFrame(render)
    return () => window.cancelAnimationFrame(frame)
  }, [audioRef, settings, subtitles, webcamOpen])

  useEffect(() => {
    if (!recording) {
      setRecordingTime(0)
      return
    }
    let frame = 0
    const updateTime = () => {
      setRecordingTime((performance.now() - recordingStartedAtRef.current) / 1000)
      frame = window.requestAnimationFrame(updateTime)
    }
    frame = window.requestAnimationFrame(updateTime)
    return () => window.cancelAnimationFrame(frame)
  }, [recording])

  const openWebcam = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('此瀏覽器不支援使用鏡頭。')
      return
    }
    setError('')
    let stream: MediaStream | null = null
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: false })
      webcamStreamRef.current = stream
      const video = webcamVideoRef.current
      if (video) {
        video.srcObject = stream
        await video.play()
      }
      setWebcamOpen(true)
    } catch (cameraError) {
      stream?.getTracks().forEach((track) => track.stop())
      if (webcamStreamRef.current === stream) webcamStreamRef.current = null
      if (webcamVideoRef.current) webcamVideoRef.current.srcObject = null
      setError(webcamError(cameraError))
    }
  }

  const startRecording = async () => {
    if (!engine || !canvasRef.current || !webcamOpen) return
    setError('')
    setExportUrl(null)
    const microphoneEnabled = await enableMicrophone()
    if (!microphoneEnabled) return
    if (!window.MediaRecorder) {
      setError('此瀏覽器不支援 MediaRecorder 錄影。')
      return
    }
    try {
      await engine.resume()
      const videoStream = canvasRef.current.captureStream(30)
      const combined = new MediaStream([
        ...videoStream.getVideoTracks(),
        // 複製音訊軌，停止匯出 stream 時不會讓 AudioEngine 的混音 destination ended。
        ...engine.getRecordStream().getAudioTracks().map((track) => track.clone()),
      ])
      const mimeType = ['video/mp4', 'video/webm;codecs=vp8,opus'].find((type) => MediaRecorder.isTypeSupported(type))
      const recorder = mimeType
        ? new MediaRecorder(combined, { mimeType, audioBitsPerSecond: 256_000 })
        : new MediaRecorder(combined, { audioBitsPerSecond: 256_000 })
      chunksRef.current = []
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }
      recorder.onerror = () => setError('錄影過程發生錯誤，請重新開始。')
      recorder.onstop = () => {
        recorderRef.current = null
        void finishRecording(recorder.mimeType)
      }
      capturedStreamRef.current = combined
      recorderRef.current = recorder
      recorder.start(250)
      recordingStartedAtRef.current = performance.now()
      setRecording(true)
      onRecordingChange(true)
    } catch (recordError) {
      setError(recordError instanceof Error ? `無法開始錄影：${recordError.message}` : '無法開始錄影。')
    }
  }

  const updateSubtitlePosition = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (recording) return
    const canvas = canvasRef.current
    if (!canvas) return
    const bounds = canvas.getBoundingClientRect()
    setSettings((current) => ({
      ...current,
      x: Math.min(0.95, Math.max(0.05, (event.clientX - bounds.left) / bounds.width)),
      y: Math.min(0.95, Math.max(0.05, (event.clientY - bounds.top) / bounds.height)),
    }))
  }

  return (
    <section className="panel overflow-hidden p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-white">Cover 錄影</h2>
          <p className="text-xs text-slate-500">鏡頭與混音伴奏會一起輸出；字幕可選擇是否燒錄</p>
        </div>
        {!webcamOpen ? (
          <button type="button" onClick={() => void openWebcam()} className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-400/40 bg-indigo-500/12 px-3 py-2 text-xs font-semibold text-indigo-100 transition hover:bg-indigo-500/22">
            <Camera size={15} />開啟鏡頭
          </button>
        ) : (
          <button type="button" onClick={closeWebcam} disabled={recording} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-slate-400 transition hover:bg-slate-800 hover:text-slate-200 disabled:opacity-50">
            <CameraOff size={15} />關閉鏡頭
          </button>
        )}
      </div>

      <div className="relative mt-4 overflow-hidden rounded-xl border border-white/8 bg-slate-950">
        <video ref={webcamVideoRef} className="hidden" muted playsInline />
        <canvas
          ref={canvasRef}
          width={canvasWidth}
          height={canvasHeight}
          onPointerDown={(event) => {
            if (recording || !settings.burnSubtitles || !subtitles?.lines.length) return
            event.currentTarget.setPointerCapture(event.pointerId)
            setDragging(true)
            updateSubtitlePosition(event)
          }}
          onPointerMove={(event) => {
            if (dragging) updateSubtitlePosition(event)
          }}
          onPointerUp={(event) => {
            setDragging(false)
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
          }}
          className={`block w-full bg-slate-950 ${recording || !settings.burnSubtitles || !subtitles?.lines.length ? 'cursor-default' : 'cursor-move'}`}
        />
        {webcamOpen && <span className="pointer-events-none absolute left-3 top-3 rounded-md bg-slate-950/75 px-2 py-1 text-[11px] text-slate-300">{recording ? '錄影中，字幕設定已鎖定' : settings.burnSubtitles ? '拖曳字幕可調整位置' : '本次錄影不燒錄字幕'}</span>}
        {!subtitles?.lines.length && webcamOpen && <span className="pointer-events-none absolute right-3 top-3 rounded-md bg-amber-500/15 px-2 py-1 text-[11px] text-amber-100">此歌無字幕</span>}
        {!webcamOpen && <div className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-slate-500">開啟鏡頭後即可預覽字幕</div>}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <label className="text-xs text-slate-400">
          字型
          <select value={settings.fontFamily} disabled={recording} onChange={(event) => setSettings((current) => ({ ...current, fontFamily: event.target.value }))} className="mt-1.5 block w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 disabled:opacity-50">
            {fontOptions.map((font) => <option key={font} value={font}>{font}</option>)}
          </select>
        </label>
        <label className="min-w-48 text-xs text-slate-400">
          字體大小 <span className="tabular-nums text-indigo-200">{settings.fontSize}px</span>
          <input type="range" min="28" max="80" value={settings.fontSize} disabled={recording} onChange={(event) => setSettings((current) => ({ ...current, fontSize: Number(event.target.value) }))} className="mt-2 block w-full accent-indigo-400 disabled:opacity-50" aria-label="字幕字體大小" />
        </label>
      </div>

      <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-white/6 bg-slate-950/45 p-3 text-sm text-slate-200">
        <input
          type="checkbox"
          checked={settings.burnSubtitles}
          disabled={recording}
          onChange={(event) => setSettings((current) => ({ ...current, burnSubtitles: event.target.checked }))}
          className="mt-0.5 size-4 accent-indigo-400 disabled:opacity-50"
        />
        <span>
          <span className="block font-medium">錄影燒錄字幕</span>
          <span className="mt-0.5 block text-xs text-slate-500">關閉後仍可在錄唱室看到歌詞，但下載的 Cover 影片不會加入字幕，方便自行剪輯。</span>
        </span>
      </label>

      <div className="mt-4 rounded-xl border border-white/6 bg-slate-950/45 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-slate-400">錄影濾鏡（會錄進影片）</span>
          {settings.filter !== 'none' && (
            <label className="flex items-center gap-2 text-xs text-slate-400">
              強度
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={settings.filterStrength}
                disabled={recording}
                onChange={(event) => setSettings((current) => ({ ...current, filterStrength: Number(event.target.value) }))}
                className="h-1.5 w-28 accent-indigo-400 disabled:opacity-50"
                aria-label="濾鏡強度"
              />
              <span className="w-9 text-right tabular-nums">{Math.round(settings.filterStrength * 100)}%</span>
            </label>
          )}
        </div>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {Object.entries(filters).map(([key, filter]) => (
            <button
              key={key}
              type="button"
              disabled={recording}
              onClick={() => setSettings((current) => ({ ...current, filter: key }))}
              className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition disabled:opacity-50 ${
                settings.filter === key
                  ? 'border border-indigo-400/60 bg-indigo-500/20 text-indigo-100'
                  : 'border border-slate-700 bg-slate-900 text-slate-300 hover:border-indigo-400/50 hover:text-indigo-100'
              }`}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {!recording ? (
          <button type="button" onClick={() => void startRecording()} disabled={!engine || !webcamOpen || exporting} className="inline-flex items-center gap-2 rounded-xl bg-rose-500 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-rose-950/35 transition hover:bg-rose-400 disabled:opacity-50">
            <Circle className="fill-current" size={16} />開始錄影
          </button>
        ) : (
          <button type="button" onClick={stopRecording} className="inline-flex items-center gap-2 rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-bold text-slate-950 transition hover:bg-white">
            <Square className="fill-current" size={15} />停止並匯出
          </button>
        )}
        {recording && <span className="inline-flex items-center gap-2 text-sm font-semibold tabular-nums text-rose-200"><Circle className="recording-pulse fill-current" size={13} />{formatRecordingTime(recordingTime)}</span>}
        {exporting && <span className="inline-flex items-center gap-2 text-sm text-indigo-200"><LoaderCircle className="animate-spin" size={17} />正在轉成 MP4…</span>}
        {exportUrl && !exporting && (
          <>
            <a href={exportUrl} download="cover.mp4" className="inline-flex items-center gap-2 rounded-lg border border-emerald-400/35 bg-emerald-500/10 px-3 py-2 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-500/18">
              <Download size={16} />下載 Cover 影片
            </a>
            <button
              type="button"
              onClick={() => {
                setJiayingBusy(true)
                setError('')
                void openInJiaying(songId)
                  .catch((openError) => setError(openError instanceof Error ? openError.message : '開啟剪映失敗'))
                  .finally(() => setJiayingBusy(false))
              }}
              disabled={jiayingBusy}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-600 bg-slate-800/60 px-3 py-2 text-sm font-semibold text-slate-200 transition hover:border-indigo-400/50 hover:text-indigo-100 disabled:opacity-50"
            >
              {jiayingBusy ? <LoaderCircle className="animate-spin" size={16} /> : <Scissors size={16} />}
              在剪映中開啟
            </button>
          </>
        )}
      </div>
      {(error || microphoneIssue) && <p className="mt-4 rounded-lg border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-sm leading-6 text-rose-200">{error || microphoneIssue}</p>}
    </section>
  )
}
