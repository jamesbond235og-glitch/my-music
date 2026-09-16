import { File as MEGAFile } from 'megajs';
import { extractMetadata } from 'metadata-connect';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MEGA_FOLDER_URL = 'https://mega.nz/folder/J6ZzRYoa#kQ2tDf5tNP8NMrrGm_EXow';
const AUDIO_EXTENSIONS = new Set(['mp3', 'm4a', 'm4b', 'aac', 'wav', 'ogg', 'flac']);

type LibrarySong = {
  id: number;
  title: string;
  artist: string;
  album: string;
  quality: string;
  fileName: string;
  path: string;
  fileId: string;
  format: string;
  duration: string;
  stream: string;
};

type Album = { name: string; path: string; songs: LibrarySong[] };
type Artist = { name: string; songs: LibrarySong[] };

function getFormat(fileName: string): string {
  const extension = fileName.toLowerCase().split('.').pop() || '';
  return extension === 'm4b' ? 'm4a' : extension;
}

function getTitle(fileName: string): string {
  return fileName.replace(/\.(mp3|m4a|m4b|aac|wav|ogg|flac)$/i, '');
}

function getQuality(fileName: string): string {
  const format = getFormat(fileName).toUpperCase();
  return format === 'M4A' ? 'M4A • Original file' : `${format} • Original file`;
}

async function readRange(file: any, start: number, length: number): Promise<Buffer> {
  if (length <= 0) return Buffer.alloc(0);
  const end = Math.min(Number(file.size || 0) - 1, start + length - 1);
  if (start < 0 || start > end) return Buffer.alloc(0);

  const stream = file.download({ start, end, maxConnections: 1, forceHttps: true });
  const chunks: Buffer[] = [];

  await new Promise<void>((resolve, reject) => {
    stream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    stream.on('end', () => resolve());
    stream.on('error', reject);
  });

  return Buffer.concat(chunks);
}

async function getMetadata(file: any, fileName: string) {
  const extension = getFormat(fileName);
  const size = Number(file?.size || 0);
  if (!size || !['mp3', 'm4a', 'aac', 'flac', 'aiff'].includes(extension)) return null;

  try {
    return await extractMetadata({
      size,
      extension,
      read: (offset: number, length: number) => readRange(file, offset, length),
    });
  } catch (error) {
    console.warn(`Metadata extraction failed for ${fileName}:`, error);
    return null;
  }
}

async function walkFolder(folder: any, pathParts: string[], songs: Omit<LibrarySong, 'id'>[]) {
  const children = Array.isArray(folder?.children) ? folder.children : [];

  for (const child of children) {
    const name = String(child?.name || '');
    if (!name) continue;

    const nextPath = [...pathParts, name];

    if (child?.directory || Array.isArray(child?.children)) {
      walkFolder(child, nextPath, songs);
      continue;
    }

    const extension = name.toLowerCase().split('.').pop() || '';
    if (!AUDIO_EXTENSIONS.has(extension)) continue;

    const fileId = String(child?.nodeId || child?.downloadId || '');
    if (!fileId) continue;

    const metadata = await getMetadata(child, name);
    const title = String(metadata?.title || getTitle(name));
    const artist = String(metadata?.artist || metadata?.artists?.[0] || 'Unknown Artist');
    const album = String(metadata?.album || pathParts[0] || 'Singles');

    songs.push({
      title,
      artist,
      album,
      quality: getQuality(name),
      fileName: name,
      path: nextPath.join('/'),
      fileId,
      format: getFormat(name),
      duration: '--:--',
      stream: `/api/track?id=${encodeURIComponent(fileId)}`,
    });
  }
}

export async function GET() {
  try {
    const root = MEGAFile.fromURL(MEGA_FOLDER_URL);
    await root.loadAttributes();

    const found: Omit<LibrarySong, 'id'>[] = [];
    await walkFolder(root, [], found);

    const sorted = found
      .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' }))
      .map((song, index) => ({ ...song, id: index + 1 }));

    const albums = new Map<string, Album>();
    const singles: LibrarySong[] = [];
    const artists = new Map<string, Artist>();

    for (const song of sorted) {
      const firstFolder = song.path.includes('/') ? song.path.split('/')[0] : null;
      if (!firstFolder) {
        singles.push(song);
      } else {
        const album = albums.get(firstFolder);
        if (album) album.songs.push(song);
        else albums.set(firstFolder, { name: firstFolder, path: firstFolder, songs: [song] });
      }

      const artistKey = song.artist.trim() || 'Unknown Artist';
      const artist = artists.get(artistKey);
      if (artist) artist.songs.push(song);
      else artists.set(artistKey, { name: artistKey, songs: [song] });
    }

    return Response.json({
      folder: root?.name || 'My Music',
      albums: Array.from(albums.values()),
      artists: Array.from(artists.values()).sort((a, b) => a.name.localeCompare(b.name)),
      singles,
      songs: sorted,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('MEGA library scan error:', error);
    const message = error instanceof Error ? error.message : String(error);
    return new Response(`Unable to scan the MEGA music folder: ${message}`, { status: 502 });
  }
}
