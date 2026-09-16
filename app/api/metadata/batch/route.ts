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

const clean=(v:unknown)=>String(v??'').replace(/\0/g,'').replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f]/g,'').replace(/\s+/g,' ').trim();
const split=(v:unknown):string[]=>{
  if(Array.isArray(v)) return v.flatMap(split);
  const s=clean(v); if(!s)return [];
  return s.split(/[;\n\r,]+/).map(clean).filter(Boolean);
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

function decodeText(data:Buffer):string{
  const candidates:string[]=[];
  if(data.length>=2&&data[0]===0xff&&data[1]===0xfe)candidates.push(data.toString('utf16le',2));
  if(data.length>=2&&data[0]===0xfe&&data[1]===0xff){
    const b=Buffer.alloc(data.length-2);
    for(let i=2;i+1<data.length;i+=2){b[i-2]=data[i+1];b[i-1]=data[i];}
    candidates.push(b.toString('utf16le'));
  }
  candidates.push(data.toString('utf8'));
  candidates.push(data.toString('latin1'));
  return candidates.map(clean).find(v=>v&&!/^[\d\s._-]+$/.test(v))||'';
}

function atomHeader(buffer:Buffer,offset:number,end:number){
  if(offset+8>end)return null;
  let size=buffer.readUInt32BE(offset);
  const type=buffer.toString('latin1',offset+4,offset+8);
  let header=8;
  if(size===1){if(offset+16>end)return null;size=Number(buffer.readBigUInt64BE(offset+8));header=16;}
  else if(size===0)size=end-offset;
  if(size<header||offset+size>end)return null;
  return {size,type,header,start:offset,end:offset+size,dataStart:offset+header};
}

function findIlst(buffer:Buffer):{start:number;end:number}|null{
  let pos=0;
  while((pos=buffer.indexOf(Buffer.from('ilst','latin1'),pos))!==-1){
    const h=atomHeader(buffer,pos-4,buffer.length);
    if(h&&h.type==='ilst')return {start:h.dataStart,end:h.end};
    pos+=4;
  }
  return null;
}

function collectAppleTags(buffer:Buffer){
  const out:{artist:string[];albumArtist:string[];composer:string[];album:string[]}={artist:[],albumArtist:[],composer:[],album:[]};
  const ilst=findIlst(buffer); if(!ilst)return out;
  const targets=new Set(['©ART','aART','©wrt','©com','©alb','----']);
  let p=ilst.start;
  while(p<ilst.end){
    const item=atomHeader(buffer,p,ilst.end); if(!item)break;
    if(targets.has(item.type)){
      let q=item.dataStart; let freeformName='';
      while(q<item.end){
        const sub=atomHeader(buffer,q,item.end); if(!sub)break;
        if(sub.type==='name'||sub.type==='mean'){
          const text=decodeText(buffer.subarray(sub.dataStart,sub.end));
          if(sub.type==='name')freeformName=text;
        }
        if(sub.type==='data'){
          const payloadStart=Math.min(sub.end,sub.dataStart+8);
          const value=decodeText(buffer.subarray(payloadStart,sub.end));
          if(value){
            if(item.type==='©ART')out.artist.push(value);
            else if(item.type==='aART')out.albumArtist.push(value);
            else if(item.type==='©wrt'||item.type==='©com')out.composer.push(value);
            else if(item.type==='©alb')out.album.push(value);
            else if(item.type==='----'){
              const key=freeformName.toUpperCase();
              if(key.includes('ARTISTS')||key.includes('ARTIST'))out.artist.push(value);
              if(key.includes('ALBUMARTIST')||key.includes('ALBUM ARTIST'))out.albumArtist.push(value);
              if(key.includes('COMPOSER'))out.composer.push(value);
            }
          }
        }
        q=sub.end;
      }
    }
    p=item.end;
  }
  return {artist:unique(out.artist),albumArtist:unique(out.albumArtist),composer:unique(out.composer),album:unique(out.album)};
}

async function parseOne(file:any,id:string):Promise<MetaResult>{
  const fileName=String(file?.name||'track.m4a');
  try{
    const bytes=await readWhole(file);
    const metadata=await parseBuffer(bytes,{path:fileName});
    const common:any=metadata.common||{};
    const nativeTags=collectAppleTags(bytes);

    const commonArtists=unique([...split(common.artists),...split(common.artist)]);
    const artists=unique([...commonArtists,...nativeTags.artist]);
    const albumArtists=unique([...split(common.albumartists),...split(common.albumartist),...nativeTags.albumArtist]);
    const composers=unique([...split(common.composer),...nativeTags.composer]);
    const artist=clean(common.artist)||artists[0]||albumArtists[0]||'';
    const albumArtist=clean(common.albumartist)||albumArtists[0]||'';

    return {
      id,
      title:clean(common.title),
      album:clean(common.album)||nativeTags.album[0]||'',
      artist:artist||'Unknown Artist',
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
  const ids=(request.nextUrl.searchParams.get('ids')||'').split(',').map(v=>v.trim()).filter(Boolean).slice(0,10);
  if(!ids.length)return Response.json([]);
  try{
    const root=MEGAFile.fromURL(MEGA_FOLDER_URL);
    await root.loadAttributes();
    const results:MetaResult[]=[];
    for(const id of ids){const file=await findById(root,id);if(file)results.push(await parseOne(file,id));}
    return Response.json(results,{headers:{'Cache-Control':'private, max-age=120'}});
  }catch(error){
    console.error('MEGA metadata batch error:',error);
    return new Response(`Unable to read song metadata: ${error instanceof Error?error.message:String(error)}`,{status:502});
  }
}
