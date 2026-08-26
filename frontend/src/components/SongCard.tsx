import { Clock3, Disc3, Mic2, Trash2, Youtube } from 'lucide-react'
import { formatDuration, type Song } from '../api'

interface SongCardProps {
  song: Song
  onOpen: () => void
  onDelete: () => void
  deleting?: boolean
}

const languageLabel: Record<string, string> = {
  ja: '日文',
  zh: '中文',
  en: '英文',
  und: '未辨識',
}

export default function SongCard({ song, onOpen, onDelete, deleting = false }: SongCardProps) {
  const initial = song.title.trim().charAt(0).toUpperCase() || '♪'
  return (
    <article className="group panel overflow-hidden transition hover:-translate-y-0.5 hover:border-indigo-400/30">
      <button type="button" onClick={onOpen} className="block w-full p-4 text-left focus:outline-none">
        <div className="flex gap-4">
          <span className="grid size-14 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-indigo-500/80 via-violet-600/70 to-fuchsia-600/70 text-xl font-bold text-white shadow-lg shadow-indigo-950/50">
            {initial}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold text-slate-100 group-hover:text-indigo-200">{song.title}</span>
            <span className="mt-1 block truncate text-sm text-slate-400">{song.artist || '未知歌手'}</span>
            <span className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="rounded-md bg-slate-800 px-2 py-1 text-slate-300">{languageLabel[song.language] || song.language}</span>
              <span className="inline-flex items-center gap-1"><Clock3 size={12} />{formatDuration(song.duration)}</span>
              <span className="inline-flex items-center gap-1">
                {song.source_type === 'youtube' ? <Youtube size={13} /> : <Disc3 size={13} />}
                {song.source_type === 'youtube' ? 'YouTube' : '上傳'}
              </span>
              {song.has_cover && <span className="inline-flex items-center gap-1 text-emerald-300"><Mic2 size={12} />已有成品</span>}
            </span>
          </span>
        </div>
      </button>
      <div className="border-t border-white/6 px-4 py-2.5">
        <button
          type="button"
          onClick={onDelete}
          disabled={deleting}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-slate-500 transition hover:bg-rose-500/10 hover:text-rose-300 disabled:opacity-50"
        >
          <Trash2 size={14} aria-hidden="true" />
          {deleting ? '刪除中…' : '刪除歌曲'}
        </button>
      </div>
    </article>
  )
}
