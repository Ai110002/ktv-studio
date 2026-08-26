import { useEffect, useState, type RefObject } from 'react'

export const EQ_FREQUENCIES = [60, 150, 400, 1000, 2500, 6000, 12000] as const

export interface AudioEngine {
  context: AudioContext
  filters: BiquadFilterNode[]
  masterGain: GainNode
  recordDestination: MediaStreamAudioDestinationNode
  resume: () => Promise<void>
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
      const context = new Context()
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
        resume: async () => {
          if (context.state !== 'running') await context.resume()
        },
      }
      setState({ engine, error: null })

      return () => {
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

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext
  }
}
