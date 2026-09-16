import { File as MEGAFile } from 'megajs';
import { extractMetadata } from 'metadata-connect';
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

function cleanText(text: string): string {
  return text
    .replace(/\0/g, '')
    .replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/^(data|utf-8|UTF-8)$/g, '')
    .trim();
}

function decodeValue(data: Buffer): string {
  const candidates: string[] = [];
  if (data.length >= 2 && data[0] === 0xff && data[1] === 0xfe) candidates.push(data.toString('utf16le', 2));
  if (data.length >= 2 && data[0] === 0xfe && data[1] === 0xff) {
    const swapped = Buffer.alloc(data.length - 2);
    for (let i = 2; i + 1 < data.length; i += 2) {
      swapped[i - 2] = data[i + 1];
      swapped[i - 1] = data[i];
    }
    candidates.push(swapped.toString('utf16le'));
  }
  candidates.push(data.toString('utf8'));
  candidates.push(data.toString('latin1'));
  return candidates.map(cleanText).find(Boolean) || '';
}

function findDataValue(buffer: Buffer, markerText: string): string {
  const marker = Buffer.from(markerText, 'latin1');
  let pos = 0;
  while ((pos = buffer.indexOf(marker, pos)) !== -1) {
    const limit = Math.min(buffer.length, pos + 8192);
    let dataPos = buffer.indexOf(Buffer.from('data', 'ascii'), pos + marker.length);
    while (dataPos !== -1 && dataPos < limit) {
      if (dataPos >= 4) {
        const dataSize = buffer.readUInt32BE(dataPos - 4);
        if (dataSize >= 16 && dataPos + 8 < buffer.length) {
          // data atom: header(8) + type/locale payload header(8) + value.
          const starts = [dataPos + 16, dataPos + 12, dataPos + 8];
          for (const start of starts) {
            const end = Math.min(buffer.length, dataPos + dataSize);
            if (start < end) {
              const text = decodeValue(buffer.subarray(start, end));
              if (text) return text;
            }
          }
        }
      }
      dataPos = buffer.indexOf(Buffer.from('data', 'ascii'), dataPos + 4);
    }
    pos += marker.length;
  }
  return '';
}

function findFreeformValue(buffer: Buffer, name: string): string {
  const nameMarker = Buffer.from(name, 'utf8');
  let pos = 0;
  while ((pos = buffer.indexOf(nameMarker, pos)) !== -1) {
    const searchEnd = Math.min(buffer.length, pos + 8192);
    let dataPos = buffer.indexOf(Buffer.from('data', 'ascii'), pos + nameMarker.length);
    while (dataPos !== -1 && dataPos < searchEnd) {
      if (dataPos >= 4) {
        const dataSize = buffer.readUInt32BE(dataPos - 4);
        if (dataSize >= 16) {
          const starts = [dataPos + 16, dataPos + 12, dataPos + 8];
          const end = Math.min(buffer.length, dataPos + dataSize);
          for (const start of starts) {
            if (start < end) {
              const text = decodeValue(buffer.subarray(start, end));
              if (text) return text;
            }
          }
        }
      }
      dataPos = buffer.indexOf(Buffer.from('data', 'ascii'), dataPos + 4);
    }
    pos += nameMarker.length;
  }
  return '';
}

function splitPeople(value: string): string[] {
  return value
    .split(/[;\n\r\u000b]+/)
    .map(cleanText)
    .filter(Boolean);
}

async function readAppleAtoms(file: any): Promise<{ albumArtist: string; artists: string[]; composers: string[] }> {
  const size = Number(file?.size || 0);
  if (!size) return { albumArtist: '', artists: [], composers: [] };

  // M4A metadata is commonly stored in/near the moov atom, frequently at the end.
  // Read enough from both ends to cover large cover-art-free metadata sections.
  const headLength = Math.min(size, 2 * 1024 * 1024);
  const head = await readAt(file, 0, headLength);
  const tailLength = size > headLength ? Math.min(size, 4 * 1024 * 1024) : 0;
  const tail = tailLength ? await readAt(file, Math.max(0, size - tailLength), tailLength) : Buffer.alloc(0);
  const buffer = tail.length ? Buffer.concat([head, tail]) : head;

  const artist = findDataValue(buffer, '©ART');
  const albumArtist = findDataValue(buffer, 'aART');
  const composer = findDataValue(buffer, '©wrt') || findDataValue(buffer, '©com');

  // Some tagging tools store Windows/iTunes "Contributing artists" in a freeform ARTISTS field.
  const contributingRaw = findFreeformValue(buffer, 'ARTISTS');
  const artists = splitPeople(contributingRaw || artist);

  return {
    albumArtist: cleanText(albumArtist),
    artists: artists.length ? artists : (artist ? [cleanText(artist)] : []),
    composers: splitPeople(composer),
  };
}

function list(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map(v => v.trim()).filter(Boolean);
  return value ? [String(value).trim()] : [];
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.map(cleanText).filter(Boolean)));
}

async function one(file: any, id: string): Promise<MetaResult> {
  const fileName = String(file?.name || '');
  const extension = fileName.toLowerCase().split('.').pop() || '';
  const size = Number(file?.size || 0);
  try {
    const basic = await extractMetadata({
      size,
      extension,
      read: (offset: number, length: number) => readAt(file, offset, length),
    });

    const apple = ['m4a', 'm4b', 'mp4'].includes(extension)
      ? await readAppleAtoms(file)
      : { albumArtist: '', artists: [], composers: [] };

    const basicArtist = String(basic?.artist || '').trim();
    const basicArtists = list((basic as any)?.artists || basicArtist);
    const artists = dedupe([
      ...apple.artists,
      ...basicArtists,
    ]);
    const albumArtist = apple.albumArtist || String((basic as any)?.albumartist || '').trim();
    const displayArtist = artists[0] || albumArtist || 'Unknown Artist';

    return {
      id,
      title: String(basic?.title || '').trim(),
      album: String(basic?.album || '').trim(),
      artist: displayArtist,
      artists,
      albumArtist,
      albumArtists: albumArtist ? [albumArtist] : [],
      composers: dedupe([
        ...apple.composers,
        ...list((basic as any)?.composer),
      ]),
      genre: basic?.genre ? list(basic.genre) : [],
      year: typeof basic?.year === 'number' ? basic.year : null,
      track: (basic as any)?.track || null,
    };
  } catch (error) {
    console.warn(`Metadata extraction failed for ${fileName}:`, error);
    return { id, title: '', album: '', artist: '', artists: [], albumArtist: '', albumArtists: [], composers: [], genre: [], year: null, track: null };
  }
}

async function findFiles(root: any): Promise<Map<string, any>> {
  const out = new Map<string, any>();
  const queue = [root];
  while (queue.length) {
    const folder = queue.shift();
    const children = Array.isArray(folder?.children) ? folder.children : [];
    for (const child of children) {
      const id = String(child?.nodeId || child?.downloadId || '');
      if (id) out.set(id, child);
      if (child?.directory || Array.isArray(child?.children)) queue.push(child);
    }
  }
  return out;
}

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get('ids') || '';
  const ids = raw.split(',').map(v => v.trim()).filter(Boolean).slice(0, 100);
  if (!ids.length) return Response.json([]);

  try {
    const root = MEGAFile.fromURL(MEGA_FOLDER_URL);
    await root.loadAttributes();
    const files = await findFiles(root);
    const selected = ids.filter(id => files.has(id));
    const results: MetaResult[] = [];
    const concurrency = 2;
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
