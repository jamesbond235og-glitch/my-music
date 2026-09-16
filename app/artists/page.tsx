'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Music2, Play, Search, UserRound } from 'lucide-react';

type Song = { id: number; title: string; artist: string; album: string; quality: string; fileName: string; path: string; format: string; duration: string; stream: string };
type Artist = { name: string; songs: Song[] };
type LibraryResponse = { artists: Artist[] };

const colors = [
  'linear-gradient(135deg,#7c3aed,#0ea5e9)',
  'linear-gradient(135deg,#059669,#164e63)',
  'linear-gradient(135deg,#be123c,#7f1d1d)',
  'linear-gradient(135deg,#334155,#0f172a)',
  'linear-gradient(135deg,#ea580c,#7c2d12)',
  'linear-gradient(135deg,#2563eb,#312e81)',
];

export default function ArtistsPage() {
  const [artists, setArtists] = useState<Artist[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/library', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error(await response.text());
        return response.json() as Promise<LibraryResponse>;
      })
      .then((data) => setArtists(data.artists || []))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return artists.filter((artist) => !q || artist.name.toLowerCase().includes(q));
  }, [artists, query]);

  if (loading) return <div className="grid min-h-screen place-items-center bg-zinc-950 text-sm text-zinc-500">Loading artists…</div>;

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <header className="sticky top-0 z-20 flex items-center gap-4 border-b border-white/10 bg-zinc-950/90 px-5 py-4 backdrop-blur-xl">
        <Link href="/" className="grid h-9 w-9 place-items-center rounded-full bg-white/5 hover:bg-white/10"><ArrowLeft size={18}/></Link>
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-white text-black"><Music2 size={18}/></div>
        <div className="mr-auto"><div className="font-semibold">Artists</div><div className="text-xs text-zinc-500">Grouped from your music metadata</div></div>
        <div className="hidden items-center gap-2 sm:flex"><div className="grid h-9 w-9 place-items-center rounded-full bg-zinc-800"><UserRound size={17}/></div><span className="text-sm">You</span></div>
      </header>

      <main className="mx-auto max-w-7xl p-5 md:p-10">
        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end">
          <div className="mr-auto"><p className="mb-2 text-sm text-zinc-500">YOUR MUSIC</p><h1 className="text-4xl font-bold tracking-tight">Artists</h1><p className="mt-2 text-zinc-500">{artists.length} artist{artists.length === 1 ? '' : 's'} found</p></div>
          <div className="relative w-full md:w-80"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={17}/><input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Search artists" className="w-full rounded-full bg-white/5 py-3 pl-10 pr-4 text-sm outline-none ring-1 ring-white/10 focus:ring-white/20"/></div>
        </div>

        {error && <div className="mb-6 rounded-xl border border-red-400/30 bg-red-950/60 px-4 py-3 text-sm text-red-200">{error}</div>}

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {filtered.map((artist, index) => (
            <section key={artist.name} className="rounded-2xl border border-white/10 bg-white/[0.025] p-4 transition hover:bg-white/[0.05]">
              <div style={{ background: colors[index % colors.length] }} className="mb-4 flex aspect-square items-end justify-between rounded-xl p-4">
                <div className="grid h-14 w-14 place-items-center rounded-full bg-black/20 text-xl font-semibold">{artist.name.trim().slice(0, 1).toUpperCase() || '?'}</div>
                <UserRound className="opacity-30" size={36}/>
              </div>
              <div className="truncate font-semibold" title={artist.name}>{artist.name}</div>
              <div className="mt-1 text-sm text-zinc-500">{artist.songs.length} song{artist.songs.length === 1 ? '' : 's'}</div>
              <div className="mt-4 max-h-28 space-y-1 overflow-auto text-xs text-zinc-500">{artist.songs.slice(0, 4).map((song) => <div key={song.id} className="truncate">{song.title}</div>)}{artist.songs.length > 4 && <div>+ {artist.songs.length - 4} more</div>}</div>
              <Link href={`/?artist=${encodeURIComponent(artist.name)}`} className="mt-4 flex items-center justify-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-medium text-black"><Play size={14} fill="currentColor"/> Open artist</Link>
            </section>
          ))}
        </div>

        {!filtered.length && <div className="rounded-2xl border border-white/10 bg-white/[0.025] px-5 py-16 text-center text-sm text-zinc-500">No artists found.</div>}
      </main>
    </div>
  );
}
