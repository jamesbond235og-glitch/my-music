import { File as MEGAFile } from 'megajs';
import { parseFromTokenizer } from 'music-metadata';
import type { ITokenizer, IGetToken } from 'strtok3';
import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MEGA_FOLDER_URL = 'https://mega.nz/folder/J6ZzRYoa#kQ2tDf5tNP8NMrrGm_EXow';

type MetaResult = {
  id: string;
  title: string;
  album: string;
  artist: string;
  artists: string[];
  albumArtist: string;
  albumArtists: string[];
  composers: string[];
  genre: string[];
  year: number | null;
  track: { no?: number; of?: number } | null;
};

async function readAt(file: any, position: number, length: number): Promise<Buffer> {
  const size = Number(file?.size || 0);
  if (!size || length <= 0 || position < 0 || position >= size) return Buffer.alloc(0);
  const end = Math.min(size - 1, position + length - 1);
  const stream = file.download({ start: position, end, maxConnections: 1, forceHttps: true });
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    stream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  return Buffer.concat(chunks);
}

function tokenizerFor(file: any, fileName: string): ITokenizer {
  const size = Number(file?.size || 0);
  const tokenizer: any = {
    fileInfo: { size, path: fileName, mimeType: 'application/octet-stream' },
    position: 0,
    async readBuffer(target: Uint8Array, options: any = {}) {
      const position = Number.isFinite(options.position) ? Number(options.position) : tokenizer.position;
      const length = Number.isFinite(options.length) ? Number(options.length) : target.byteLength;
      const data = await readAt(file, position, length);
      target.set(data.subarray(0, target.byteLength));
      if (options.position === undefined) tokenizer.position = position + data.length;
      return data.length;
    },
    async peekBuffer(target: Uint8Array, options: any = {}) {
      const position = Number.isFinite(options.position) ? Number(options.position) : tokenizer.position;
      const length = Number.isFinite(options.length) ? Number(options.length) : target.byteLength;
      const data = await readAt(file, position, length);
      target.set(data.subarray(0, target.byteLength));
      return data.length;
    },
    async readToken(token: IGetToken<any>, position = tokenizer.position) {
      const data = await readAt(file, position, token.len);
      if (data.length < token.len) throw new Error('Unexpected end of file');
      tokenizer.position = position + token.len;
      return token.get(data, 0);
    },
    async peekToken(token: IGetToken<any>, position = tokenizer.position) {
      const data = await readAt(file, position, token.len);
      if (data.length < token.len) throw new Error('Unexpected end of file');
      return token.get(data, 0);
    },
    async readNumber(token: IGetToken<number>) { return tokenizer.readToken(token); },
    async ignore(length: number) { tokenizer.position = Math.min(size, tokenizer.position + length); return length; },
    async close() {},
  };
  return tokenizer as ITokenizer;
}

function list(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map(v => v.trim()).filter(Boolean);
  return value ? [String(value).trim()] : [];
}

function walk(folder: any, out: Map<string, any>) {
  const children = Array.isArray(folder?.children) ? folder.children : [];
  for (const child of children) {
    const id = String(child?.nodeId || child?.downloadId || '');
    if (id) out.set(id, child);
    if (child?.directory || Array.isArray(child?.children)) walk(child, out);
  }
}

async function one(file: any, id: string): Promise<MetaResult> {
  const fileName = String(file?.name || '');
  const extension = fileName.toLowerCase().split('.').pop() || '';
  try {
    const metadata = await parseFromTokenizer(tokenizerFor(file, fileName), {
      skipCovers: true,
      duration: false,
      skipPostHeaders: true,
    });
    const common: any = metadata?.common || {};
    const artists = list(common.artists || common.artist);
    const albumArtists = list(common.albumartists || common.albumartist);
    const composers = list(common.composer);
    return {
      id,
      title: String(common.title || '').trim(),
      album: String(common.album || '').trim(),
      artist: String(common.artist || artists[0] || '').trim(),
      artists,
      albumArtist: String(common.albumartist || albumArtists[0] || '').trim(),
      albumArtists,
      composers,
      genre: list(common.genre),
      year: typeof common.year === 'number' ? common.year : null,
      track: common.track || null,
    };
  } catch (error) {
    console.warn(`Metadata extraction failed for ${fileName}:`, error);
    return { id, title: '', album: '', artist: '', artists: [], albumArtist: '', albumArtists: [], composers: [], genre: [], year: null, track: null };
  }
}

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get('ids') || '';
  const ids = raw.split(',').map(v => v.trim()).filter(Boolean).slice(0, 100);
  if (!ids.length) return Response.json([]);

  try {
    const root = MEGAFile.fromURL(MEGA_FOLDER_URL);
    await root.loadAttributes();
    const files = new Map<string, any>();
    walk(root, files);
    const selected = ids.filter(id => files.has(id));
    const results: MetaResult[] = [];
    const concurrency = 3;
    for (let i = 0; i < selected.length; i += concurrency) {
      const chunk = selected.slice(i, i + concurrency);
      results.push(...await Promise.all(chunk.map(id => one(files.get(id), id))));
    }
    return Response.json(results, { headers: { 'Cache-Control': 'private, max-age=120' } });
  } catch (error) {
    console.error('MEGA batch metadata error:', error);
    const message = error instanceof Error ? error.message : String(error);
    return new Response(`Unable to read song metadata: ${message}`, { status: 502 });
  }
}
