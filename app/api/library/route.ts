import { File as MEGAFile } from 'megajs';
import { parseBuffer } from 'music-metadata';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MEGA_FOLDER_URL = 'https://mega.nz/folder/J6ZzRYoa#kQ2tDf5tNP8NMrrGm_EXow';
const AUDIO_EXTENSIONS = new Set(['mp3', 'm4a', 'm4b', 'aac', 'wav', 'ogg', 'flac']);
const COVER_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);

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
  cover?: string;
  contributingArtists?: string[];
  albumArtist?: string;
  composers?: string[];
};

type Album = { name: string; path: string; songs: LibrarySong[]; cover?: string };

type TrackSeed = Omit<LibrarySong, 'id'> & { file: any };

const clean = (value: unknown) => String(value ?? '').replace(/\0/g, '').replace(/\s+/g, ' ').trim();
const asList = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.flatMap(asList);
  const text = clean(value);
  return text ? text.split(/[;\n\r,]+/).map(clean).filter(Boolean) : [];
};
const unique = (values: string[]) => Array.from(new Set(values.map(clean).filter(Boolean)));

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

function getCoverFile(children: any[]): any | null {
  for (const child of children) {
    if (child?.directory) continue;
    const name = String(child?.name || '');
    const match = name.match(/^cover\.(jpg|jpeg|png|webp|gif)$/i);
    if (match && COVER_EXTENSIONS.has(match[1].toLowerCase())) return child;
  }
  return null;
}

async function readWhole(file: any): Promise<Buffer> {
  const size = Number(file?.size || 0);
  if (!size) throw new Error('MEGA file has no readable size');
  const stream = file.download({ start: 0, end: size - 1, maxConnections: 1, forceHttps: true });
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    stream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  return Buffer.concat(chunks);
}

async function readMetadata(seed: TrackSeed): Promise<TrackSeed> {
  try {
    const bytes = await readWhole(seed.file);
    const metadata = await parseBuffer(bytes, { path: seed.fileName });
    const common: any = metadata.common || {};
    const artists = unique([...asList(common.artists), ...asList(common.artist)]);
    const albumArtists = unique([...asList(common.albumartists), ...asList(common.albumartist)]);
    const composers = unique(asList(common.composer));
    const artist = artists[0] || albumArtists[0] || '';
    const albumArtist = albumArtists[0] || '';

    return {
      ...seed,
      title: clean(common.title) || seed.title,
      album: clean(common.album) || seed.album,
      artist: artist || seed.artist,
      contributingArtists: artists,
      albumArtist,
      composers,
    };
  } catch (error) {
    console.warn(`Embedded metadata read failed for ${seed.fileName}:`, error);
    return seed;
  }
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const output: R[] = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      output[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return output;
}

function collectSeeds(folder: any, pathParts: string[], out: TrackSeed[]) {
  const children = Array.isArray(folder?.children) ? folder.children : [];
  const coverFile = getCoverFile(children);
  const coverId = String(coverFile?.nodeId || coverFile?.downloadId || '');
  const albumCover = coverId ? `/api/cover?id=${encodeURIComponent(coverId)}` : undefined;

  for (const child of children) {
    const name = String(child?.name || '');
    if (!name) continue;
    const nextPath = [...pathParts, name];

    if (child?.directory || Array.isArray(child?.children)) {
      collectSeeds(child, nextPath, out);
      continue;
    }

    const extension = name.toLowerCase().split('.').pop() || '';
    if (!AUDIO_EXTENSIONS.has(extension)) continue;

    const fileId = String(child?.nodeId || child?.downloadId || '');
    if (!fileId) continue;

    out.push({
      file: child,
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
      cover: albumCover,
    });
  }
}

export async function GET() {
  try {
    const root = MEGAFile.fromURL(MEGA_FOLDER_URL);
    await root.loadAttributes();

    const seeds: TrackSeed[] = [];
    collectSeeds(root, [], seeds);

    // Resolve the actual embedded metadata on the server before sending the library.
    // This removes the old client-side race where album rows could remain on "Unknown Artist".
    const enriched = await mapWithConcurrency(seeds, 3, readMetadata);
    const sorted = enriched
      .map(({ file: _file, ...song }) => song)
      .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' }))
      .map((song, index) => ({ ...song, id: index + 1 }));

    const albums = new Map<string, Album>();
    const singles: LibrarySong[] = [];

    for (const song of sorted) {
      const firstFolder = song.path.includes('/') ? song.path.split('/')[0] : null;
      if (!firstFolder) {
        singles.push(song);
      } else {
        const album = albums.get(firstFolder);
        if (album) album.songs.push(song);
        else albums.set(firstFolder, {
          name: firstFolder,
          path: firstFolder,
          songs: [song],
          cover: song.cover,
        });
      }
    }

    const allSongs = [...sorted];
    const artistMap = new Map<string, LibrarySong[]>();
    const composerMap = new Map<string, LibrarySong[]>();

    for (const song of allSongs) {
      for (const name of unique(song.contributingArtists || (song.artist && song.artist !== 'Unknown Artist' ? [song.artist] : []))) {
        const list = artistMap.get(name) || [];
        list.push(song);
        artistMap.set(name, list);
      }
      for (const name of unique(song.composers || [])) {
        const list = composerMap.get(name) || [];
        list.push(song);
        composerMap.set(name, list);
      }
    }

    const artists = Array.from(artistMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, songs]) => ({ name, songs }));
    const composers = Array.from(composerMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, songs]) => ({ name, songs }));

    return Response.json({
      folder: root?.name || 'My Music',
      albums: Array.from(albums.values()),
      artists,
      composers,
      singles,
      songs: sorted,
    }, { headers: { 'Cache-Control': 'private, max-age=120' } });
  } catch (error) {
    console.error('MEGA library scan error:', error);
    const message = error instanceof Error ? error.message : String(error);
    return new Response(`Unable to scan the MEGA music folder: ${message}`, { status: 502 });
  }
}
