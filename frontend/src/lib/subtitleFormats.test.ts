import { parsePlainLyrics, parseSubtitleFile } from './subtitleFormats'

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

const plain = parsePlainLyrics('\n第一句\n\n第二句\n')
assert(plain.length === 2 && plain[0].start === 0 && plain[1].text === '第二句', 'TXT parser failed')

const lrc = parseSubtitleFile('[00:01.20][00:02,000]第一句\n[00:04.000]第二句', '.LRC', 10)
assert(lrc.length === 3 && lrc[0].end === 2 && lrc[1].text === '第一句', 'LRC parser failed')
assert(lrc[2].end === 10, 'LRC duration fallback failed')
const mergedLrc = parseSubtitleFile('[00:01.00]甲\n[00:01,000]乙', 'lrc', 0)
assert(mergedLrc.length === 1 && mergedLrc[0].text === '甲 乙', 'LRC same-time merge failed')

const srt = parseSubtitleFile(
  '1\n00:00:01,000 --> 00:00:03,500\n第一\n句\n',
  'srt',
  0,
)
assert(srt.length === 1 && srt[0].start === 1 && srt[0].text === '第一 句', 'SRT parser failed')

const vtt = parseSubtitleFile(
  'WEBVTT\n\ncue-1\n00:01.000 --> 00:03.500 align:start\nHello\nworld\n',
  '.vtt',
  0,
)
assert(vtt.length === 1 && vtt[0].start === 1 && vtt[0].end === 3.5, 'VTT parser failed')

let rejected = false
try {
  parseSubtitleFile('not a subtitle', '.ass', 0)
} catch {
  rejected = true
}
assert(rejected, 'Unsupported subtitle format should fail')
