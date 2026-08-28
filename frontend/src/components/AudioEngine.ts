import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

export const EQ_FREQUENCIES = [60, 150, 400, 1000, 2500, 6000, 12000] as const

export interface AudioEngine {
  context: AudioContext
  filters: BiquadFilterNode[]
  masterGain: GainNode
  recordDestination: MediaStreamAudioDestinationNode
  resume: () => Promise<void>
  getRecordStream: () => MediaStream
  getEstimatedOutputLatencyMs: () => number
}

interface EngineState {
  engine: AudioEngine | null
  error: string | null
}

/**
 * 將同一個 HTMLAudioElement 只建立一次 MediaElementSource，經過 EQ 後同時送往
 * 喇叭與錄音 destination。字幕及播放控制仍以 audio.currentTime 為唯一時間來源。
 */
export function useAudioEngine(audioRef: RefObject<HTMLAudioElement | null>): EngineState {
  const [state, setState] = useState<EngineState>({ engine: null, error: null })

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const Context = window.AudioContext || window.webkitAudioContext
    if (!Context) {
      setState({ engine: null, error: '此瀏覽器不支援 Web Audio，無法使用 EQ 與錄音混音。' })
      return
    }

    try {
      // 明確要求互動模式，優先降低播放與麥克風之間的額外軟體緩衝。
      // 藍牙耳機本身的傳輸延遲仍由作業系統與耳機硬體決定。
      const context = new Context({ latencyHint: 'interactive' })
      const source = context.createMediaElementSource(audio)
      const filters = EQ_FREQUENCIES.map((frequency) => {
        const filter = context.createBiquadFilter()
        filter.type = 'peaking'
        filter.frequency.value = frequency
        filter.Q.value = 1.1
        filter.gain.value = 0
        return filter
      })
      const masterGain = context.createGain()
      masterGain.gain.value = 0.9
      const recordDestination = context.createMediaStreamDestination()

      let node: AudioNode = source
      for (const filter of filters) {
        node.connect(filter)
        node = filter
      }
      node.connect(masterGain)
      masterGain.connect(context.destination)
      masterGain.connect(recordDestination)

      const engine: AudioEngine = {
        context,
        filters,
        masterGain,
        recordDestination,
        getRecordStream: () => recordDestination.stream,
        getEstimatedOutputLatencyMs: () => Math.round(((context.baseLatency || 0) + (context.outputLatency || 0)) * 1000),
        resume: async () => {
          if (context.state !== 'running') await context.resume()
        },
      }
      const resumeOnPlay = () => {
        void context.resume()
      }
      audio.addEventListener('play', resumeOnPlay)
      setState({ engine, error: null })

      return () => {
        audio.removeEventListener('play', resumeOnPlay)
        source.disconnect()
        filters.forEach((filter) => filter.disconnect())
        masterGain.disconnect()
        recordDestination.disconnect()
        void context.close()
      }
    } catch (error) {
      setState({
        engine: null,
        error: error instanceof Error ? `初始化音訊引擎失敗：${error.message}` : '初始化音訊引擎失敗。',
      })
    }
  }, [audioRef])

  return state
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

/**
 * 讓錄音與錄影共用相同的麥克風混音邏輯：麥克風會經過 gain 後送進
 * AudioEngine 的錄製 destination，並持續提供音量表資料。
 */
export function useMicrophone(engine: AudioEngine | null) {
  const micChainRef = useRef<MicChain | null>(null)
  const [micReady, setMicReady] = useState(false)
  const [micLevel, setMicLevel] = useState(0)
  const [micVolume, setMicVolume] = useState(1)
  const [error, setError] = useState<string | null>(null)

  const release = useCallback(() => {
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
  }, [])

  useEffect(() => release, [engine, release])

  const enable = useCallback(async (): Promise<boolean> => {
    if (!engine) {
      setError('音訊引擎尚未準備完成，請稍候再試。')
      return false
    }
    if (micChainRef.current) return true
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('此瀏覽器不支援麥克風錄音。')
      return false
    }

    try {
      await engine.resume()
      // 錄唱需要保留音色與動態；回音消除、降噪與自動增益是通話用處理，
      // 會讓歌聲出現抽吸感與失真。使用耳機時可安全關閉它們。
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: { ideal: 1 },
          sampleRate: { ideal: 48000 },
        },
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
      setError(null)
      return true
    } catch (micError) {
      setError(microphoneError(micError))
      return false
    }
  }, [engine, micVolume])

  const setVolume = useCallback((value: number) => {
    setMicVolume(value)
    const chain = micChainRef.current
    if (chain && engine) chain.gain.gain.setTargetAtTime(value, engine.context.currentTime, 0.015)
  }, [engine])

  return { micReady, micLevel, micVolume, setMicVolume: setVolume, enable, release, error }
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext
  }
}
