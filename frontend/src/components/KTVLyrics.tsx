import { Captions, MousePointer2 } from 'lucide-react'
import { useEffect, useMemo, useState, type RefObject } from 'react'
import type { SubtitleLine, Subtitles } from '../api'

interface KTVLyricsProps {
  subtitles: Subtitles | null
  audioRef: RefObject<HTMLAudioElement | null>
}

function seekTo(audioRef: RefObject<HTMLAudioElement | null>, line: SubtitleLine) {
  const audio = audioRef.current
  if (!audio) return
  audio.currentTime = line.start
  void audio.play().catch(() => {
    // 使用者尚未與頁面互動時，瀏覽器可能封鎖播放；時間仍已跳轉。
  })
}

function isLineActive(line: SubtitleLine, time: number): boolean {
  if (line.blank || !line.text.trim() || time < line.start || time >= line.end) return false
  if (line.words?.length) return line.words.some((word) => time >= word.start && time < word.end)
  return true
}

function PreviewLine({
  line,
  audioRef,
  position,
}: {
  line: SubtitleLine | undefined
  audioRef: RefObject<HTMLAudioElement | null>
  position: '上一句' | '下一句'
}) {
  if (!line) return <div className="h-10" />
  return (
    <button
      type="button"
      onClick={() => seekTo(audioRef, line)}
      className="group flex min-h-10 w-full items-center justify-center gap-2 px-3 text-center text-sm text-slate-600 transition hover:text-slate-300"
      aria-label={`跳至${position}：${line.text}`}
    >
      <span className="max-w-full truncate">{line.text}</span>
      <MousePointer2 className="hidden shrink-0 text-indigo-300 group-hover:block" size={13} aria-hidden="true" />
    </button>
  )
}

export default function KTVLyrics({ subtitles, audioRef }: KTVLyricsProps) {
  const [time, setTime] = useState(0)

  useEffect(() => {
    let frame = 0
    const readTime = () => {
      setTime(audioRef.current?.currentTime || 0)
      frame = window.requestAnimationFrame(readTime)
    }
    frame = window.requestAnimationFrame(readTime)
    return () => window.cancelAnimationFrame(frame)
  }, [audioRef])

  const lines = subtitles?.lines || []
  const currentIndex = useMemo(() => {
    if (!lines.length) return -1
    return lines.findIndex((line) => isLineActive(line, time))
  }, [lines, time])
  const current = currentIndex >= 0 ? lines[currentIndex] : undefined
  const isJapanese = subtitles?.language === 'ja'

  if (!current && lines.length) {
    return <section className="panel min-h-72" aria-label="目前沒有字幕" />
  }
  if (!current) {
    return (
      <section className="panel grid min-h-72 place-items-center p-6 text-center">
        <div>
          <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-slate-800 text-slate-500"><Captions size={24} /></span>
          <h2 className="mt-4 font-semibold text-slate-200">這首歌沒有可用字幕</h2>
          <p className="mt-2 text-sm text-slate-500">你仍可播放伴奏、調整 EQ 並錄製自己的歌聲。</p>
        </div>
      </section>
    )
  }

  const hasWords = Boolean(current.words?.length)
  return (
    <section className="panel relative overflow-hidden bg-gradient-to-br from-slate-900/95 via-slate-900/85 to-indigo-950/35 px-4 py-6 sm:px-8 sm:py-9">
      <div className="pointer-events-none absolute -right-20 -top-20 size-52 rounded-full bg-indigo-500/10 blur-3xl" />
      <div className="relative flex min-h-64 flex-col justify-center">
        <PreviewLine line={lines[currentIndex - 1]} audioRef={audioRef} position="上一句" />
        <button
          type="button"
          onClick={() => seekTo(audioRef, current)}
          className="my-2 w-full rounded-2xl px-2 py-4 text-center transition hover:bg-white/4 focus:outline-none focus:ring-2 focus:ring-indigo-400/70"
          aria-label={`跳至目前歌詞：${current.text}`}
        >
          {hasWords ? (
            <span className="flex flex-wrap justify-center gap-x-1.5 gap-y-3 sm:gap-x-2.5">
              {current.words!.map((word, index) => {
                const active = time >= word.start
                const inWord = time >= word.start && time < word.end
                return (
                  <span key={`${word.start}-${index}`} className="inline-flex flex-col items-center leading-none">
                    <span
                      className={`text-3xl font-black tracking-wide transition-colors duration-100 sm:text-5xl ${
                        inWord ? 'text-fuchsia-200 drop-shadow-[0_0_14px_rgba(216,180,254,0.65)]' : active ? 'text-indigo-200' : 'text-slate-600'
                      }`}
                    >
                      {word.text}
                    </span>
                    {isJapanese && word.romaji && (
                      <span className={`mt-2 text-[11px] tracking-wide sm:text-xs ${active ? 'text-indigo-300' : 'text-slate-600'}`}>{word.romaji}</span>
                    )}
                  </span>
                )
              })}
            </span>
          ) : (
            <>
              <span className={`block text-3xl font-black tracking-wide transition-colors sm:text-5xl ${time >= current.start && time <= current.end ? 'text-fuchsia-200 drop-shadow-[0_0_14px_rgba(216,180,254,0.65)]' : 'text-slate-500'}`}>
                {current.text}
              </span>
              {isJapanese && current.romaji && <span className="mt-3 block text-sm tracking-wider text-indigo-300 sm:text-base">{current.romaji}</span>}
            </>
          )}
        </button>
        <PreviewLine line={lines[currentIndex + 1]} audioRef={audioRef} position="下一句" />
      </div>
      <p className="relative mt-2 text-center text-[11px] text-slate-600">點擊任一句歌詞可跳轉播放位置</p>
    </section>
  )
}
