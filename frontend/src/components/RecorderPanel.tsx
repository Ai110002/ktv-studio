import { Circle, Download, LoaderCircle, Mic, MicOff, Square, Volume2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { exportRecording } from '../api'
import type { AudioEngine } from './AudioEngine'

interface RecorderPanelProps {
  songId: string
  engine: AudioEngine | null
}

interface MicChain {
  stream: MediaStream
  source: MediaStreamAudioSourceNode
  analyser: AnalyserNode
  gain: GainNode
  frame: number
}

function microphoneError(error: unknown): string {
  if (error instanceof DOMException && ['NotAllowedError', 'SecurityError'].includes(error.name)) {
    return '麥克風權限被拒絕。請在瀏覽器網站設定中允許此網站使用麥克風後再試。'
  }
  if (error instanceof DOMException && error.name === 'NotFoundError') {
    return '找不到可用的麥克風，請確認裝置已連接。'
  }
  return error instanceof Error ? `無法啟用麥克風：${error.message}` : '無法啟用麥克風。'
}

export default function RecorderPanel({ songId, engine }: RecorderPanelProps) {
  const micChainRef = useRef<MicChain | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const [micReady, setMicReady] = useState(false)
  const [micLevel, setMicLevel] = useState(0)
  const [micVolume, setMicVolume] = useState(1)
  const [recording, setRecording] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportUrl, setExportUrl] = useState<string | null>(null)
  const [error, setError] = useState('')

  const releaseMicrophone = () => {
    const chain = micChainRef.current
    if (!chain) return
    window.cancelAnimationFrame(chain.frame)
    chain.source.disconnect()
    chain.analyser.disconnect()
    chain.gain.disconnect()
    chain.stream.getTracks().forEach((track) => track.stop())
    micChainRef.current = null
    setMicReady(false)
    setMicLevel(0)
  }

  useEffect(() => {
    return () => {
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
      releaseMicrophone()
    }
    // 音訊引擎改變時，舊的麥克風節點不能繼續連到已關閉的 destination。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine])

  const enableMicrophone = async (): Promise<MicChain | null> => {
    if (!engine) {
      setError('音訊引擎尚未準備完成，請稍候再試。')
      return null
    }
    if (micChainRef.current) return micChainRef.current
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('此瀏覽器不支援麥克風錄音。')
      return null
    }

    try {
      await engine.resume()
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false },
      })
      const source = engine.context.createMediaStreamSource(stream)
      const analyser = engine.context.createAnalyser()
      analyser.fftSize = 256
      const gain = engine.context.createGain()
      gain.gain.value = micVolume
      source.connect(analyser)
      analyser.connect(gain)
      gain.connect(engine.recordDestination)

      const samples = new Uint8Array(analyser.fftSize)
      const chain: MicChain = { stream, source, analyser, gain, frame: 0 }
      const measure = () => {
        analyser.getByteTimeDomainData(samples)
        let sum = 0
        for (const sample of samples) {
          const value = (sample - 128) / 128
          sum += value * value
        }
        setMicLevel(Math.min(1, Math.sqrt(sum / samples.length) * 3.5))
        chain.frame = window.requestAnimationFrame(measure)
      }
      chain.frame = window.requestAnimationFrame(measure)
      micChainRef.current = chain
      setMicReady(true)
      setError('')
      return chain
    } catch (micError) {
      setError(microphoneError(micError))
      return null
    }
  }

  const finishRecording = async (mimeType: string) => {
    const chunks = chunksRef.current
    chunksRef.current = []
    if (!chunks.length) {
      setError('錄音沒有取得任何音訊資料，請確認麥克風後再試。')
      return
    }
    setExporting(true)
    setError('')
    try {
      const result = await exportRecording(songId, new Blob(chunks, { type: mimeType || 'audio/webm' }))
      setExportUrl(result.url)
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : '匯出錄音成品失敗')
    } finally {
      setExporting(false)
    }
  }

  const startRecording = async () => {
    if (!engine) return
    setError('')
    setExportUrl(null)
    const chain = await enableMicrophone()
    if (!chain || !window.MediaRecorder) {
      if (!window.MediaRecorder) setError('此瀏覽器不支援 MediaRecorder 錄音。')
      return
    }
    try {
      await engine.resume()
      const supportedMime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((type) => MediaRecorder.isTypeSupported(type))
      const recorder = supportedMime
        ? new MediaRecorder(engine.recordDestination.stream, { mimeType: supportedMime })
        : new MediaRecorder(engine.recordDestination.stream)
      chunksRef.current = []
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }
      recorder.onerror = () => setError('錄音過程發生錯誤，請重新開始。')
      recorder.onstop = () => {
        recorderRef.current = null
        void finishRecording(recorder.mimeType)
      }
      recorderRef.current = recorder
      recorder.start(250)
      setRecording(true)
    } catch (recordError) {
      setError(recordError instanceof Error ? `無法開始錄音：${recordError.message}` : '無法開始錄音。')
    }
  }

  const stopRecording = () => {
    const recorder = recorderRef.current
    if (!recorder || recorder.state !== 'recording') return
    recorder.stop()
    setRecording(false)
  }

  const updateMicVolume = (value: number) => {
    setMicVolume(value)
    const chain = micChainRef.current
    if (chain && engine) chain.gain.gain.setTargetAtTime(value, engine.context.currentTime, 0.015)
  }

  return (
    <section className="panel p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={`grid size-8 place-items-center rounded-lg ${recording ? 'bg-rose-500/20 text-rose-300' : 'bg-indigo-500/15 text-indigo-300'}`}>
            {recording ? <Circle className="recording-pulse fill-current" size={17} /> : <Mic size={17} />}
          </span>
          <div>
            <h2 className="text-sm font-semibold text-white">錄唱</h2>
            <p className="text-xs text-slate-500">麥克風與 EQ 後伴奏會一起輸出</p>
          </div>
        </div>
        {!micReady ? (
          <button
            type="button"
            onClick={() => void enableMicrophone()}
            disabled={!engine || recording}
            className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-400/40 bg-indigo-500/12 px-3 py-2 text-xs font-semibold text-indigo-100 transition hover:bg-indigo-500/22 disabled:opacity-50"
          >
            <Mic size={15} />啟用麥克風
          </button>
        ) : (
          <button
            type="button"
            onClick={releaseMicrophone}
            disabled={recording}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-slate-400 transition hover:bg-slate-800 hover:text-slate-200 disabled:opacity-50"
          >
            <MicOff size={15} />關閉麥克風
          </button>
        )}
      </div>

      <div className="mt-5 rounded-xl border border-white/6 bg-slate-950/45 p-3">
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-400">麥克風音量</span>
          <span className={micReady ? 'text-emerald-300' : 'text-slate-600'}>{micReady ? '已連線' : '尚未啟用'}</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800">
          <div
            className={`meter-fill h-full rounded-full ${micLevel > 0.78 ? 'bg-rose-400' : micLevel > 0.48 ? 'bg-amber-300' : 'bg-emerald-400'}`}
            style={{ width: `${Math.max(1, micLevel * 100)}%` }}
          />
        </div>
        <label className="mt-4 flex items-center gap-2 text-xs text-slate-400">
          <Volume2 size={15} className="text-indigo-300" />
          <input
            type="range"
            min="0"
            max="2"
            step="0.01"
            value={micVolume}
            onChange={(event) => updateMicVolume(Number(event.target.value))}
            className="h-1.5 min-w-0 flex-1 accent-indigo-400"
            aria-label="麥克風音量"
            disabled={!micReady}
          />
          <span className="w-9 text-right tabular-nums">{Math.round(micVolume * 100)}%</span>
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {!recording ? (
          <button
            type="button"
            onClick={() => void startRecording()}
            disabled={!engine || exporting}
            className="inline-flex items-center gap-2 rounded-xl bg-rose-500 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-rose-950/35 transition hover:bg-rose-400 disabled:opacity-50"
          >
            <Circle className="fill-current" size={16} />開始錄音
          </button>
        ) : (
          <button
            type="button"
            onClick={stopRecording}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-bold text-slate-950 transition hover:bg-white"
          >
            <Square className="fill-current" size={15} />停止並匯出
          </button>
        )}
        {exporting && <span className="inline-flex items-center gap-2 text-sm text-indigo-200"><LoaderCircle className="animate-spin" size={17} />正在轉成 MP3…</span>}
        {exportUrl && !exporting && (
          <a
            href={exportUrl}
            download="cover.mp3"
            className="inline-flex items-center gap-2 rounded-lg border border-emerald-400/35 bg-emerald-500/10 px-3 py-2 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-500/18"
          >
            <Download size={16} />下載錄唱成品
          </a>
        )}
      </div>
      {error && <p className="mt-4 rounded-lg border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-sm leading-6 text-rose-200">{error}</p>}
    </section>
  )
}
