'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import decodeMp4 from '@audio/decode-mp4';
import { Home, Search, Library, Heart, ChevronLeft, ChevronRight, Play, Pause, SkipBack, SkipForward, Shuffle, Repeat2, Volume2, MoreHorizontal, Music2, Disc3, UserRound, FolderOpen, ArrowLeft, Users } from 'lucide-react';

type Song = {
  id: number; title: string; artist: string; album: string; quality: string;
  fileName: string; path: string; fileId: string; format: string; duration: string; stream: string; cover?: string;
};
type Album = { name: string; path: string; songs: Song[]; cover?: string };
type Artist = { name: string; songs: Song[] };
type LibraryResponse = { folder: string; albums: Album[]; artists: Artist[]; singles: Song[]; songs: Song[] };

const gradients = [
  'linear-gradient(135deg,#7c3aed,#0ea5e9)', 'linear-gradient(135deg,#059669,#164e63)',
  'linear-gradient(135deg,#be123c,#7f1d1d)', 'linear-gradient(135deg,#334155,#0f172a)',
  'linear-gradient(135deg,#ea580c,#7c2d12)', 'linear-gradient(135deg,#2563eb,#312e81)',
];
const fallbackCover = (i:number) => gradients[i % gradients.length];

export default function Page() {
  const [albums,setAlbums]=useState<Album[]>([]);
  const [artists,setArtists]=useState<Artist[]>([]);
  const [singles,setSingles]=useState<Song[]>([]);
  const [selectedAlbum,setSelectedAlbum]=useState<Album|null>(null);
  const [selectedArtist,setSelectedArtist]=useState<string|null>(null);
  const [current,setCurrent]=useState<Song|null>(null);
  const [playing,setPlaying]=useState(false);
  const [liked,setLiked]=useState(false);
  const [query,setQuery]=useState('');
  const [libraryError,setLibraryError]=useState('');
  const [loading,setLoading]=useState(true);
  const [loadingTrack,setLoadingTrack]=useState(false);
  const [streamError,setStreamError]=useState('');
  const [position,setPosition]=useState(0);
  const [duration,setDuration]=useState(0);
  const audioRef=useRef<HTMLAudioElement>(null);
  const audioContextRef=useRef<AudioContext|null>(null);
  const alacBufferRef=useRef<AudioBuffer|null>(null);
  const alacSourceRef=useRef<AudioBufferSourceNode|null>(null);
  const alacStartedAtRef=useRef(0);
  const alacOffsetRef=useRef(0);
  const alacLoadingRef=useRef(false);

  useEffect(()=>{
    let cancelled=false;
    fetch('/api/library',{cache:'no-store'})
      .then(async r=>{if(!r.ok)throw new Error(await r.text());return r.json() as Promise<LibraryResponse>})
      .then(data=>{
        if(cancelled)return;
        const a=(data.albums||[]).map((album,index)=>({
          ...album,
          songs:(album.songs||[]).map(song=>({...song,cover:album.cover||fallbackCover(index)}))
        }));
        const s=(data.singles||[]).map((song,index)=>({...song,cover:fallbackCover(a.length+index)}));
        setAlbums(a); setArtists(data.artists||[]); setSingles(s);
        setSelectedAlbum(a[0]||null);
        setCurrent(a[0]?.songs[0]||s[0]||null);
      })
      .catch(e=>{if(!cancelled)setLibraryError(e instanceof Error?e.message:String(e))})
      .finally(()=>{if(!cancelled)setLoading(false)});
    return()=>{cancelled=true};
  },[]);

  const stopAlac=()=>{
    const s=alacSourceRef.current;
    if(s){try{s.stop()}catch{} alacSourceRef.current=null;}
    const c=audioContextRef.current,b=alacBufferRef.current;
    if(c&&b)alacOffsetRef.current=Math.min(Math.max(0,c.currentTime-alacStartedAtRef.current+alacOffsetRef.current),b.duration);
  };
  const resetTrack=()=>{stopAlac();alacBufferRef.current=null;alacOffsetRef.current=0;setPosition(0);setDuration(0);setStreamError('');audioRef.current?.pause()};

  const loadAlac=async()=>{
    if(!current||current.format!=='m4a')return null;
    if(alacBufferRef.current||alacLoadingRef.current)return alacBufferRef.current;
    alacLoadingRef.current=true;setLoadingTrack(true);setStreamError('');
    try{
      const r=await fetch(current.stream,{cache:'no-store'});
      if(!r.ok)throw new Error(await r.text());
      const bytes=new Uint8Array(await r.arrayBuffer());
      const decoded=await decodeMp4(bytes);
      const c=audioContextRef.current??new AudioContext(); audioContextRef.current=c;
      const channels=decoded.channelData.length; const frames=decoded.channelData[0]?.length??0;
      if(!channels||!frames)throw new Error('M4A decoder returned no audio samples');
      const b=c.createBuffer(channels,frames,decoded.sampleRate);
      decoded.channelData.forEach((ch,i)=>b.getChannelData(i).set(ch));
      alacBufferRef.current=b;setDuration(b.duration);return b;
    }catch(e){setStreamError(`M4A playback failed: ${e instanceof Error?e.message:String(e)}`);return null}
    finally{alacLoadingRef.current=false;setLoadingTrack(false)}
  };
  const playAlac=async()=>{
    const b=await loadAlac(); if(!b)return;
    const c=audioContextRef.current??new AudioContext(); audioContextRef.current=c; await c.resume();
    const s=c.createBufferSource(); s.buffer=b;s.connect(c.destination);
    const off=Math.min(alacOffsetRef.current,Math.max(0,b.duration-0.001));
    alacStartedAtRef.current=c.currentTime;alacSourceRef.current=s;
    s.onended=()=>{if(alacSourceRef.current===s){alacSourceRef.current=null;alacOffsetRef.current=0;setPosition(0);setPlaying(false)}};
    s.start(0,off);setPlaying(true);
  };

  useEffect(()=>{
    if(!current)return;
    resetTrack();
    const a=audioRef.current;
    if(current.format==='m4a'){if(playing)void playAlac();}
    else if(a){a.src=current.stream;a.load();if(playing)a.play().catch(()=>setPlaying(false));}
    return()=>stopAlac();
  },[current]);
  useEffect(()=>{
    const t=window.setInterval(()=>{
      const c=audioContextRef.current,b=alacBufferRef.current;
      if(current?.format==='m4a'&&playing&&c&&b&&alacSourceRef.current)setPosition(Math.min(b.duration,c.currentTime-alacStartedAtRef.current+alacOffsetRef.current));
    },200); return()=>window.clearInterval(t);
  },[current?.id,playing]);
  useEffect(()=>{
    const a=audioRef.current;if(!a)return;
    const onTime=()=>{if(current?.format!=='m4a')setPosition(a.currentTime)};
    const onMeta=()=>{if(current?.format!=='m4a')setDuration(a.duration||0)};
    const onErr=()=>{if(current?.format!=='m4a')setStreamError('Audio stream could not be loaded.')};
    a.addEventListener('timeupdate',onTime);a.addEventListener('loadedmetadata',onMeta);a.addEventListener('error',onErr);
    return()=>{a.removeEventListener('timeupdate',onTime);a.removeEventListener('loadedmetadata',onMeta);a.removeEventListener('error',onErr)};
  },[current?.format]);

  const togglePlayback=async()=>{
    if(!current)return; setStreamError('');
    if(current.format==='m4a'){
      if(playing){const c=audioContextRef.current,b=alacBufferRef.current;if(c&&b&&alacSourceRef.current)alacOffsetRef.current=Math.min(c.currentTime-alacStartedAtRef.current+alacOffsetRef.current,b.duration);stopAlac();setPlaying(false)}
      else await playAlac();
      return;
    }
    const a=audioRef.current;if(!a)return;
    if(a.paused){try{await a.play();setPlaying(true)}catch{setStreamError('Audio playback failed.')}} else {a.pause();setPlaying(false)}
  };
  const selectAlbum=(album:Album)=>{setSelectedAlbum(album);setSelectedArtist(null);setQuery('');setPlaying(false);resetTrack();setCurrent(album.songs[0]||null)};
  const selectArtist=(artist:Artist)=>{setSelectedArtist(artist.name);setSelectedAlbum(null);setQuery('');setPlaying(false);resetTrack();setCurrent(artist.songs[0]||null)};
  const allSongs=useMemo(()=>albums.flatMap(a=>a.songs).concat(singles),[albums,singles]);
  const q=query.trim().toLowerCase();
  const visibleSongs=useMemo(()=>{
    if(q)return allSongs.filter(s=>(s.title+' '+s.artist+' '+s.album+' '+s.fileName).toLowerCase().includes(q));
    if(selectedArtist)return artists.find(a=>a.name===selectedArtist)?.songs||[];
    return selectedAlbum?selectedAlbum.songs:singles;
  },[q,allSongs,selectedArtist,selectedAlbum,singles,artists]);
  const goHome=()=>{setSelectedAlbum(null);setSelectedArtist(null);setQuery('');setPlaying(false);resetTrack();setCurrent(albums[0]?.songs[0]||singles[0]||null)};

  if(loading)return <div className="grid min-h-screen place-items-center bg-zinc-950 text-sm text-zinc-500">Loading your My Music library…</div>;
  return <div className="min-h-screen bg-zinc-950 pb-28 text-white">
    <aside className="fixed left-0 top-0 hidden h-screen w-64 border-r border-white/10 bg-zinc-950/95 p-6 md:block">
      <div className="mb-10 flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-white text-black"><Music2 size={21}/></div><div><div className="font-bold">MY MUSIC</div><div className="text-xs text-zinc-500">MEGA library</div></div></div>
      <nav className="space-y-2">
        <button onClick={goHome} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm text-zinc-400 hover:bg-white/5 hover:text-white"><Home size={18}/>Home</button>
        <button className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm text-zinc-400 hover:bg-white/5 hover:text-white"><Search size={18}/>Search</button>
        <button onClick={goHome} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm text-zinc-400 hover:bg-white/5 hover:text-white"><Library size={18}/>Your Library</button>
        <button className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm text-zinc-400 hover:bg-white/5 hover:text-white"><Heart size={18}/>Favorites</button>
      </nav>
      <div className="mt-8 border-t border-white/10 pt-6"><div className="mb-3 text-xs font-semibold text-zinc-500">FOLDERS</div>{albums.slice(0,8).map(a=><button key={a.path} onClick={()=>selectAlbum(a)} className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${selectedAlbum?.path===a.path?'bg-white/10 text-white':'text-zinc-400 hover:bg-white/5'}`}><FolderOpen size={15}/><span className="truncate">{a.name}</span></button>)}</div>
      <div className="mt-6 border-t border-white/10 pt-6"><div className="mb-3 text-xs font-semibold text-zinc-500">ARTISTS</div>{artists.slice(0,8).map(a=><button key={a.name} onClick={()=>selectArtist(a)} className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${selectedArtist===a.name?'bg-white/10 text-white':'text-zinc-400 hover:bg-white/5'}`}><Users size={15}/><span className="truncate">{a.name}</span></button>)}</div>
    </aside>
    <main className="md:ml-64"><header className="sticky top-0 z-20 flex items-center gap-4 border-b border-white/10 bg-zinc-950/85 px-5 py-4 backdrop-blur-xl"><div className="flex gap-2"><button className="grid h-9 w-9 place-items-center rounded-full bg-white/5"><ChevronLeft size={18}/></button><button className="grid h-9 w-9 place-items-center rounded-full bg-white/5"><ChevronRight size={18}/></button></div><div className="relative max-w-xl flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search your music" className="w-full rounded-full bg-white/5 py-2.5 pl-10 pr-4 text-sm outline-none ring-1 ring-white/5 focus:ring-white/20"/></div><div className="hidden items-center gap-2 sm:flex"><div className="grid h-9 w-9 place-items-center rounded-full bg-zinc-800"><UserRound size={17}/></div><span className="text-sm">You</span></div></header>
      <section className="p-5 md:p-10">
        <div className="mb-10"><p className="mb-2 text-sm text-zinc-500">YOUR PERSONAL LIBRARY</p><h1 className="text-4xl font-bold tracking-tight md:text-5xl">Good evening.</h1><p className="mt-3 text-zinc-500">Your MEGA folders are your albums. Add <strong className="text-zinc-300">cover.jpg</strong>, <strong className="text-zinc-300">cover.png</strong>, or <strong className="text-zinc-300">cover.webp</strong> inside an album folder for its artwork.</p></div>
        {libraryError&&<div className="mb-6 rounded-xl border border-red-400/30 bg-red-950/60 px-4 py-3 text-sm text-red-200">{libraryError}</div>}
        {!q&&!selectedAlbum&&!selectedArtist&&<div className="mb-12"><div className="mb-4 flex items-center justify-between"><h2 className="text-xl font-semibold">Your albums</h2><span className="text-sm text-zinc-500">{albums.length} folders</span></div><div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">{albums.map((album,i)=><button key={album.path} onClick={()=>selectAlbum(album)} className="group text-left"><div className="relative mb-3 aspect-square overflow-hidden rounded-2xl shadow-2xl transition group-hover:scale-[1.02]">{album.cover?<img src={album.cover} alt={`${album.name} cover`} className="h-full w-full object-cover" loading="lazy"/>:<div style={{background:fallbackCover(i)}} className="flex h-full w-full items-end p-5"><Disc3 className="opacity-30" size={42}/></div>}<div className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full bg-black/45 backdrop-blur"><FolderOpen size={16}/></div></div><div className="truncate font-medium">{album.name}</div><div className="truncate text-sm text-zinc-500">{album.songs.length} songs</div></button>)}</div></div>}
        {selectedArtist&&!q&&<div className="mb-6 flex items-center gap-3"><button onClick={goHome} className="grid h-8 w-8 place-items-center rounded-full bg-white/5 hover:bg-white/10"><ArrowLeft size={16}/></button><div><h2 className="text-xl font-semibold">{selectedArtist}</h2><div className="text-xs text-zinc-500">{visibleSongs.length} songs by this artist</div></div></div>}
        {selectedAlbum&&!q&&!selectedArtist&&<div className="mb-6 flex items-center gap-3"><button onClick={goHome} className="grid h-8 w-8 place-items-center rounded-full bg-white/5 hover:bg-white/10"><ArrowLeft size={16}/></button><div><h2 className="text-xl font-semibold">{selectedAlbum.name}</h2><div className="text-xs text-zinc-500">Songs inside this MEGA folder</div></div></div>}
        {(q||selectedAlbum||selectedArtist)&&<div><div className="mb-4 flex items-center justify-between">{q&&<h2 className="text-xl font-semibold">Search results</h2>}<span className="text-sm text-zinc-500">{visibleSongs.length} tracks</span></div><div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.025]">{visibleSongs.length?visibleSongs.map((song,i)=><div key={`${song.id}-${song.path}`} className={`group flex items-center gap-4 border-b border-white/5 px-4 py-3 last:border-0 hover:bg-white/5 ${current?.id===song.id?'bg-white/5':''}`}><div className="grid w-6 place-items-center text-xs text-zinc-600">{i+1}</div><div className="h-11 w-11 shrink-0 overflow-hidden rounded-lg">{song.cover?<img src={song.cover} alt="" className="h-full w-full object-cover" loading="lazy"/>:<div style={{background:fallbackCover(i)}} className="h-full w-full"/>}</div><div className="min-w-0 flex-1"><div className="truncate font-medium">{song.title}</div><div className="truncate text-sm text-zinc-500">{song.artist} · {song.album}</div></div><div className="hidden text-xs text-zinc-500 lg:block">{song.quality}</div><button onClick={()=>{setCurrent(song);setPlaying(true)}} className="grid h-9 w-9 place-items-center rounded-full bg-white text-black opacity-0 transition group-hover:opacity-100"><Play size={15} fill="currentColor"/></button></div>):<div className="px-5 py-10 text-center text-sm text-zinc-500">No songs in this section.</div>}</div></div>}
      </section>
    </main>
    <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-white/10 bg-zinc-900/95 px-4 py-3 backdrop-blur-xl md:ml-64"><div className="mx-auto flex max-w-7xl items-center gap-4"><div className="hidden h-12 w-12 shrink-0 overflow-hidden rounded-lg sm:block">{current?.cover?<img src={current.cover} alt="" className="h-full w-full object-cover"/>:<div style={{background:fallbackCover(0)}} className="h-full w-full"/>}</div><div className="min-w-0 w-44"><div className="truncate text-sm font-medium">{current?.title||'No song selected'}</div><div className="truncate text-xs text-zinc-500">{current?.artist||''}</div></div><div className="flex flex-1 items-center justify-center gap-4"><button className="hidden text-zinc-500 hover:text-white sm:block"><Shuffle size={17}/></button><button><SkipBack size={19} fill="currentColor"/></button><button onClick={togglePlayback} disabled={!current||loadingTrack} className="grid h-10 w-10 place-items-center rounded-full bg-white text-black">{loadingTrack?<span className="text-xs">…</span>:playing?<Pause size={18} fill="currentColor"/>:<Play size={18} fill="currentColor"/>}</button><button><SkipForward size={19} fill="currentColor"/></button><button className="hidden text-zinc-500 hover:text-white sm:block"><Repeat2 size={17}/></button></div><div className="hidden items-center gap-3 md:flex"><span className="text-[10px] text-zinc-500">{current?.quality||''}</span><button onClick={()=>setLiked(!liked)} className={liked?'text-white':'text-zinc-500'}><Heart size={18} fill={liked?'currentColor':'none'}/></button><Volume2 size={18} className="text-zinc-500"/><MoreHorizontal size={19} className="text-zinc-500"/></div></div><div className="mx-auto mt-2 h-1 max-w-7xl overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-white" style={{width:`${duration?Math.min(100,(position/duration)*100):0}%`}}/></div></div>
    {current&&current.format!=='m4a'&&<audio ref={audioRef} src={current.stream} preload="metadata" onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)} onEnded={()=>setPlaying(false)}/>}
    {streamError&&<div className="fixed left-1/2 top-20 z-50 max-w-[90vw] -translate-x-1/2 rounded-xl border border-red-400/30 bg-red-950/90 px-4 py-3 text-sm text-red-200 shadow-2xl">{streamError}</div>}
  </div>;
}
