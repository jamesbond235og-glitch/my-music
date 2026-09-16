import { File as MEGAFile } from 'megajs';
import { parseBuffer } from 'music-metadata';
import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MEGA_FOLDER_URL = 'https://mega.nz/folder/J6ZzRYoa#kQ2tDf5tNP8NMrrGm_EXow';

type MetaResult = {
  id:string; title:string; album:string; artist:string; artists:string[];
  albumArtist:string; albumArtists:string[]; composers:string[];
  genre:string[]; year:number|null; track:{no?:number;of?:number}|null;
};

const clean=(v:unknown)=>String(v??'').replace(/\0/g,'').replace(/\s+/g,' ').trim();
const split=(v:unknown):string[]=>{
  if(Array.isArray(v)) return v.flatMap(split);
  const s=clean(v); if(!s)return [];
  return s.split(/[;\n\r]+/).map(clean).filter(Boolean);
};
const unique=(a:string[])=>Array.from(new Set(a.map(clean).filter(Boolean)));

async function findById(folder:any,id:string):Promise<any|null>{
  const queue=[folder];
  while(queue.length){
    const current=queue.shift();
    const children=Array.isArray(current?.children)?current.children:[];
    for(const child of children){
      const childId=String(child?.nodeId||child?.downloadId||'');
      if(childId===id&&!child?.directory)return child;
      if(child?.directory||Array.isArray(child?.children))queue.push(child);
    }
  }
  return null;
}

async function readWhole(file:any):Promise<Buffer>{
  const size=Number(file?.size||0);
  if(!size)throw new Error('MEGA file has no readable size');
  const stream=file.download({start:0,end:size-1,maxConnections:1,forceHttps:true});
  const chunks:Buffer[]=[];
  await new Promise<void>((resolve,reject)=>{
    stream.on('data',(chunk:Buffer)=>chunks.push(Buffer.from(chunk)));
    stream.on('end',resolve);
    stream.on('error',reject);
  });
  return Buffer.concat(chunks);
}

function nativeValues(native:any, keys:string[]):string[]{
  const out:string[]=[];
  for(const group of Object.values(native||{}) as any[]){
    for(const tag of Array.isArray(group)?group:[]){
      const id=clean(tag?.id||tag?.key||'').toUpperCase();
      const value=tag?.value;
      if(keys.some(k=>id===k||id.includes(k))){out.push(...split(value));}
    }
  }
  return out;
}

async function parseOne(file:any,id:string):Promise<MetaResult>{
  const fileName=String(file?.name||'track.m4a');
  try{
    const bytes=await readWhole(file);
    const metadata=await parseBuffer(bytes,{path:fileName});
    const common:any=metadata.common||{};
    const native:any=metadata.native||{};

    const commonArtists=unique([...split(common.artists),...split(common.artist)]);
    const nativeArtists=unique(nativeValues(native,['ARTISTS','©ART','TPE1']));
    const artists=unique([...commonArtists,...nativeArtists]);

    const albumArtists=unique([...split(common.albumartists),...split(common.albumartist),...nativeValues(native,['AART','ALBUMARTIST','TPE2'])]);
    const composers=unique([...split(common.composer),...nativeValues(native,['©WRT','©COM','COMPOSER','TCOM','CMPR'])]);
    const artist=clean(common.artist)||artists[0]||albumArtists[0]||'';
    const albumArtist=clean(common.albumartist)||albumArtists[0]||'';

    return {
      id,
      title:clean(common.title),
      album:clean(common.album),
      artist,
      artists:artists.length?artists:(artist?[artist]:[]),
      albumArtist,
      albumArtists:albumArtists.length?albumArtists:(albumArtist?[albumArtist]:[]),
      composers,
      genre:unique(split(common.genre)),
      year:typeof common.year==='number'?common.year:null,
      track:common.track||null,
    };
  }catch(error){
    console.warn(`Metadata parse failed for ${fileName}:`,error);
    return {id,title:'',album:'',artist:'',artists:[],albumArtist:'',albumArtists:[],composers:[],genre:[],year:null,track:null};
  }
}

export async function GET(request:NextRequest){
  const ids=(request.nextUrl.searchParams.get('ids')||'').split(',').map(v=>v.trim()).filter(Boolean).slice(0,20);
  if(!ids.length)return Response.json([]);
  try{
    const root=MEGAFile.fromURL(MEGA_FOLDER_URL);
    await root.loadAttributes();
    const results:MetaResult[]=[];
    for(const id of ids){
      const file=await findById(root,id);
      if(file)results.push(await parseOne(file,id));
    }
    return Response.json(results,{headers:{'Cache-Control':'private, max-age=120'}});
  }catch(error){
    console.error('MEGA metadata batch error:',error);
    return new Response(`Unable to read song metadata: ${error instanceof Error?error.message:String(error)}`,{status:502});
  }
}
