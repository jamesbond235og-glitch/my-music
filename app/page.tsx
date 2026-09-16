'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {Home,Search,Library,Heart,Plus,ChevronLeft,ChevronRight,Play,Pause,SkipBack,SkipForward,Shuffle,Repeat2,Volume2,MoreHorizontal,Music2,Disc3,UserRound} from 'lucide-react';

type Song={id:number,title:string,artist:string,album:string,quality:string,cover:string,duration:string,stream:string,path:string,format:string};

type LibraryResponse={songs:Song[]};

const fallbackCover=(index:number)=>[
  'linear-gradient(135deg,#7c3aed,#0ea5e9)',
  'linear-gradient(135deg,#059669,#164e63)',
  'linear-gradient(135deg,#be123c,#7f1d1d)',
  'linear-gradient(135deg,#334155,#0f172a)',
  'linear-gradient(135deg,#ea580c,#7c2d12)',
  'linear-gradient(135deg,#2563eb,#312e81)'
][index%6];

export default function Page(){
  const [songs,setSongs]=useState<Song[]>([]);
  const [current,setCurrent]=useState<Song|null>(null);
  const [playing,setPlaying]=useState(false);
  const [liked,setLiked]=useState(false);
  const [query,setQuery]=useState('');
  const audioRef=useRef<HTMLAudioElement>(null);
  const audioContextRef=useRef<AudioContext|null>(null);
  const alacBufferRef=useRef<AudioBuffer|null>(null);
  const alacSourceRef=useRef<AudioBufferSourceNode|null>(null);
  const alacStartedAtRef=useRef(0);
  const alacOffsetRef=useRef(0);
  const alacLoadingRef=useRef(false);
  const [streamError,setStreamError]=useState('');
  const [position,setPosition]=useState(0);
  const [duration,setDuration]=useState(0);
  const [loading,setLoading]=useState(true);
  const [libraryError,setLibraryError]=useState('');

  const stopAlac=()=>{
    const source=alacSourceRef.current;
    if(source){try{source.stop();}catch{}}
    alacSourceRef.current=null;
    const ctx=audioContextRef.current;
    if(ctx&&alacBufferRef.current){
      alacOffsetRef.current=Math.min(Math.max(0,ctx.currentTime-alacStartedAtRef.current+alacOffsetRef.current),alacBufferRef.current.duration);
    }
  };

  const loadAlac=async()=>{
    if(!current||current.format!=='m4a')return null;
    if(alacBufferRef.current||alacLoadingRef.current)return alacBufferRef.current;
    alacLoadingRef.current=true;
    setLoading(true);
    setStreamError('');
    try{
      const response=await fetch(current.stream,{cache:'no-store'});
      if(!response.ok)throw new Error(await response.text());
      const bytes=new Uint8Array(await response.arrayBuffer());
      const decoderModule=await import('@audio/decode-mp4');
      const decodeMp4=decoderModule.default;
      const decoded=await decodeMp4(bytes);
      const ctx=audioContextRef.current??new AudioContext();
      audioContextRef.current=ctx;
      const channels=decoded.channelData.length;
      const frameCount=decoded.channelData[0]?.length??0;
      if(!channels||!frameCount)throw new Error('M4A decoder returned no audio samples');
      const buffer=ctx.createBuffer(channels,frameCount,decoded.sampleRate);
      decoded.channelData.forEach((channel,index)=>buffer.getChannelData(index).set(channel));
      alacBufferRef.current=buffer;
      setDuration(buffer.duration);
      return buffer;
    }catch(error){
      const message=error instanceof Error?error.message:String(error);
      setStreamError(`M4A playback failed: ${message}`);
      return null;
    }finally{
      alacLoadingRef.current=false;
      setLoading(false);
    }
  };

  const playAlac=async()=>{
    const buffer=await loadAlac();
    if(!buffer)return;
    const ctx=audioContextRef.current??new AudioContext();
    audioContextRef.current=ctx;
    await ctx.resume();
    const source=ctx.createBufferSource();
    source.buffer=buffer;
    source.connect(ctx.destination);
    const offset=Math.min(alacOffsetRef.current,Math.max(0,buffer.duration-0.001));
    alacStartedAtRef.current=ctx.currentTime;
    alacSourceRef.current=source;
    source.onended=()=>{
      if(alacSourceRef.current===source){
        alacOffsetRef.current=0;
        alacSourceRef.current=null;
        setPosition(0);
        setPlaying(false);
      }
    };
    source.start(0,offset);
    setPlaying(true);
  };

  useEffect(()=>{
    let cancelled=false;
    setLoading(true);
    fetch('/api/library',{cache:'no-store'})
      .then(async response=>{
        if(!response.ok)throw new Error(await response.text());
        return response.json() as Promise<LibraryResponse>;
      })
      .then(data=>{
        if(cancelled)return;
        const normalized=(data.songs||[]).map((song,index)=>({...song,cover:fallbackCover(index)}));
        setSongs(normalized);
        setCurrent(normalized[0]||null);
        setLibraryError(normalized.length?'':'No audio files found in the My Music folder.');
      })
      .catch(error=>{
        if(cancelled)return;
        setLibraryError(error instanceof Error?error.message:String(error));
      })
      .finally(()=>{if(!cancelled)setLoading(false)});
    return()=>{cancelled=true};
  },[]);

  useEffect(()=>{
    if(!current)return;
    stopAlac();
    alacBufferRef.current=null;
    alacOffsetRef.current=0;
    setPosition(0);
    setDuration(0);
    setStreamError('');
    const a=audioRef.current;
    if(a)a.pause();

    if(current.format==='m4a'){
      if(playing)playAlac();
    }else if(a){
      a.src=current.stream;
      a.load();
      if(playing)a.play().catch(()=>setPlaying(false));
    }
    return()=>stopAlac();
  },[current]);

  useEffect(()=>{
    const timer=window.setInterval(()=>{
      const ctx=audioContextRef.current;
      const buffer=alacBufferRef.current;
      if(current?.format==='m4a'&&playing&&ctx&&buffer&&alacSourceRef.current){
        setPosition(Math.min(buffer.duration,ctx.currentTime-alacStartedAtRef.current+alacOffsetRef.current));
      }
    },200);
    return()=>window.clearInterval(timer);
  },[current?.id,playing]);

  useEffect(()=>{
    const a=audioRef.current;
    if(!a)return;
    const onTime=()=>{if(current?.format!=='m4a')setPosition(a.currentTime)};
    const onMeta=()=>{if(current?.format!=='m4a')setDuration(a.duration||0)};
    const onError=()=>{if(current?.format!=='m4a')setStreamError('Audio stream could not be loaded.')};
    a.addEventListener('timeupdate',onTime);
    a.addEventListener('loadedmetadata',onMeta);
    a.addEventListener('error',onError);
    return()=>{a.removeEventListener('timeupdate',onTime);a.removeEventListener('loadedmetadata',onMeta);a.removeEventListener('error',onError)};
  },[current?.format]);

  const togglePlayback=async()=>{
    if(!current)return;
    setStreamError('');
    if(current.format==='m4a'){
      if(playing){
        const ctx=audioContextRef.current;
        if(ctx&&alacSourceRef.current){
          alacOffsetRef.current=Math.min(ctx.currentTime-alacStartedAtRef.current+alacOffsetRef.current,alacBufferRef.current?.duration??0);
          stopAlac();
        }
        setPlaying(false);
      }else await playAlac();
      return;
    }
    const a=audioRef.current;
    if(!a)return;
    if(a.paused){
      try{await a.play();setPlaying(true)}catch{setStreamError('Audio playback failed.')}}
    else{a.pause();setPlaying(false)}
  };

  const filtered=useMemo(()=>songs.filter(s=>(s.title+s.artist+s.album+s.path).toLowerCase().includes(query.toLowerCase())),[songs,query]);
  const albums=useMemo(()=>{
    const seen=new Set<string>();
    return songs.reduce<Song[]>((acc,s)=>{if(!seen.has(s.album)){seen.add(s.album);acc.push(s)}return acc},[]).slice(0,8);
  },[songs]);

  if(loading&&!songs.length)return <div className="min-h-screen bg-zinc-950 text-white"><div className="grid min-h-screen place-items-center text-sm text-zinc-500">Loading your My Music library…</div></div>;

  return <div className="min-h-screen bg-zinc-950 pb-28 text-white">
    <aside className="fixed left-0 top-0 hidden h-screen w-64 border-r border-white/10 bg-zinc-950/95 p-6 md:block">
      <div className="mb-10 flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-white text-black"><Music2 size={21}/></div><div><div className="font-bold">MY MUSIC</div><div className="text-xs text-zinc-500">MEGA library</div></div></div>
      <nav className="space-y-2">{[[Home,'Home'],[Search,'Search'],[Library,'Your Library'],[Heart,'Favorites']].map(([I,n]:any)=><button key={n} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm text-zinc-400 hover:bg-white/5 hover:text-white"><I size={18}/>{n}</button>)}</nav>
      <div className="mt-10 border-t border-white/10 pt-6"><div className="mb-3 flex items-center justify-between text-xs font-semibold text-zinc-500"><span>FOLDERS</span><Plus size={15}/></div><div className="space-y-1 text-sm text-zinc-400">{albums.slice(0,6).map(a=><button key={a.album} className="w-full truncate rounded-lg px-3 py-2 text-left hover:bg-white/5">{a.album}</button>)}</div></div>
    </aside>

    <main className="md:ml-64">
      <header className="sticky top-0 z-20 flex items-center gap-4 border-b border-white/10 bg-zinc-950/85 px-5 py-4 backdrop-blur-xl"><div className="flex gap-2"><button className="grid h-9 w-9 place-items-center rounded-full bg-white/5"><ChevronLeft size={18}/></button><button className="grid h-9 w-9 place-items-center rounded-full bg-white/5"><ChevronRight size={18}/></button></div><div className="relative max-w-xl flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search your music" className="w-full rounded-full bg-white/5 py-2.5 pl-10 pr-4 text-sm outline-none ring-1 ring-white/5 focus:ring-white/20"/></div><div className="hidden items-center gap-2 sm:flex"><div className="grid h-9 w-9 place-items-center rounded-full bg-zinc-800"><UserRound size={17}/></div><span className="text-sm">You</span></div></header>
      <section className="p-5 md:p-10">
        <div className="mb-10"><p className="mb-2 text-sm text-zinc-500">YOUR PERSONAL LIBRARY</p><h1 className="text-4xl font-bold tracking-tight md:text-5xl">Good evening.</h1><p className="mt-3 text-zinc-500">Original files. Lossless playback. Your music.</p></div>
        {libraryError&&<div className="mb-6 rounded-xl border border-red-400/30 bg-red-950/60 px-4 py-3 text-sm text-red-200">{libraryError}</div>}
        <div className="mb-12"><div className="mb-4 flex items-center justify-between"><h2 className="text-xl font-semibold">Your albums</h2><span className="text-sm text-zinc-500">{albums.length} folders</span></div><div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">{albums.map((album,index)=><button key={album.album} onClick={()=>setQuery(album.album)} className="group text-left"><div style={{background:fallbackCover(index)}} className="mb-3 aspect-square rounded-2xl p-5 shadow-2xl transition group-hover:scale-[1.02]"><div className="flex h-full items-end"><Disc3 className="opacity-30" size={42}/></div></div><div className="truncate font-medium">{album.album}</div><div className="truncate text-sm text-zinc-500">{songs.filter(s=>s.album===album.album).length} tracks</div></button>)}</div></div>
        <div><div className="mb-4 flex items-center justify-between"><h2 className="text-xl font-semibold">Songs</h2><span className="text-sm text-zinc-500">{filtered.length} tracks</span></div><div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.025]">{filtered.map((s,i)=><div key={s.id} onDoubleClick={()=>{setCurrent(s);setPlaying(true)}} className="group flex items-center gap-4 border-b border-white/5 px-4 py-3 last:border-0 hover:bg-white/5"><div className="grid w-6 place-items-center text-xs text-zinc-600">{i+1}</div><div style={{background:s.cover}} className="h-11 w-11 shrink-0 rounded-lg"/><div className="min-w-0 flex-1"><div className="truncate font-medium">{s.title}</div><div className="truncate text-sm text-zinc-500">{s.artist} · {s.album}</div></div><div className="hidden text-xs text-zinc-500 lg:block">{s.quality}</div><div className="text-sm text-zinc-600">{duration?new Date(duration*1000).toISOString().substring(14,19):s.duration}</div><button onClick={()=>{setCurrent(s);setPlaying(true)}} className="grid h-9 w-9 place-items-center rounded-full bg-white text-black opacity-0 transition group-hover:opacity-100"><Play size={15} fill="currentColor"/></button></div>)}</div></div>
      </section>
    </main>

    <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-white/10 bg-zinc-900/95 px-4 py-3 backdrop-blur-xl md:ml-64"><div className="mx-auto flex max-w-7xl items-center gap-4"><div style={{background:current?.cover||fallbackCover(0)}} className="hidden h-12 w-12 shrink-0 rounded-lg sm:block"/><div className="min-w-0 w-44"><div className="truncate text-sm font-medium">{current?.title||'No song selected'}</div><div className="truncate text-xs text-zinc-500">{current?.artist||''}</div></div><div className="flex flex-1 items-center justify-center gap-4"><button className="hidden text-zinc-500 hover:text-white sm:block"><Shuffle size={17}/></button><button><SkipBack size={19} fill="currentColor"/></button><button onClick={togglePlayback} disabled={!current||loading} className="grid h-10 w-10 place-items-center rounded-full bg-white text-black">{loading?<span className="text-xs">…</span>:playing?<Pause size={18} fill="currentColor"/>:<Play size={18} fill="currentColor"/>}</button><button><SkipForward size={19} fill="currentColor"/></button><button className="hidden text-zinc-500 hover:text-white sm:block"><Repeat2 size={17}/></button></div><div className="hidden items-center gap-3 md:flex"><span className="text-[10px] text-zinc-500">{current?.quality||''}</span><button onClick={()=>setLiked(!liked)} className={liked?'text-white':'text-zinc-500'}><Heart size={18} fill={liked?'currentColor':'none'}/></button><Volume2 size={18} className="text-zinc-500"/><MoreHorizontal size={19} className="text-zinc-500"/></div></div><div className="mx-auto mt-2 h-1 max-w-7xl overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-white" style={{width:`${duration?Math.min(100,(position/duration)*100):0}%`}}/></div></div>
    {current&&current.format!=='m4a'&&<audio ref={audioRef} src={current.stream} preload="metadata" onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)} onEnded={()=>setPlaying(false)}/>} 
    {streamError&&<div className="fixed left-1/2 top-20 z-50 max-w-[90vw] -translate-x-1/2 rounded-xl border border-red-400/30 bg-red-950/90 px-4 py-3 text-sm text-red-200 shadow-2xl">{streamError}</div>}
    <div className="fixed bottom-20 left-0 right-0 flex justify-around border-t border-white/10 bg-zinc-950/95 p-2 md:hidden"><button className="p-2 text-zinc-400"><Home size={20}/></button><button className="p-2 text-zinc-400"><Search size={20}/></button><button className="p-2 text-zinc-400"><Library size={20}/></button><button className="p-2 text-zinc-400"><Heart size={20}/></button></div>
  </div>;
}
