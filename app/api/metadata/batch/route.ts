import { File as MEGAFile } from 'megajs';
import { parseBuffer } from 'music-metadata';
import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MEGA_FOLDER_URL = 'https://mega.nz/folder/J6ZzRYoa#kQ2tDf5tNP8NMrrGm_EXow';

type MetaResult = { id:string; title:string; album:string; artist:string; artists:string[]; albumArtist:string; albumArtists:string[]; composers:string[]; genre:string[]; year:number|null; track:{no?:number;of?:number}|null };

const clean=(v:unknown)=>String(v??'').replace(/\0/g,'').replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f]/g,'').replace(/\s+/g,' ').trim();
const split=(v:unknown):string[]=>Array.isArray(v)?v.flatMap(split):clean(v)?clean(v).split(/[;\n\r,]+/).map(clean).filter(Boolean):[];
const unique=(a:string[])=>Array.from(new Set(a.map(clean).filter(Boolean)));

async function findById(root:any,id:string):Promise<any|null>{
  const q=[root];
  while(q.length){
    const f=q.shift();
    for(const c of Array.isArray(f?.children)?f.children:[]){
      const cid=String(c?.nodeId||c?.downloadId||'');
      if(cid===id&&!c?.directory)return c;
      if(c?.directory||Array.isArray(c?.children))q.push(c);
    }
  }
  return null;
}

async function readAt(file:any,position:number,length:number):Promise<Buffer>{
  const size=Number(file?.size||0);
  if(!size||position<0||position>=size||length<=0)return Buffer.alloc(0);
  const end=Math.min(size-1,position+length-1);
  const s=file.download({start:position,end,maxConnections:1,forceHttps:true});
  const chunks:Buffer[]=[];
  await new Promise<void>((resolve,reject)=>{s.on('data',(c:Buffer)=>chunks.push(Buffer.from(c)));s.on('end',resolve);s.on('error',reject)});
  return Buffer.concat(chunks);
}

async function sampleFile(file:any):Promise<Buffer>{
  const size=Number(file?.size||0);
  const head=await readAt(file,0,Math.min(size,1024*1024));
  if(size<=1024*1024)return head;
  const tail=await readAt(file,Math.max(0,size-2*1024*1024),Math.min(size,2*1024*1024));
  return Buffer.concat([head,tail]);
}

function atomType(b:Buffer,o:number):string{
  const utf=b.subarray(o+4,o+8).toString('utf8');
  return utf.includes('�')?b.toString('latin1',o+4,o+8):utf;
}

function atomHeader(b:Buffer,o:number,end:number){
  if(o<0||o+8>end)return null;
  let size=b.readUInt32BE(o);
  const type=atomType(b,o);
  let h=8;
  if(size===1){
    if(o+16>end)return null;
    const n=b.readBigUInt64BE(o+8);
    if(n>BigInt(Number.MAX_SAFE_INTEGER))return null;
    size=Number(n);h=16;
  }else if(size===0)size=end-o;
  if(size<h||o+size>end)return null;
  return {type,start:o,end:o+size,dataStart:o+h};
}

function findIlst(b:Buffer){
  const marker=Buffer.from('ilst','ascii');
  let p=0;
  while((p=b.indexOf(marker,p))!==-1){
    const h=atomHeader(b,p-4,b.length);
    if(h?.type==='ilst')return {start:h.dataStart,end:h.end};
    p+=4;
  }
  return null;
}

function decodeText(b:Buffer):string{
  const values:string[]=[];
  if(b.length>=2&&b[0]===0xff&&b[1]===0xfe)values.push(b.toString('utf16le',2));
  values.push(b.toString('utf8'));
  values.push(b.toString('latin1'));
  return values.map(clean).find(v=>v&&!/^(data|utf-8|UTF-8)$/i.test(v))||'';
}

function readDataValues(b:Buffer,item:any):string[]{
  const out:string[]=[];
  let p=item.dataStart;
  while(p<item.end){
    const h=atomHeader(b,p,item.end);
    if(!h)break;
    if(h.type==='data'){
      const start=h.dataStart+8;
      if(start<h.end){
        const v=decodeText(b.subarray(start,h.end));
        if(v)out.push(v);
      }
    }
    p=h.end;
  }
  return out;
}

function appleTags(b:Buffer){
  const out={artist:[] as string[],albumArtist:[] as string[],composer:[] as string[],album:[] as string[],title:[] as string[],freeformArtist:[] as string[]};
  const ilst=findIlst(b);
  if(!ilst)return out;
  let p=ilst.start;
  while(p<ilst.end){
    const item=atomHeader(b,p,ilst.end);
    if(!item)break;
    if(item.type==='©ART')out.artist.push(...readDataValues(b,item));
    else if(item.type==='aART')out.albumArtist.push(...readDataValues(b,item));
    else if(item.type==='©wrt'||item.type==='©com')out.composer.push(...readDataValues(b,item));
    else if(item.type==='©alb')out.album.push(...readDataValues(b,item));
    else if(item.type==='©nam')out.title.push(...readDataValues(b,item));
    else if(item.type==='----'){
      let q=item.dataStart;
      let name='';
      while(q<item.end){
        const sub=atomHeader(b,q,item.end);
        if(!sub)break;
        if(sub.type==='name'||sub.type==='mean')name=decodeText(b.subarray(sub.dataStart,sub.end));
        if(sub.type==='data'){
          const start=sub.dataStart+8;
          const v=start<sub.end?decodeText(b.subarray(start,sub.end)):'';
          const k=clean(name).toUpperCase();
          if(v&&(k.includes('ARTIST')||k.includes('PERFORMER')))out.freeformArtist.push(v);
          if(v&&k.includes('ALBUMARTIST'))out.albumArtist.push(v);
          if(v&&k.includes('COMPOSER'))out.composer.push(v);
        }
        q=sub.end;
      }
    }
    p=item.end;
  }
  return {artist:unique(out.artist),albumArtist:unique(out.albumArtist),composer:unique(out.composer),album:unique(out.album),title:unique(out.title),freeformArtist:unique(out.freeformArtist)};
}

async function parseOne(file:any,id:string):Promise<MetaResult>{
  const name=String(file?.name||'track.m4a');
  try{
    const bytes=await sampleFile(file);
    let common:any={};
    try{common=(await parseBuffer(bytes,{path:name}))?.common||{}}catch{}
    const a=appleTags(bytes);
    const artists=unique([...a.freeformArtist,...a.artist,...split(common.artists),...split(common.artist)]);
    const albumArtists=unique([...a.albumArtist,...split(common.albumartists),...split(common.albumartist)]);
    const composers=unique([...a.composer,...split(common.composer)]);
    const artist=artists[0]||albumArtists[0]||'';
    const albumArtist=albumArtists[0]||'';
    return {id,title:clean(common.title)||a.title[0]||'',album:clean(common.album)||a.album[0]||'',artist:artist||'Unknown Artist',artists:artists.length?artists:(artist?[artist]:[]),albumArtist,albumArtists:albumArtists.length?albumArtists:(albumArtist?[albumArtist]:[]),composers,genre:unique(split(common.genre)),year:typeof common.year==='number'?common.year:null,track:common.track||null};
  }catch(e){
    console.warn('Metadata extraction failed for',name,e);
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
    for(const id of ids){const file=await findById(root,id);if(file)results.push(await parseOne(file,id));}
    return Response.json(results,{headers:{'Cache-Control':'private, max-age=120'}});
  }catch(e){
    console.error('MEGA metadata batch error',e);
    return new Response(`Unable to read song metadata: ${e instanceof Error?e.message:String(e)}`,{status:502});
  }
}
