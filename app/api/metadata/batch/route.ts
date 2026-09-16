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
  return text.replace(/\0/g, '').replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();
}

function utf8OrUtf16(data: Buffer): string {
  if (data.length >= 2 && data[0] === 0xff && data[1] === 0xfe) return cleanText(data.toString('utf16le', 2));
  if (data.length >= 2 && data[0] === 0xfe && data[1] === 0xff) {
    const swapped = Buffer.alloc(data.length - 2);
    for (let i = 2; i + 1 < data.length; i += 2) { swapped[i - 2] = data[i + 1]; swapped[i - 1] = data[i]; }
    return cleanText(swapped.toString('utf16le'));
  }
  return cleanText(data.toString('utf8'));
}

function findItemValue(buffer: Buffer, itemType: string): string {
  const marker = Buffer.from(itemType, 'latin1');
  let pos = 0;
  while ((pos = buffer.indexOf(marker, pos)) !== -1) {
    // Apple metadata item is normally followed by a data atom: size + "data" + flags/type + payload.
    const windowEnd = Math.min(buffer.length, pos + 1024);
    const dataPos = buffer.indexOf(Buffer.from('data', 'ascii'), pos + 4);
    if (dataPos !== -1 && dataPos < windowEnd && dataPos >= 4) {
      const dataSize = buffer.readUInt32BE(dataPos - 4);
      if (dataSize >= 16 && dataPos + 8 < buffer.length) {
        const payloadStart = dataPos + 8;
        const payloadEnd = Math.min(buffer.length, dataPos + dataSize);
        const text = utf8OrUtf16(buffer.subarray(payloadStart, payloadEnd));
        if (text) return text;
      }
    }
    pos += marker.length;
  }
  return '';
}

function findFreeformValue(buffer: Buffer, name: string): string {
  const nameMarker = Buffer.from(name, 'utf8');
  let pos = 0;
  while ((pos = buffer.indexOf(nameMarker, pos)) !== -1) {
    const dataPos = buffer.indexOf(Buffer.from('data', 'ascii'), pos + nameMarker.length);
    if (dataPos !== -1 && dataPos < pos + 2048 && dataPos + 8 < buffer.length) {
      const dataSize = buffer.readUInt32BE(dataPos - 4);
      if (dataSize >= 16) {
        const text = utf8OrUtf16(buffer.subarray(dataPos + 8, Math.min(buffer.length, dataPos + dataSize)));
        if (text) return text;
      }
    }
    pos += nameMarker.length;
  }
  return '';
}

async function readAppleAtoms(file: any): Promise<{ albumArtist: string; artists: string[]; composers: string[] }> {
  const size = Number(file?.size || 0);
  if (!size) return { albumArtist: '', artists: [], composers: [] };

  const headLength = Math.min(size, 1024 * 1024);
  const head = await readAt(file, 0, headLength);
  const tailLength = size > headLength ? Math.min(size, 512 * 1024) : 0;
  const tail = tailLength ? await readAt(file, size - tailLength, tailLength) : Buffer.alloc(0);
  const buffer = tail.length ? Buffer.concat([head, tail]) : head;

  const artist = findItemValue(buffer, '©ART');
  const albumArtist = findItemValue(buffer, 'aART');
  const composer = findItemValue(buffer, '©wrt') || findItemValue(buffer, '©com');
  const contributingRaw = findFreeformValue(buffer, 'ARTISTS');
  const artists = (contributingRaw || artist)
    .split(/[;,]\s*/)
    .map(cleanText)
    .filter(Boolean);

  return {
    albumArtist,
    artists: artists.length ? artists : (artist ? [artist] : []),
    composers: composer ? composer.split(/[;,]\s*/).map(cleanText).filter(Boolean) : [],
  };
}

function list(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map(v => v.trim()).filter(Boolean);
  return value ? [String(value).trim()] : [];
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
    const apple = extension === 'm4a' || extension === 'm4b' || extension === 'mp4'
      ? await readAppleAtoms(file)
      : { albumArtist: '', artists: [], composers: [] };

    const artist = String(basic?.artist || '').trim();
    const artists = apple.artists.length ? apple.artists : (artist ? [artist] : []);
    const albumArtist = apple.albumArtist.trim();
    const composers = apple.composers;

    return {
      id,
      title: String(basic?.title || '').trim(),
      album: String(basic?.album || '').trim(),
      artist: artist || artists[0] || '',
      artists,
      albumArtist,
      albumArtists: albumArtist ? [albumArtist] : [],
      composers,
      genre: basic?.genre ? list(basic.genre) : [],
      year: typeof basic?.year === 'number' ? basic.year : null,
      track: null,
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
