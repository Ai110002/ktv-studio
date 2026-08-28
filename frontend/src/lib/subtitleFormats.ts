export type SubtitleDraftLine = {
  start: number
  end: number
  text: string
  words: null
}

const MAX_SUBTITLE_LINES = 2000
const TIME_ARROW_RE = /^\s*([^\s]+)\s*-->\s*([^\s]+)(?:\s+.*)?$/
const LRC_TIMESTAMP_RE = /\[(\d{1,4}):(\d{2})(?:[.,](\d{1,3}))?\]/g

function cleanInput(text: string): string {
  return text.replace(/^\uFEFF/, '')
}

function ensureText(text: string): string {
  return text.trim()
}

function ensureLineLimit(lines: SubtitleDraftLine[]): SubtitleDraftLine[] {
  if (lines.length > MAX_SUBTITLE_LINES) {
    throw new Error(`字幕最多支援 ${MAX_SUBTITLE_LINES} 行`)
  }
  if (!lines.length) throw new Error('找不到可用字幕內容')
  return lines
}

function roundTime(value: number): number {
  return Math.round(value * 1000) / 1000
}

function parseTimestamp(value: string): number {
  const normalized = value.trim().replace(',', '.')
  const parts = normalized.split(':')
  if (parts.length !== 2 && parts.length !== 3) throw new Error('字幕時間格式無效')

  const seconds = Number(parts[parts.length - 1])
  const minutes = Number(parts[parts.length - 2])
  const hours = parts.length === 3 ? Number(parts[0]) : 0
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || !Number.isFinite(seconds)) {
    throw new Error('字幕時間格式無效')
  }
  if (hours < 0 || minutes < 0 || minutes >= 60 || seconds < 0 || seconds >= 60) {
    throw new Error('字幕時間格式無效')
  }
  const result = hours * 3600 + minutes * 60 + seconds
  if (!Number.isFinite(result) || result < 0) throw new Error('字幕時間格式無效')
  return roundTime(result)
}

function makeLine(start: number, end: number, text: string): SubtitleDraftLine | null {
  const cleaned = ensureText(text)
  if (!cleaned) return null
  const safeStart = roundTime(start)
  const safeEnd = roundTime(Math.max(safeStart, end))
  return { start: safeStart, end: safeEnd, text: cleaned, words: null }
}

function joinCueText(lines: string[]): string {
  return lines
    .map((line) => line.replace(/<[^>]*>/g, ' ').trim())
    .filter(Boolean)
    .join(' ')
    .trim()
}

export function parsePlainLyrics(text: string): SubtitleDraftLine[] {
  if (typeof text !== 'string' || !text.trim()) throw new Error('貼上的歌詞沒有可用內容')
  const lines = text
    .split(/\r?\n/)
    .map((line) => makeLine(0, 0, line))
    .filter((line): line is SubtitleDraftLine => line !== null)
  return ensureLineLimit(lines)
}

function parseLrc(text: string, duration: number): SubtitleDraftLine[] {
  const timestamped: Array<{ start: number; text: string; order: number }> = []
  let order = 0
  for (const rawLine of text.split(/\r?\n/)) {
    const matches: Array<{ start: number; end: number }> = []
    LRC_TIMESTAMP_RE.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = LRC_TIMESTAMP_RE.exec(rawLine)) !== null) {
      const fraction = match[3] ? `.${match[3]}` : ''
      const start = parseTimestamp(`${match[1]}:${match[2]}${fraction}`)
      matches.push({ start, end: match.index + match[0].length })
    }
    if (!matches.length) continue
    const lyric = ensureText(rawLine.slice(matches[matches.length - 1].end))
    if (!lyric) continue
    for (const timestamp of matches) {
      timestamped.push({ start: timestamp.start, text: lyric, order })
      order += 1
    }
  }

  timestamped.sort((left, right) => left.start - right.start || left.order - right.order)
  const merged: Array<{ start: number; text: string }> = []
  for (const item of timestamped) {
    const previous = merged[merged.length - 1]
    if (previous && previous.start === item.start) {
      if (!previous.text.includes(item.text)) previous.text = `${previous.text} ${item.text}`.trim()
    } else {
      merged.push({ start: item.start, text: item.text })
    }
  }

  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0
  const lines = merged
    .map((item, index) => {
      const nextStart = merged[index + 1]?.start
      const end = nextStart ?? (safeDuration > item.start ? safeDuration : item.start + 5)
      return makeLine(item.start, end, item.text)
    })
    .filter((line): line is SubtitleDraftLine => line !== null)
  return ensureLineLimit(lines)
}

function parseCueFormat(text: string, format: 'srt' | 'vtt'): SubtitleDraftLine[] {
  const blocks = cleanInput(text).split(/\r?\n(?:[ \t]*\r?\n)+/)
  const lines: SubtitleDraftLine[] = []
  for (const block of blocks) {
    const blockLines = block.split(/\r?\n/)
    const first = blockLines.find((line) => line.trim())?.trim().toUpperCase() || ''
    if (format === 'vtt' && /^(WEBVTT|NOTE|STYLE|REGION)(?:\s|$)/.test(first)) continue
    const timingIndex = blockLines.findIndex((line) => TIME_ARROW_RE.test(line))
    if (timingIndex < 0) continue
    const timing = TIME_ARROW_RE.exec(blockLines[timingIndex])
    if (!timing) continue
    let start: number
    let end: number
    try {
      start = parseTimestamp(timing[1])
      end = parseTimestamp(timing[2])
    } catch {
      continue
    }
    const cueText = joinCueText(blockLines.slice(timingIndex + 1))
    const line = makeLine(start, end, cueText)
    if (line) lines.push(line)
  }
  return ensureLineLimit(lines)
}

export function parseSubtitleFile(text: string, extension: string, duration: number): SubtitleDraftLine[] {
  if (typeof text !== 'string' || !text.trim()) throw new Error('字幕檔沒有可用內容')
  const normalizedExtension = extension.trim().toLowerCase()
  const extensionName = normalizedExtension.includes('.')
    ? normalizedExtension.slice(normalizedExtension.lastIndexOf('.'))
    : `.${normalizedExtension}`
  const source = cleanInput(text)

  if (extensionName === '.txt') return parsePlainLyrics(source)
  if (extensionName === '.lrc') return parseLrc(source, duration)
  if (extensionName === '.srt') return parseCueFormat(source, 'srt')
  if (extensionName === '.vtt') return parseCueFormat(source, 'vtt')
  throw new Error('不支援的字幕格式，請選擇 TXT、LRC、SRT 或 VTT')
}
