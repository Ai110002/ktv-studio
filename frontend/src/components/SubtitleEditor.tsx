import {
  Check,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Clock3,
  FileText,
  Flag,
  LoaderCircle,
  Play,
  Plus,
  Save,
  Scissors,
  Trash2,
  Upload,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type RefObject } from 'react'
import { updateSubtitles, type SubtitleLine, type Subtitles } from '../api'
import { parsePlainLyrics, parseSubtitleFile, type SubtitleDraftLine } from '../lib/subtitleFormats'

interface SubtitleEditorProps {
  songId: string
  subtitles: Subtitles | null
  audioRef: RefObject<HTMLAudioElement | null>
  duration: number
  onSubtitlesUpdated: (subtitles: Subtitles) => void
}

type EditableTimeField = 'start' | 'end'
type DraftTimeInputs = Record<string, string>
const MAX_SUBTITLE_LINES = 2000

function toDraftLines(lines: SubtitleLine[] | undefined): SubtitleDraftLine[] {
  return (lines || []).map((line) => ({
    start: Number.isFinite(line.start) ? Math.max(0, line.start) : 0,
    end: Number.isFinite(line.end) ? Math.max(0, line.end) : 0,
    text: line.text,
    words: null,
    blank: Boolean(line.blank),
  }))
}

function signatureForSubtitles(subtitles: Subtitles | null): string {
  if (!subtitles) return 'none'
  return JSON.stringify({
    language: subtitles.language,
    source: subtitles.source,
    title: subtitles.title,
    lines: subtitles.lines.map(({ start, end, text, blank }) => ({ start, end, text, blank: Boolean(blank) })),
  })
}

function sourceLabel(subtitles: Subtitles | null): string {
  if (!subtitles?.lines.length) return '尚無字幕'
  if (subtitles.source === 'manual') return '手動編輯'
  if (subtitles.source === 'youtube') return 'YouTube 字幕'
  if (subtitles.source === 'lrclib') return '歌詞庫'
  if (subtitles.source === 'whisper') return '語音辨識'
  return '字幕'
}

function clampTime(value: number, duration: number): number {
  if (!Number.isFinite(value)) return value
  const safe = Math.max(0, value)
  return duration > 0 && Number.isFinite(duration) ? Math.min(duration, safe) : safe
}

function formatCueTime(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '--:--.--'
  const centiseconds = Math.max(0, Math.round(value * 100))
  const minutes = Math.floor(centiseconds / 6000)
  const seconds = Math.floor(centiseconds / 100) % 60
  const fraction = centiseconds % 100
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(fraction).padStart(2, '0')}`
}

function isUnaligned(line: SubtitleDraftLine): boolean {
  return !Number.isFinite(line.start) || !Number.isFinite(line.end) || line.end <= line.start
}

function joinMergedText(previous: string, current: string, language: string): string {
  const normalizedLanguage = language.toLowerCase()
  const separator = normalizedLanguage.startsWith('zh') || normalizedLanguage.startsWith('ja') || normalizedLanguage === 'jpn' ? '' : ' '
  return `${previous.trim()}${separator}${current.trim()}`.trim()
}

function getFileExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot).toLowerCase() : ''
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function validationMessage(lines: SubtitleDraftLine[], timeInputs: DraftTimeInputs): string {
  const unfinishedTime = Object.entries(timeInputs).find(([, value]) => !value.trim() || !Number.isFinite(Number(value)))
  if (unfinishedTime) {
    const [key] = unfinishedTime
    const [, index, field] = key.split(':')
    return `第 ${Number(index) + 1} 句的${field === 'start' ? '開始' : '結束'}時間尚未填寫完整`
  }
  const emptyIndex = lines.findIndex((line) => !line.blank && !line.text.trim())
  if (emptyIndex >= 0) return `第 ${emptyIndex + 1} 句沒有文字，請補上後再儲存`
  const longIndex = lines.findIndex((line) => line.text.trim().length > 500)
  if (longIndex >= 0) return `第 ${longIndex + 1} 句超過 500 字元`
  const invalidIndex = lines.findIndex(
    (line) => !Number.isFinite(line.start) || !Number.isFinite(line.end) || line.start < 0 || line.end < 0,
  )
  if (invalidIndex >= 0) return `第 ${invalidIndex + 1} 句的時間必須是有限且不小於 0 的數字`
  const reversedIndex = lines.findIndex((line) => line.end < line.start)
  if (reversedIndex >= 0) return `第 ${reversedIndex + 1} 句的結束時間不可早於開始時間`
  return ''
}

export default function SubtitleEditor({
  songId,
  subtitles,
  audioRef,
  duration,
  onSubtitlesUpdated,
}: SubtitleEditorProps) {
  const [draftLines, setDraftLines] = useState<SubtitleDraftLine[]>(() => toDraftLines(subtitles?.lines))
  const [expanded, setExpanded] = useState(() => !subtitles?.lines.length)
  const [selectedIndex, setSelectedIndex] = useState(() => (subtitles?.lines.length ? 0 : -1))
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [importing, setImporting] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [pasteText, setPasteText] = useState('')
  const [pasteExpanded, setPasteExpanded] = useState(false)
  const [timeInputs, setTimeInputs] = useState<DraftTimeInputs>({})
  const [importError, setImportError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [actionError, setActionError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRefs = useRef<Array<HTMLTextAreaElement | null>>([])
  const lastPublishedSignatureRef = useRef<string | null>(null)
  const lastSyncedSignatureRef = useRef<string>(signatureForSubtitles(subtitles))

  useEffect(() => {
    const signature = signatureForSubtitles(subtitles)
    if (signature === lastPublishedSignatureRef.current) {
      lastPublishedSignatureRef.current = null
      lastSyncedSignatureRef.current = signature
      return
    }
    if (signature === lastSyncedSignatureRef.current) return
    lastSyncedSignatureRef.current = signature
    const nextLines = toDraftLines(subtitles?.lines)
    setDraftLines(nextLines)
    setSelectedIndex(nextLines.length ? 0 : -1)
    setTimeInputs({})
    setDirty(false)
    setImportError('')
    setSaveError('')
    setActionError('')
  }, [subtitles])

  useEffect(() => {
    let frame = 0
    const readTime = () => {
      const value = audioRef.current?.currentTime
      setCurrentTime(typeof value === 'number' && Number.isFinite(value) ? value : 0)
      frame = window.requestAnimationFrame(readTime)
    }
    frame = window.requestAnimationFrame(readTime)
    return () => window.cancelAnimationFrame(frame)
  }, [audioRef])

  useEffect(() => {
    if (selectedIndex < draftLines.length) return
    setSelectedIndex(draftLines.length ? draftLines.length - 1 : -1)
  }, [draftLines.length, selectedIndex])

  const busy = saving || importing
  const unalignedCount = useMemo(() => draftLines.filter(isUnaligned).length, [draftLines])
  const selectedLine = selectedIndex >= 0 ? draftLines[selectedIndex] : undefined

  const publishDraft = useCallback(
    (nextLines: SubtitleDraftLine[]) => {
      const base: Subtitles = subtitles || {
        language: 'und',
        source: 'manual',
        title: '',
        lines: [],
      }
      const updated: Subtitles = { ...base, source: 'manual', lines: nextLines }
      lastPublishedSignatureRef.current = signatureForSubtitles(updated)
      onSubtitlesUpdated(updated)
    },
    [onSubtitlesUpdated, subtitles],
  )

  const commitDraft = useCallback(
    (nextLines: SubtitleDraftLine[], nextSelectedIndex?: number, preserveTimeInputs = false) => {
      setDraftLines(nextLines)
      setDirty(true)
      if (!preserveTimeInputs) setTimeInputs({})
      setImportError('')
      setSaveError('')
      setActionError('')
      if (nextSelectedIndex !== undefined) setSelectedIndex(nextSelectedIndex)
      publishDraft(nextLines)
    },
    [publishDraft],
  )

  const getAudioTime = () => {
    const value = audioRef.current?.currentTime
    return clampTime(typeof value === 'number' && Number.isFinite(value) ? value : currentTime, duration)
  }

  const seekToLine = (index: number) => {
    const audio = audioRef.current
    const line = draftLines[index]
    if (!audio || !line || !Number.isFinite(line.start)) return
    audio.currentTime = clampTime(line.start, duration)
    setCurrentTime(audio.currentTime)
    setSelectedIndex(index)
    void audio.play().catch(() => {
      // 使用者仍可在播放器按播放；跳轉本身已經完成。
    })
  }

  const updateTime = (index: number, field: EditableTimeField, rawValue: string) => {
    const key = `${songId}:${index}:${field}`
    setTimeInputs((current) => ({ ...current, [key]: rawValue }))
    setDirty(true)
    setSaveError('')
    setActionError('')
    if (!rawValue.trim()) {
      publishDraft(draftLines)
      return
    }
    const numericValue = Number(rawValue)
    if (!Number.isFinite(numericValue)) {
      publishDraft(draftLines)
      return
    }
    const clampedValue = clampTime(numericValue, duration)
    const nextLines = draftLines.map((line, lineIndex) =>
      lineIndex === index
        ? { ...line, [field]: clampedValue, words: null }
        : line,
    ) as SubtitleDraftLine[]
    setDraftLines(nextLines)
    setTimeInputs((current) => ({
      ...current,
      [key]: numericValue === clampedValue ? rawValue : String(clampedValue),
    }))
    publishDraft(nextLines)
  }

  const markStart = (index = selectedIndex) => {
    if (index < 0 || !draftLines[index]) return
    const time = getAudioTime()
    const nextLines = draftLines.map((line, lineIndex) =>
      lineIndex === index ? { ...line, start: time, words: null } : line,
    )
    commitDraft(nextLines, index)
  }

  const markEndAndNext = (index = selectedIndex) => {
    const line = index >= 0 ? draftLines[index] : undefined
    if (!line) return
    const time = getAudioTime()
    if (time < line.start) {
      setActionError('目前播放時間早於這句的開始時間，請先調整開始時間或繼續播放。')
      setSelectedIndex(index)
      return
    }
    const nextLines = draftLines.map((current, lineIndex) => {
      if (lineIndex === index) return { ...current, end: time, words: null }
      if (lineIndex === index + 1) return { ...current, start: time, words: null }
      return current
    })
    commitDraft(nextLines, index + 1 < draftLines.length ? index + 1 : index)
  }

  const leaveBlank = (index = selectedIndex) => {
    if (draftLines.length >= MAX_SUBTITLE_LINES) {
      setActionError(`字幕最多支援 ${MAX_SUBTITLE_LINES} 行。`)
      return
    }
    const line = draftLines[index]
    if (!line) return
    const start = index > 0 ? draftLines[index - 1].end : getAudioTime()
    const blankLine: SubtitleDraftLine = { start, end: Math.max(start, line.start), text: '', words: null, blank: true }
    commitDraft([...draftLines.slice(0, index), blankLine, ...draftLines.slice(index)], index)
  }

  const splitLine = (index: number) => {
    const line = draftLines[index]
    const textarea = textareaRefs.current[index]
    if (draftLines.length >= MAX_SUBTITLE_LINES) {
      setActionError(`字幕最多支援 ${MAX_SUBTITLE_LINES} 行。`)
      return
    }
    if (!line || !line.text.trim()) {
      setActionError('沒有文字的字幕句無法拆分。')
      return
    }
    const hasSelection = Boolean(textarea && textarea.selectionStart !== textarea.selectionEnd)
    const requestedIndex = hasSelection ? textarea!.selectionStart : Math.floor(line.text.length / 2)
    const splitAt = Math.max(1, Math.min(line.text.length - 1, requestedIndex))
    const leftText = line.text.slice(0, splitAt).trim()
    const rightText = line.text.slice(splitAt).trim()
    if (!leftText || !rightText) {
      setActionError('拆分位置需要讓前後兩句都有文字。')
      return
    }
    const ratio = splitAt / line.text.length
    const splitTime = line.start + (line.end - line.start) * ratio
    const splitLines: SubtitleDraftLine[] = [
      { start: line.start, end: splitTime, text: leftText, words: null },
      { start: splitTime, end: line.end, text: rightText, words: null },
    ]
    commitDraft([...draftLines.slice(0, index), ...splitLines, ...draftLines.slice(index + 1)], index + 1)
  }

  const mergeWithPrevious = (index: number) => {
    if (index <= 0 || !draftLines[index]) {
      setActionError('第一句沒有上一句可以合併。')
      return
    }
    const previous = draftLines[index - 1]
    const current = draftLines[index]
    const merged: SubtitleDraftLine = {
      start: previous.start,
      end: current.end,
      text: joinMergedText(previous.text, current.text, subtitles?.language || 'und'),
      words: null,
    }
    commitDraft([...draftLines.slice(0, index - 1), merged, ...draftLines.slice(index + 1)], index - 1)
  }

  const deleteLine = (index: number) => {
    const nextLines = draftLines.filter((_, lineIndex) => lineIndex !== index)
    const nextIndex = nextLines.length ? Math.min(index, nextLines.length - 1) : -1
    commitDraft(nextLines, nextIndex)
  }

  const addLine = () => {
    if (draftLines.length >= MAX_SUBTITLE_LINES) {
      setActionError(`字幕最多支援 ${MAX_SUBTITLE_LINES} 行。`)
      return
    }
    const lastLine = draftLines[draftLines.length - 1]
    const start = lastLine && Number.isFinite(lastLine.end) ? lastLine.end : 0
    commitDraft(
      [...draftLines, { start, end: start, text: '', words: null, blank: false }],
      draftLines.length,
    )
  }

  const confirmReplacement = () => !dirty || window.confirm('目前有尚未儲存的字幕修改，匯入會取代這些修改。確定要繼續嗎？')

  const replaceWithLines = (lines: SubtitleDraftLine[]) => {
    setDraftLines(lines)
    setSelectedIndex(lines.length ? 0 : -1)
    setTimeInputs({})
    setDirty(true)
    setImportError('')
    setSaveError('')
    setActionError('')
    publishDraft(lines)
  }

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || busy || !confirmReplacement()) return
    setImporting(true)
    setImportError('')
    try {
      const lines = parseSubtitleFile(await file.text(), getFileExtension(file.name), duration)
      replaceWithLines(lines)
      setExpanded(true)
    } catch (error) {
      setImportError(errorMessage(error, '讀取字幕檔失敗，請確認格式。'))
    } finally {
      setImporting(false)
    }
  }

  const handlePasteImport = () => {
    if (busy || !confirmReplacement()) return
    try {
      const lines = parsePlainLyrics(pasteText)
      replaceWithLines(lines)
      setExpanded(true)
    } catch (error) {
      setImportError(errorMessage(error, '貼上的歌詞沒有可用內容。'))
    }
  }

  const handleSave = async () => {
    const validationError = validationMessage(draftLines, timeInputs)
    if (validationError) {
      setSaveError(validationError)
      return
    }
    setSaving(true)
    setSaveError('')
    setActionError('')
    try {
      const response = await updateSubtitles(
        songId,
        draftLines.map(({ start, end, text, blank }) => ({ start, end, text: blank ? '' : text.trim(), blank: Boolean(blank) })),
      )
      const nextLines = toDraftLines(response.lines)
      setDraftLines(nextLines)
      setSelectedIndex(nextLines.length ? Math.min(selectedIndex, nextLines.length - 1) : -1)
      setTimeInputs({})
      setDirty(false)
      lastPublishedSignatureRef.current = signatureForSubtitles(response)
      onSubtitlesUpdated(response)
    } catch (error) {
      setSaveError(errorMessage(error, '儲存字幕失敗，請稍後再試。'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-indigo-400/20 bg-slate-950/45 shadow-xl shadow-indigo-950/10">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 bg-slate-900/55 px-4 py-4 sm:px-5">
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="group flex min-w-0 items-center gap-3 text-left"
          aria-expanded={expanded}
          aria-controls="subtitle-workbench-content"
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-indigo-300/20 bg-indigo-500/15 text-indigo-200 transition group-hover:border-indigo-300/40 group-hover:bg-indigo-500/25">
            {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </span>
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-2 text-sm font-bold text-slate-100">
              字幕工作台
              {dirty && <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-[11px] font-semibold text-amber-200">尚未儲存</span>}
            </span>
            <span className="mt-1 block truncate text-xs text-slate-500">
              來源：{sourceLabel(subtitles)} · {draftLines.length} 句 · 目前 {formatCueTime(currentTime)}
            </span>
          </span>
        </button>
        <div className="flex items-center gap-2">
          <span className="hidden items-center gap-1.5 text-xs tabular-nums text-slate-500 sm:inline-flex">
            <Clock3 size={14} aria-hidden="true" />{formatCueTime(currentTime)}
          </span>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={busy || !dirty}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-indigo-500 px-3 text-xs font-bold text-white shadow-lg shadow-indigo-950/30 transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {saving ? <LoaderCircle className="animate-spin" size={15} /> : <Save size={15} />}
            {saving ? '儲存中…' : '儲存字幕'}
          </button>
        </div>
      </div>

      {expanded && (
        <div id="subtitle-workbench-content" className="space-y-4 p-4 sm:p-5">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-200">匯入字幕檔</p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">支援 TXT、LRC、SRT、VTT；檔案只在瀏覽器解析。</p>
                </div>
                <FileText className="shrink-0 text-indigo-300" size={18} aria-hidden="true" />
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.lrc,.srt,.vtt,text/plain"
                onChange={(event) => void handleFileChange(event)}
                disabled={busy}
                className="sr-only"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={busy}
                className="mt-3 inline-flex min-h-9 items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/75 px-3 text-xs font-semibold text-slate-200 transition hover:border-indigo-400/50 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {importing ? <LoaderCircle className="animate-spin" size={15} /> : <Upload size={15} />}
                {importing ? '解析中…' : '選擇字幕檔'}
              </button>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3.5">
              <button
                type="button"
                onClick={() => setPasteExpanded((current) => !current)}
                className="flex w-full items-start justify-between gap-3 text-left"
                aria-expanded={pasteExpanded}
                aria-controls="subtitle-paste-content"
              >
                <span>
                  <span className="block text-sm font-semibold text-slate-200">貼上純文字歌詞</span>
                  <span className="mt-1 block text-xs leading-5 text-slate-500">每一行建立一個待對齊句，不會呼叫 Whisper。</span>
                </span>
                {pasteExpanded ? <ChevronUp className="text-slate-500" size={17} /> : <ChevronDown className="text-slate-500" size={17} />}
              </button>
              {pasteExpanded && (
                <div id="subtitle-paste-content" className="mt-3">
                  <label htmlFor="subtitle-paste-input" className="sr-only">要載入的純文字歌詞</label>
                  <textarea
                    id="subtitle-paste-input"
                    value={pasteText}
                    onChange={(event) => setPasteText(event.target.value)}
                    disabled={busy}
                    rows={5}
                    placeholder="一行一句歌詞…"
                    className="w-full resize-y rounded-lg border border-slate-700 bg-slate-950/75 px-3 py-2.5 text-sm leading-6 text-slate-100 outline-none placeholder:text-slate-600 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/20 disabled:cursor-not-allowed disabled:opacity-45"
                  />
                  <button
                    type="button"
                    onClick={handlePasteImport}
                    disabled={busy || !pasteText.trim()}
                    className="mt-2 inline-flex min-h-9 items-center gap-2 rounded-lg border border-indigo-400/30 bg-indigo-500/10 px-3 text-xs font-semibold text-indigo-100 transition hover:bg-indigo-500/20 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <Check size={15} />載入到編輯器
                  </button>
                </div>
              )}
            </div>
          </div>

          {unalignedCount > 0 && (
            <div className="flex items-start gap-2.5 rounded-xl border border-amber-300/20 bg-amber-400/10 px-3.5 py-3 text-sm text-amber-100" role="status">
              <CircleAlert className="mt-0.5 shrink-0 text-amber-300" size={17} />
              <p>有 {unalignedCount} 句尚未對齊（結束時間需大於開始時間，或目前仍為 00:00.00）。仍可儲存，請播放歌曲逐句標記。</p>
            </div>
          )}

          {selectedLine && (
            <div className="grid gap-2 rounded-xl border border-indigo-400/20 bg-indigo-500/10 px-3.5 py-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-indigo-300">目前選取</p>
                <p className="mt-1 truncate text-sm font-semibold text-slate-100">第 {selectedIndex + 1} 句：{selectedLine.text || '尚未輸入文字'}</p>
              </div>
              <span className="whitespace-nowrap text-xs tabular-nums text-indigo-200">現在 {formatCueTime(currentTime)}</span>
              <div className="grid shrink-0 grid-cols-2 gap-2 sm:flex">
              <button
                type="button"
                onClick={() => markStart()}
                disabled={busy}
                className="inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-indigo-300/30 bg-indigo-500/20 px-3 text-xs font-semibold text-indigo-100 transition hover:bg-indigo-500/35 disabled:cursor-not-allowed disabled:opacity-45"
              >
                <Flag size={14} />標記這句開始
              </button>
              <button
                type="button"
                onClick={() => markEndAndNext()}
                disabled={busy}
                className="inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-indigo-400 px-3 text-xs font-bold text-slate-950 transition hover:bg-indigo-300 disabled:cursor-not-allowed disabled:opacity-45"
              >
                <Flag size={14} />標記結束並下一句
              </button>
              <button type="button" onClick={() => leaveBlank()} disabled={busy} className="col-span-2 inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-cyan-300/30 bg-cyan-500/10 px-3 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-45 sm:col-span-1">
                留空白
              </button>
              </div>
            </div>
          )}

          {(importError || saveError || actionError) && (
            <div className="space-y-1 rounded-xl border border-rose-300/20 bg-rose-500/10 px-3.5 py-3 text-sm text-rose-200" role="alert">
              {importError && <p>匯入失敗：{importError}</p>}
              {saveError && <p>儲存前檢查：{saveError}</p>}
              {actionError && <p>{actionError}</p>}
            </div>
          )}

          {draftLines.length === 0 ? (
            <div className="grid min-h-36 place-items-center rounded-xl border border-dashed border-slate-700 bg-slate-900/30 px-5 py-7 text-center">
              <div>
                <FileText className="mx-auto text-slate-600" size={26} />
                <p className="mt-2 text-sm font-semibold text-slate-300">還沒有字幕句</p>
                <p className="mt-1 text-xs text-slate-500">可匯入字幕檔、貼上歌詞，或在下方新增一列。</p>
              </div>
            </div>
          ) : (
            <div className="space-y-2.5">
              {draftLines.map((line, index) => {
                const selected = selectedIndex === index
                const unaligned = isUnaligned(line)
                const startKey = `${songId}:${index}:start`
                const endKey = `${songId}:${index}:end`
                return (
                  <article
                    key={index}
                    onClick={() => setSelectedIndex(index)}
                    className={`rounded-xl border p-3 transition sm:p-3.5 ${selected ? 'border-indigo-400/55 bg-indigo-500/[0.08] shadow-lg shadow-indigo-950/10' : 'border-slate-800 bg-slate-900/35 hover:border-slate-700'} ${unaligned ? 'border-l-amber-400/70' : ''}`}
                  >
                    <div className="flex items-start gap-3">
                      <span className={`mt-1 grid size-7 shrink-0 place-items-center rounded-lg text-xs font-bold tabular-nums ${selected ? 'bg-indigo-400 text-slate-950' : 'bg-slate-800 text-slate-400'}`}>{index + 1}</span>
                      <div className="min-w-0 flex-1">
                        <label htmlFor={`subtitle-text-${index}`} className="sr-only">第 {index + 1} 句字幕文字</label>
                        <textarea
                          ref={(element) => { textareaRefs.current[index] = element }}
                          id={`subtitle-text-${index}`}
                          value={line.text}
                          onChange={(event) => {
                            const nextLines = draftLines.map((current, lineIndex) =>
                              lineIndex === index ? { ...current, text: event.target.value, words: null } : current,
                            )
                            commitDraft(nextLines, index, true)
                          }}
                          disabled={busy}
                          maxLength={500}
                          rows={2}
                          placeholder="輸入這句字幕文字"
                          className="w-full resize-y rounded-lg border border-slate-700 bg-slate-950/75 px-3 py-2.5 text-sm leading-6 text-slate-100 outline-none placeholder:text-slate-600 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/20 disabled:cursor-not-allowed disabled:opacity-45"
                        />
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                          <span className={unaligned ? 'text-amber-300' : 'text-emerald-300'}>{unaligned ? '待對齊' : '已對齊'}</span>
                          <span>·</span>
                          <span>{line.blank ? '間奏留空白' : `${line.text.length}/500 字`}</span>
                          <span>·</span>
                          <span className="tabular-nums">{formatCueTime(line.start)} → {formatCueTime(line.end)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                      {(['start', 'end'] as const).map((field) => {
                        const key = field === 'start' ? startKey : endKey
                        const value = timeInputs[key] ?? String(line[field])
                        return (
                          <label key={field} className="flex min-w-0 items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/55 px-2.5 py-1.5">
                            <span className="w-10 shrink-0 text-[11px] font-semibold text-slate-500">{field === 'start' ? '開始' : '結束'}</span>
                            <input
                              type="number"
                              min="0"
                              max={duration > 0 ? duration : undefined}
                              step="0.01"
                              value={value}
                              onChange={(event) => updateTime(index, field, event.target.value)}
                              onFocus={() => setSelectedIndex(index)}
                              disabled={busy}
                              aria-label={`第 ${index + 1} 句${field === 'start' ? '開始' : '結束'}秒數`}
                              className="min-w-0 flex-1 bg-transparent text-sm tabular-nums text-slate-100 outline-none placeholder:text-slate-600"
                            />
                            <span className="text-[11px] tabular-nums text-slate-600">秒</span>
                          </label>
                        )
                      })}
                      <button
                        type="button"
                        onClick={() => seekToLine(index)}
                        disabled={busy || !Number.isFinite(line.start)}
                        className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/75 px-3 text-xs font-semibold text-slate-200 transition hover:border-indigo-400/50 hover:text-indigo-100 disabled:cursor-not-allowed disabled:opacity-45"
                        aria-label={`跳到第 ${index + 1} 句開始位置`}
                      >
                        <Play size={14} className="fill-current" />跳至開始
                      </button>
                      <button type="button" onClick={() => leaveBlank(index)} disabled={busy} className="inline-flex min-h-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-xs font-semibold text-cyan-200 transition hover:bg-cyan-500/15 disabled:cursor-not-allowed disabled:opacity-45">留空白</button>
                    </div>

                    <div className="mt-2 flex flex-wrap gap-2 border-t border-slate-800/80 pt-2.5">
                      <button
                        type="button"
                        onClick={() => { setSelectedIndex(index); markStart(index) }}
                        disabled={busy}
                        className="inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-indigo-200 transition hover:bg-indigo-500/15 disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        <Flag size={13} />標記開始
                      </button>
                      <button
                        type="button"
                        onClick={() => { setSelectedIndex(index); markEndAndNext(index) }}
                        disabled={busy}
                        className="inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-indigo-200 transition hover:bg-indigo-500/15 disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        <Flag size={13} />結束並下一句
                      </button>
                      <button
                        type="button"
                        onClick={() => splitLine(index)}
                        disabled={busy || line.text.trim().length < 2}
                        className="inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-slate-400 transition hover:bg-slate-800 hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        <Scissors size={13} />拆分
                      </button>
                      <button
                        type="button"
                        onClick={() => mergeWithPrevious(index)}
                        disabled={busy || index === 0}
                        className="inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-slate-400 transition hover:bg-slate-800 hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        合併上一句
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteLine(index)}
                        disabled={busy}
                        className="ml-auto inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-rose-300/80 transition hover:bg-rose-500/10 hover:text-rose-200 disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        <Trash2 size={13} />刪除
                      </button>
                    </div>
                  </article>
                )
              })}
            </div>
          )}

          <button
            type="button"
            onClick={addLine}
            disabled={busy}
            className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-indigo-400/35 bg-indigo-500/[0.06] text-sm font-semibold text-indigo-200 transition hover:border-indigo-300/60 hover:bg-indigo-500/15 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Plus size={17} />在末尾新增字幕
          </button>

          <p className="text-xs leading-5 text-slate-600">提示：拆分會優先使用文字選取範圍，沒有選取時取文字中點；合併中文/日文不加空格，英文會加入一個空格。</p>
        </div>
      )}
    </section>
  )
}
