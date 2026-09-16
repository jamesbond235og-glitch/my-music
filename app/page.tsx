'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import decodeMp4 from '@audio/decode-mp4';
import { Home, Search, Library, Heart, ChevronLeft, ChevronRight, Play, Pause, SkipBack, SkipForward, Shuffle, Repeat2, Volume2, MoreHorizontal, Music2, Disc3, UserRound, FolderOpen, ArrowLeft, Users, Mic2 } from 'lucide-react';

type Song = {
  id:number; title:string; artist:string; album:string; quality:string; fileName:string;
  path:string; fileId:string; format:string; duration:string; stream:string; cover?:string;
  contributingArtists?:string[]; albumArtist?:string; composers?:string[];
};
type Album = { name:string; path:string; songs:Song[]; cover?:string };
type Artist = { name:string; songs:Song[] };
type Composer = { name:string; songs:Song[] };
type LibraryResponse = { folder:string; albums:Album[]; artists:Artist[]; singles:Song[]; songs:Song[] };
type MetadataResult = { id:string; title:string; album:string; artist:string; artists:string[]; albumArtist:string; albumArtists:string[]; composers:string[]; genre:string[]; year:number|null; track:{no?:number;of?:number}|null };

const gradients=[
  'linear-gradient(135deg,#7c3aed,#0ea5e9)','linear-gradient(135deg,#059669,#164e63)',
  'linear-gradient(135deg,#be123c,#7f1d1d)','linear-gradient(135deg,#334155,#0f172a)',
  'linear-gradient(135deg,#ea580c,#7c2d12)','linear-gradient(135deg,#2563eb,#312e81)',
];
const fallbackCover=(i:number)=>gradients[i%gradients.length];

export default function Page(){
  const [albums,setAlbums]=useState<Album[]>([]);
  const [artists,setArtists]=useState<Artist[]>([]);
  const [composers,setComposers]=useState<Composer[]>([]);
  const [singles,setSingles]=useState<Song[]>([]);
  const [selectedAlbum,setSelectedAlbum]=useState<Album|null>(null);
  const [selectedArtist,setSelectedArtist]=useState<string|null>(null);
  const [selectedComposer,setSelectedComposer]=useState<string|null>(null);
  const [current,setCurrent]=useState<Song|null>(null);
  const [playing,setPlaying]=useState(false);
  const [liked,setLiked]=useState(false);
  const [query,setQuery]=useState('');
  const [libraryError,setLibraryError]=useState('');
  const [loading,setLoading]=useState(true);
  const [loadingTrack,setLoadingTrack]=useState(false);
  const [metadataLoading,setMetadataLoading]=useState(false);
  const [streamError,setStreamError]=useState('');
  const [position,setPosition]=useState(0);
  const [duration,setDuration]=useState(0);
  const enrichedRef=useRef<Set<string>>(new Set());

  const audioRef=useRef<HTMLAudioElement>(null);
  const audioContextRef=useRef<AudioContext|null>(null);
  const alacBufferRef=useRef<AudioBuffer|null>(null);
  const alacSongIdRef=useRef<number|null>(null);
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
        const nextAlbums=(data.albums||[]).map((album,index)=>({...album,songs:(album.songs||[]).map(song=>({...song,cover:album.cover||fallbackCover(index)}))}));
        const nextSingles=(data.singles||[]).map((song,index)=>({...song,cover:fallbackCover(nextAlbums.length+index)}));
        setAlbums(nextAlbums);setArtists(data.artists||[]);setSingles(nextSingles);
      })
      .catch(e=>{if(!cancelled)setLibraryError(e instanceof Error?e.message:String(e))})
      .finally(()=>{if(!cancelled)setLoading(false)});
    return()=>{cancelled=true};
  },[]);

  const allSongs=useMemo(()=>albums.flatMap(a=>a.songs).concat(singles),[albums,singles]);

  useEffect(()=>{
    if(!allSongs.length)return;
    const pending=allSongs.filter(song=>!enrichedRef.current.has(String(song.fileId))).slice(0,100);
    if(!pending.length)return;
    pending.forEach(song=>enrichedRef.current.add(String(song.fileId)));
    let cancelled=false;
    setMetadataLoading(true);
    fetch(`/api/metadata/batch?ids=${pending.map(song=>encodeURIComponent(song.fileId)).join(',')}`,{cache:'no-store'})
      .then(async r=>{if(!r.ok)throw new Error(await r.text());return r.json() as Promise<MetadataResult[]>})
      .then(results=>{
        if(cancelled)return;
        const byId=new Map(results.map(item=>[item.id,item]));
        const enrich=(song:Song):Song=>{
          const meta=byId.get(String(song.fileId));
          if(!meta)return song;
          const contributing=meta.artists.filter(Boolean);
          const displayArtist=contributing.join(', ') || meta.artist || meta.albumArtist || song.artist;
          return {...song,title:meta.title||song.title,album:meta.album||song.album,artist:displayArtist,contributingArtists:contributing,albumArtist:meta.albumArtist||meta.albumArtists[0]||'',composers:meta.composers};
        };
        const nextAlbums=albums.map(a=>({...a,songs:a.songs.map(enrich)}));
        const nextSingles=singles.map(enrich);
        setAlbums(nextAlbums);setSingles(nextSingles);
        setSelectedAlbum(prev=>prev?nextAlbums.find(album=>album.path===prev.path)||prev:prev);

        const artistMap=new Map<string,Song[]>();
        const composerMap=new Map<string,Song[]>();
        [...nextAlbums.flatMap(a=>a.songs),...nextSingles].forEach(song=>{
          const artistNames=(song.contributingArtists||[]).length?song.contributingArtists!:([song.artist].filter(Boolean));
          artistNames.forEach(name=>{const key=name.trim();if(!key||key==='Unknown Artist')return;const list=artistMap.get(key)||[];list.push(song);artistMap.set(key,list);});
          (song.composers||[]).forEach(name=>{const key=name.trim();if(!key)return;const list=composerMap.get(key)||[];list.push(song);composerMap.set(key,list);});
        });
        setArtists(Array.from(artistMap.entries()).sort((a,b)=>a[0].localeCompare(b[0])).map(([name,songs])=>({name,songs})));
        setComposers(Array.from(composerMap.entries()).sort((a,b)=>a[0].localeCompare(b[0])).map(([name,songs])=>({name,songs})));
        setCurrent(prev=>prev?[...nextAlbums.flatMap(a=>a.songs),...nextSingles].find(song=>song.id===prev.id)||prev:prev);
      })
      .catch(error=>{console.warn('Metadata enrichment failed:',error)})
      .finally(()=>{if(!cancelled)setMetadataLoading(false)});
    return()=>{cancelled=true};
  },[allSongs]);

  const stopAlac=(capturePosition=true)=>{
    const context=audioContextRef.current;
    const buffer=alacBufferRef.current;
    if(capturePosition&&context&&buffer&&alacSourceRef.current&&alacSongIdRef.current===current?.id){
      alacOffsetRef.current=Math.min(Math.max(0,context.currentTime-alacStartedAtRef.current+alacOffsetRef.current),buffer.duration);
      setPosition(alacOffsetRef.current);
    }
    const source=alacSourceRef.current;
    if(source){try{source.stop()}catch{}alacSourceRef.current=null;}
  };

  const clearLoadedTrack=()=>{
    stopAlac(false);alacBufferRef.current=null;alacSongIdRef.current=null;alacOffsetRef.current=0;
    setPosition(0);setDuration(0);setStreamError('');audioRef.current?.pause();
  };

  const loadAlac=async(song:Song)=>{
    if(song.format!=='m4a')return null;
    if(alacBufferRef.current&&alacSongIdRef.current===song.id)return alacBufferRef.current;
    if(alacLoadingRef.current)return null;
    alacLoadingRef.current=true;setLoadingTrack(true);setStreamError('');
    try{
      const response=await fetch(song.stream,{cache:'no-store'});
      if(!response.ok)throw new Error(await response.text());
      const bytes=new Uint8Array(await response.arrayBuffer());
      const decoded=await decodeMp4(bytes);
      const context=audioContextRef.current??new AudioContext();audioContextRef.current=context;
      const channels=decoded.channelData.length;const frames=decoded.channelData[0]?.length??0;
      if(!channels||!frames)throw new Error('M4A decoder returned no audio samples');
      const buffer=context.createBuffer(channels,frames,decoded.sampleRate);
      decoded.channelData.forEach((channel,index)=>buffer.getChannelData(index).set(channel));
      alacBufferRef.current=buffer;alacSongIdRef.current=song.id;alacOffsetRef.current=0;setDuration(buffer.duration);
      return buffer;
    }catch(error){setStreamError(`M4A playback failed: ${error instanceof Error?error.message:String(error)}`);return null}
    finally{alacLoadingRef.current=false;setLoadingTrack(false)}
  };

  const startAlac=async(song:Song)=>{
    const buffer=await loadAlac(song);if(!buffer)return;
    const context=audioContextRef.current??new AudioContext();audioContextRef.current=context;await context.resume();
    const source=context.createBufferSource();source.buffer=buffer;source.connect(context.destination);
    const offset=Math.min(alacOffsetRef.current,Math.max(0,buffer.duration-0.001));
    alacStartedAtRef.current=context.currentTime;alacSourceRef.current=source;
    source.onended=()=>{if(alacSourceRef.current===source){alacSourceRef.current=null;alacOffsetRef.current=0;setPosition(0);setPlaying(false)}};
    source.start(0,offset);setPlaying(true);
  };

  useEffect(()=>{
    if(!current)return;
    const audio=audioRef.current;
    if(current.format==='m4a'){
      if(audio){audio.pause();audio.removeAttribute('src');audio.load();}
      if(playing)void startAlac(current);
    }else if(audio){
      stopAlac(false);audio.src=current.stream;audio.load();
      if(playing)audio.play().catch(()=>{setPlaying(false);setStreamError('Audio playback failed.')});
    }
    return()=>{stopAlac(false)};
  },[current]);

  useEffect(()=>{
    const timer=window.setInterval(()=>{
      const context=audioContextRef.current,buffer=alacBufferRef.current,source=alacSourceRef.current;
      if(current?.format==='m4a'&&playing&&context&&buffer&&source&&alacSongIdRef.current===current.id){
        setPosition(Math.min(buffer.duration,context.currentTime-alacStartedAtRef.current+alacOffsetRef.current));
      }
    },200);
    return()=>window.clearInterval(timer);
  },[current?.id,current?.format,playing]);

  useEffect(()=>{
    const audio=audioRef.current;if(!audio)return;
    const onTime=()=>{if(current?.format!=='m4a')setPosition(audio.currentTime)};
    const onMeta=()=>{if(current?.format!=='m4a')setDuration(Number.isFinite(audio.duration)?audio.duration:0)};
    const onError=()=>{if(current?.format!=='m4a')setStreamError('Audio stream could not be loaded.')};
    audio.addEventListener('timeupdate',onTime);audio.addEventListener('loadedmetadata',onMeta);audio.addEventListener('error',onError);
    return()=>{audio.removeEventListener('timeupdate',onTime);audio.removeEventListener('loadedmetadata',onMeta);audio.removeEventListener('error',onError)};
  },[current?.format]);

  const togglePlayback=async()=>{
    if(!current)return;
    setStreamError('');
    if(current.format==='m4a'){
      if(playing){stopAlac(true);setPlaying(false);}else await startAlac(current);
      return;
    }
    const audio=audioRef.current;if(!audio)return;
    if(audio.paused){try{await audio.play();setPlaying(true)}catch{setStreamError('Audio playback failed.')}}else{audio.pause();setPlaying(false)}
  };

  const playSong=async(song:Song)=>{
    setStreamError('');
    if(current?.id===song.id){await togglePlayback();return;}
    clearLoadedTrack();setCurrent(song);setPlaying(true);
  };

  const selectAlbum=(album:Album)=>{setSelectedAlbum(album);setSelectedArtist(null);setSelectedComposer(null);setQuery('');};
  const selectArtist=(artist:Artist)=>{setSelectedArtist(artist.name);setSelectedAlbum(null);setSelectedComposer(null);setQuery('');};
  const selectComposer=(composer:Composer)=>{setSelectedComposer(composer.name);setSelectedAlbum(null);setSelectedArtist(null);setQuery('');};
  const goHome=()=>{setSelectedAlbum(null);setSelectedArtist(null);setSelectedComposer(null);setQuery('');};
  const q=query.trim().toLowerCase();
  const activeAlbum=selectedAlbum?albums.find(album=>album.path===selectedAlbum.path)||selectedAlbum:null;
  const visibleSongs=useMemo(()=>{
    if(q)return allSongs.filter(song=>(`${song.title} ${song.artist} ${song.album} ${song.fileName} ${(song.composers||[]).join(' ')}`).toLowerCase().includes(q));
    if(selectedComposer)return composers.find(c=>c.name===selectedComposer)?.songs||[];
    if(selectedArtist)return artists.find(a=>a.name===selectedArtist)?.songs||[];
    return activeAlbum?activeAlbum.songs:singles;
  },[q,allSongs,selectedComposer,selectedArtist,activeAlbum,singles,artists,composers]);

  if(loading)return <div className="grid min-h-screen place-items-center bg-zinc-950 text-sm text-zinc-500">Loading your My Music library…</div>;

  return <div className="min-h-screen bg-zinc-950 pb-28 text-white">
    <aside className="fixed left-0 top-0 hidden h-screen w-64 border-r border-white/10 bg-zinc-950/95 p-6 md:block">
      <div className="mb-10 flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-white text-black"><Music2 size={21}/></div><div><div className="font-bold">MY MUSIC</div><div className="text-xs text-zinc-500">MEGA library</div></div></div>
      <nav className="space-y-2">
        <button onClick={goHome} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm text-zinc-400 hover:bg-white/5 hover:text-white"><Home size={18}/>Home</button>
        <button onClick={()=>{setSelectedAlbum(null);setSelectedArtist(null);setSelectedComposer(null)}} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm text-zinc-400 hover:bg-white/5 hover:text-white"><Search size={18}/>Search</button>
        <button onClick={goHome} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm text-zinc-400 hover:bg-white/5 hover:text-white"><Library size={18}/>Your Library</button>
        <button className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm text-zinc-400 hover:bg-white/5 hover:text-white"><Heart size={18}/>Favorites</button>
      </nav>
      <div className="mt-8 border-t border-white/10 pt-6"><div className="mb-3 text-xs font-semibold text-zinc-500">FOLDERS</div>{albums.slice(0,8).map(a=><button key={a.path} onClick={()=>selectAlbum(a)} className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${selectedAlbum?.path===a.path?'bg-white/10 text-white':'text-zinc-400 hover:bg-white/5'}`}><FolderOpen size={15}/><span className="truncate">{a.name}</span></button>)}</div>
      <div className="mt-6 border-t border-white/10 pt-6"><div className="mb-3 text-xs font-semibold text-zinc-500">ARTISTS</div>{artists.slice(0,8).map(a=><button key={a.name} onClick={()=>selectArtist(a)} className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${selectedArtist===a.name?'bg-white/10 text-white':'text-zinc-400 hover:bg-white/5'}`}><Users size={15}/><span className="truncate">{a.name}</span></button>)}</div>
      <div className="mt-6 border-t border-white/10 pt-6"><div className="mb-3 text-xs font-semibold text-zinc-500">COMPOSERS</div>{composers.slice(0,8).map(c=><button key={c.name} onClick={()=>selectComposer(c)} className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${selectedComposer===c.name?'bg-white/10 text-white':'text-zinc-400 hover:bg-white/5'}`}><Mic2 size={15}/><span className="truncate">{c.name}</span></button>)}</div>
    </aside>

    <main className="md:ml-64">
      <header className="sticky top-0 z-20 flex items-center gap-4 border-b border-white/10 bg-zinc-950/85 px-5 py-4 backdrop-blur-xl"><div className="flex gap-2"><button className="grid h-9 w-9 place-items-center rounded-full bg-white/5"><ChevronLeft size={18}/></button><button className="grid h-9 w-9 place-items-center rounded-full bg-white/5"><ChevronRight size={18}/></button></div><div className="relative max-w-xl flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search your music" className="w-full rounded-full bg-white/5 py-2.5 pl-10 pr-4 text-sm outline-none ring-1 ring-white/5 focus:ring-white/20"/></div><div className="hidden items-center gap-2 sm:flex"><div className="grid h-9 w-9 place-items-center rounded-full bg-zinc-800"><UserRound size={17}/></div><span className="text-sm">You</span></div></header>
      <section className="p-5 md:p-10"><div className="mb-10"><p className="mb-2 text-sm text-zinc-500">YOUR PERSONAL LIBRARY</p><h1 className="text-4xl font-bold tracking-tight md:text-5xl">Good evening.</h1><p className="mt-3 text-zinc-500">Your MEGA folders are your albums. Add <strong className="text-zinc-300">cover.jpg</strong>, <strong className="text-zinc-300">cover.png</strong>, or <strong className="text-zinc-300">cover.webp</strong> inside an album folder for its artwork.</p></div>
        {libraryError&&<div className="mb-6 rounded-xl border border-red-400/30 bg-red-950/60 px-4 py-3 text-sm text-red-200">{libraryError}</div>}
        {!q&&!selectedAlbum&&!selectedArtist&&!selectedComposer&&<div className="mb-12"><div className="mb-4 flex items-center justify-between"><h2 className="text-xl font-semibold">Your albums</h2><span className="text-sm text-zinc-500">{albums.length} folders</span></div><div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">{albums.map((album,i)=><button key={album.path} onClick={()=>selectAlbum(album)} className="group text-left"><div className="relative mb-3 aspect-square overflow-hidden rounded-2xl shadow-2xl transition group-hover:scale-[1.02]">{album.cover?<img src={album.cover} alt={`${album.name} cover`} className="h-full w-full object-cover" loading="lazy"/>:<div style={{background:fallbackCover(i)}} className="flex h-full w-full items-end p-5"><Disc3 className="opacity-30" size={42}/></div>}<div className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full bg-black/45 backdrop-blur"><FolderOpen size={16}/></div></div><div className="truncate font-medium">{album.name}</div><div className="truncate text-sm text-zinc-500">{album.songs.length} songs</div></button>)}</div></div>}
        {selectedComposer&&!q&&<div className="mb-6 flex items-center gap-3"><button onClick={goHome} className="grid h-8 w-8 place-items-center rounded-full bg-white/5 hover:bg-white/10"><ArrowLeft size={16}/></button><div><h2 className="text-xl font-semibold">{selectedComposer}</h2><div className="text-xs text-zinc-500">{visibleSongs.length} songs by this composer</div></div></div>}
        {selectedArtist&&!q&&!selectedComposer&&<div className="mb-6 flex items-center gap-3"><button onClick={goHome} className="grid h-8 w-8 place-items-center rounded-full bg-white/5 hover:bg-white/10"><ArrowLeft size={16}/></button><div><h2 className="text-xl font-semibold">{selectedArtist}</h2><div className="text-xs text-zinc-500">{visibleSongs.length} songs by this artist</div></div></div>}
        {selectedAlbum&&!q&&!selectedArtist&&!selectedComposer&&<div className="mb-6 flex items-center gap-3"><button onClick={goHome} className="grid h-8 w-8 place-items-center rounded-full bg-white/5 hover:bg-white/10"><ArrowLeft size={16}/></button><div><h2 className="text-xl font-semibold">{activeAlbum?.name||selectedAlbum.name}</h2><div className="text-xs text-zinc-500">Songs inside this MEGA folder</div></div></div>}
        {(q||selectedAlbum||selectedArtist||selectedComposer||visibleSongs.length>0)&&<div><div className="mb-4 flex items-center justify-between">{q&&<h2 className="text-xl font-semibold">Search results</h2>}<span className="text-sm text-zinc-500">{visibleSongs.length} tracks</span></div><div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.025]">{visibleSongs.length?visibleSongs.map((song,i)=><div key={`${song.id}-${song.path}`} className={`group flex items-center gap-4 border-b border-white/5 px-4 py-3 last:border-0 hover:bg-white/5 ${current?.id===song.id?'bg-white/5':''}`}><div className="grid w-6 place-items-center text-xs text-zinc-600">{i+1}</div><div className="h-11 w-11 shrink-0 overflow-hidden rounded-lg">{song.cover?<img src={song.cover} alt="" className="h-full w-full object-cover" loading="lazy"/>:<div style={{background:fallbackCover(i)}} className="h-full w-full"/>}</div><button onClick={()=>void playSong(song)} className="min-w-0 flex-1 text-left"><div className="truncate font-medium">{song.title}</div><div className="truncate text-sm text-zinc-500">{song.artist} · {song.album}</div></button><div className="hidden text-xs text-zinc-500 lg:block">{song.quality}</div><button aria-label={current?.id===song.id&&playing?'Pause':'Play'} onClick={()=>void playSong(song)} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white text-black opacity-0 transition group-hover:opacity-100 focus:opacity-100">{current?.id===song.id&&playing?<Pause size={15} fill="currentColor"/>:<Play size={15} fill="currentColor"/>}</button></div>):<div className="px-5 py-10 text-center text-sm text-zinc-500">No songs in this folder.</div>}</div></div>}
      </section>
    </main>

    <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-white/10 bg-zinc-900/95 px-4 py-3 backdrop-blur-xl md:ml-64"><div className="mx-auto flex max-w-7xl items-center gap-4"><div className="hidden h-12 w-12 shrink-0 overflow-hidden rounded-lg sm:block">{current?.cover?<img src={current.cover} alt="" className="h-full w-full object-cover"/>:<div style={{background:fallbackCover(0)}} className="h-full w-full"/>}</div><div className="min-w-0 w-44"><div className="truncate text-sm font-medium">{current?.title||'No song selected'}</div><div className="truncate text-xs text-zinc-500">{current?.artist||''}</div></div><div className="flex flex-1 items-center justify-center gap-4"><button className="hidden text-zinc-500 hover:text-white sm:block"><Shuffle size={17}/></button><button><SkipBack size={19} fill="currentColor"/></button><button onClick={()=>void togglePlayback()} disabled={!current||loadingTrack} className="grid h-10 w-10 place-items-center rounded-full bg-white text-black disabled:opacity-60">{loadingTrack?<span className="text-xs">…</span>:playing?<Pause size={18} fill="currentColor"/>:<Play size={18} fill="currentColor"/>}</button><button><SkipForward size={19} fill="currentColor"/></button><button className="hidden text-zinc-500 hover:text-white sm:block"><Repeat2 size={17}/></button></div><div className="hidden items-center gap-3 md:flex"><span className="text-[10px] text-zinc-500">{current?.quality||''}</span><button onClick={()=>setLiked(!liked)} className={liked?'text-white':'text-zinc-500'}><Heart size={18} fill={liked?'currentColor':'none'}/></button><Volume2 size={18} className="text-zinc-500"/><MoreHorizontal size={19} className="text-zinc-500"/></div></div><div className="mx-auto mt-2 h-1 max-w-7xl overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-white" style={{width:`${duration?Math.min(100,(position/duration)*100):0}%`}}/></div></div>
    {current&&current.format!=='m4a'&&<audio ref={audioRef} preload="metadata" onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)} onEnded={()=>setPlaying(false)} />}
    {streamError&&<div className="fixed left-1/2 top-20 z-50 max-w-[90vw] -translate-x-1/2 rounded-xl border border-red-400/30 bg-red-950/90 px-4 py-3 text-sm text-red-200 shadow-2xl">{streamError}</div>}
  </div>;
}
