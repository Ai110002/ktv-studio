import { LibraryBig, LoaderCircle, Music2, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { deleteSong, getSongs, type Song } from '../api'
import SongCard from '../components/SongCard'

export default function LibraryPage() {
  const navigate = useNavigate()
  const [songs, setSongs] = useState<Song[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setSongs(await getSongs())
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '讀取歌曲庫失敗')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const removeSong = async (song: Song) => {
    if (!window.confirm(`確定要刪除「${song.title}」及其所有音訊檔嗎？`)) return
    setDeletingId(song.id)
    try {
      await deleteSong(song.id)
      setSongs((items) => items.filter((item) => item.id !== song.id))
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '刪除歌曲失敗')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-indigo-300">你的本機收藏</p>
          <h1 className="mt-1 flex items-center gap-2 text-3xl font-bold tracking-tight text-white"><LibraryBig size={28} />歌曲庫</h1>
          <p className="mt-2 text-sm text-slate-400">已完成處理的歌曲都保存在這台電腦。</p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-medium text-slate-300 transition hover:border-indigo-400/50 hover:text-white disabled:opacity-50"
        >
          <RefreshCw className={loading ? 'animate-spin' : ''} size={16} />
          重新整理
        </button>
      </div>

      {error && <p className="mt-6 rounded-xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</p>}

      {loading ? (
        <div className="flex min-h-64 items-center justify-center gap-2 text-slate-400"><LoaderCircle className="animate-spin" size={20} />正在載入歌曲庫…</div>
      ) : songs.length === 0 ? (
        <div className="panel mt-7 grid min-h-72 place-items-center p-8 text-center">
          <div>
            <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-indigo-500/12 text-indigo-300"><Music2 size={28} /></span>
            <h2 className="mt-4 font-semibold text-white">歌曲庫還是空的</h2>
            <p className="mt-2 text-sm text-slate-400">先匯入一首歌，幾分鐘後就能在這裡開始錄唱。</p>
            <button
              type="button"
              onClick={() => navigate('/')}
              className="mt-5 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-400"
            >
              匯入第一首歌
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {songs.map((song) => (
            <SongCard
              key={song.id}
              song={song}
              onOpen={() => navigate(`/studio/${song.id}`)}
              onDelete={() => void removeSong(song)}
              deleting={deletingId === song.id}
            />
          ))}
        </div>
      )}
    </section>
  )
}
