import { LibraryBig, Music2, PlusCircle } from 'lucide-react'
import { NavLink, Route, Routes } from 'react-router-dom'
import ImportPage from './pages/ImportPage'
import LibraryPage from './pages/LibraryPage'
import StudioPage from './pages/StudioPage'

const navClass = ({ isActive }: { isActive: boolean }) =>
  `inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition ${
    isActive
      ? 'bg-indigo-500/20 text-indigo-200 ring-1 ring-indigo-400/30'
      : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'
  }`

export default function App() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="sticky top-0 z-20 border-b border-white/8 bg-slate-950/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <NavLink to="/" className="flex min-w-0 items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-950/60">
              <Music2 size={21} aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-base font-bold tracking-tight">KTV Studio</span>
              <span className="block text-xs text-slate-500">卡拉錄唱室</span>
            </span>
          </NavLink>
          <nav className="flex items-center gap-1" aria-label="主要導覽">
            <NavLink to="/" end className={navClass}>
              <PlusCircle size={16} aria-hidden="true" />
              匯入歌曲
            </NavLink>
            <NavLink to="/library" className={navClass}>
              <LibraryBig size={16} aria-hidden="true" />
              歌曲庫
            </NavLink>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-7 sm:px-6 sm:py-10">
        <Routes>
          <Route path="/" element={<ImportPage />} />
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/studio/:songId" element={<StudioPage />} />
          <Route path="*" element={<ImportPage />} />
        </Routes>
      </main>
    </div>
  )
}
