import { File as MEGAFile } from 'megajs';
import { parseFromTokenizer } from 'music-metadata';
import type { ITokenizer, IGetToken } from 'strtok3';
import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MEGA_FOLDER_URL = 'https://mega.nz/folder/J6ZzRYoa#kQ2tDf5tNP8NMrrGm_EXow';

async function findById(folder: any, id: string): Promise<any | null> {
  const children = Array.isArray(folder?.children) ? folder.children : [];
  for (const child of children) {
    const childId = String(child?.nodeId || child?.downloadId || '');
    if (childId === id) return child;
    if (child?.directory || Array.isArray(child?.children)) {
      const found = await findById(child, id);
      if (found) return found;
    }
  }
  return null;
}

async function readAt(file: any, position: number, length: number): Promise<Buffer> {
  if (length <= 0 || position < 0) return Buffer.alloc(0);
  const size = Number(file?.size || 0);
  if (!size || position >= size) return Buffer.alloc(0);
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

function makeRemoteTokenizer(file: any, fileName: string): ITokenizer {
  const size = Number(file?.size || 0);
  const tokenizer: any = {
    fileInfo: { size, path: fileName, mimeType: 'application/octet-stream' },
    position: 0,
    async readBuffer(target: Uint8Array, options: any = {}) {
      const position = Number.isFinite(options.position) ? Number(options.position) : tokenizer.position;
      const length = Number.isFinite(options.length) ? Number(options.length) : target.byteLength;
      const data = await readAt(file, position, length);
      target.set(data.subarray(0, target.byteLength));
      if (options.position == null) tokenizer.position = position + data.length;
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
      if (position >= tokenizer.position) tokenizer.position = position + token.len;
      return token.get(data, 0);
    },
    async peekToken(token: IGetToken<any>, position = tokenizer.position) {
      const data = await readAt(file, position, token.len);
      if (data.length < token.len) throw new Error('Unexpected end of file');
      return token.get(data, 0);
    },
    async readNumber(token: IGetToken<number>) { return tokenizer.readToken(token); },
    async ignore(length: number) {
      if (length < 0) throw new Error('Negative ignore is not supported');
      tokenizer.position = Math.min(size, tokenizer.position + length);
      return length;
    },
    async close() {},
  };
  return tokenizer as ITokenizer;
}

function normalizeList(value: unknown): string[] {
  if (!Array.isArray(value)) return value ? [String(value).trim()].filter(Boolean) : [];
  return value.map(String).map(v => v.trim()).filter(Boolean);
}

function unique(values: string[]): string[] {
  return [...new Map(values.map(value => [value.toLocaleLowerCase(), value])).values()];
}

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id');
  if (!id) return new Response('Missing metadata id', { status: 400 });

  try {
    const root = MEGAFile.fromURL(MEGA_FOLDER_URL);
    await root.loadAttributes();
    const file = await findById(root, id);
    if (!file || file.directory) return new Response('Song not found', { status: 404 });

    const fileName = String(file.name || 'track');
    const extension = fileName.toLowerCase().split('.').pop() || '';
    const tokenizer = makeRemoteTokenizer(file, fileName);
    const metadata = await parseFromTokenizer(tokenizer, {
      skipCovers: true,
      duration: false,
      skipPostHeaders: true,
    });
    const common: any = metadata?.common || {};

    // This matches the Windows-style music fields:
    // Contributing artists = System.Music.Artist / track artist(s)
    // Album artist = System.Music.AlbumArtist / album artist
    const contributingArtists = unique([
      ...normalizeList(common.artists),
      ...normalizeList(common.artist),
    ]);
    const albumArtists = unique([
      ...normalizeList(common.albumartists),
      ...normalizeList(common.albumartist),
    ]);

    const artist = String(common.artist || contributingArtists[0] || '').trim();
    const albumArtist = String(common.albumartist || albumArtists[0] || '').trim();

    return Response.json({
      id,
      format: extension,
      title: String(common.title || '').trim(),
      album: String(common.album || '').trim(),
      artist,
      contributingArtists,
      artists: contributingArtists,
      albumArtist,
      albumArtists,
      genre: normalizeList(common.genre),
      year: common.year ?? null,
      track: common.track ?? null,
      disk: common.disk ?? null,
      composer: normalizeList(common.composer),
      conductor: normalizeList(common.conductor),
      producer: normalizeList(common.producer),
      copyright: String(common.copyright || '').trim(),
      rawExtension: extension,
    }, { headers: { 'Cache-Control': 'private, max-age=300' } });
  } catch (error) {
    console.error('MEGA metadata error:', error);
    const message = error instanceof Error ? error.message : String(error);
    return new Response(`Unable to read song metadata: ${message}`, { status: 502 });
  }
}
