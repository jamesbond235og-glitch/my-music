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

export async function GET() {
  try {
    const root = MEGAFile.fromURL(MEGA_FOLDER_URL);
    await root.loadAttributes();

    const albums = new Map<string, Album>();
    const singles: LibrarySong[] = [];
    const allSongs: Omit<LibrarySong, 'id'>[] = [];

    const walk = async (folder: any, pathParts: string[] = []) => {
      const children = Array.isArray(folder.children) ? folder.children : [];

      for (const child of children) {
        const name = String(child.name || '');
        const nextPath = [...pathParts, name];

        if (child.directory || Array.isArray(child.children)) {
          await walk(child, nextPath);
          continue;
        }

        const extension = name.toLowerCase().split('.').pop() || '';
        if (!AUDIO_EXTENSIONS.has(extension)) continue;

        const format = getFormat(name);
        const song: Omit<LibrarySong, 'id'> = {
          title: getTitle(name),
          artist: 'Unknown Artist',
          album: pathParts[0] || 'Singles',
          quality: getQuality(name),
          fileName: name,
          path: nextPath.join('/'),
          format,
          duration: '--:--',
          stream: `/api/track?path=${encodeURIComponent(nextPath.join('/'))}`,
        };

        allSongs.push(song);
      }
    };

    await walk(root);

    const sorted = allSongs
      .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' }))
      .map((song, index) => ({ ...song, id: index + 1 }));

    for (const song of sorted) {
      const firstFolder = song.path.includes('/') ? song.path.split('/')[0] : null;
      if (!firstFolder) {
        singles.push(song);
        continue;
      }

      const existing = albums.get(firstFolder);
      if (existing) {
        existing.songs.push(song);
      } else {
        albums.set(firstFolder, {
          name: firstFolder,
          path: firstFolder,
          songs: [song],
        });
      }
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
