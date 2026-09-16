import { File as MEGAFile } from 'megajs';

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

type Album = {
  name: string;
  path: string;
  songs: LibrarySong[];
};

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

async function walkFolder(folder: any, pathParts: string[], songs: Omit<LibrarySong, 'id'>[]) {
  const children = Array.isArray(folder.children) ? folder.children : [];

  for (const child of children) {
    const name = String(child.name || '');
    const nextPath = [...pathParts, name];

    if (child.directory) {
      // MEGA shared-folder child directories load their own children when
      // loadAttributes() is called on that directory.
      await child.loadAttributes();
      await walkFolder(child, nextPath, songs);
      continue;
    }

    const extension = name.toLowerCase().split('.').pop() || '';
    if (!AUDIO_EXTENSIONS.has(extension)) continue;

    await child.loadAttributes();
    const fileId = String(child.nodeId || '');
    if (!fileId) continue;

    songs.push({
      title: getTitle(name),
      artist: 'Unknown Artist',
      album: pathParts[0] || 'Singles',
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

    for (const song of sorted) {
      const firstFolder = song.path.includes('/') ? song.path.split('/')[0] : null;
      if (!firstFolder) {
        singles.push(song);
        continue;
      }

      const existing = albums.get(firstFolder);
      if (existing) existing.songs.push(song);
      else albums.set(firstFolder, { name: firstFolder, path: firstFolder, songs: [song] });
    }

    return Response.json({
      folder: root.name || 'My Music',
      albums: Array.from(albums.values()),
      singles,
      songs: sorted,
    }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('MEGA library scan error:', error);
    const message = error instanceof Error ? error.message : String(error);
    return new Response(`Unable to scan the MEGA music folder: ${message}`, { status: 502 });
  }
}
