import { parseBuffer } from 'music-metadata';
import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

const clean = (value: unknown) => String(value ?? '').replace(/\0/g, '').replace(/\s+/g, ' ').trim();
const list = (value: unknown): string[] => Array.isArray(value) ? value.flatMap(list) : (clean(value) ? clean(value).split(/[;\n\r]+/).map(clean).filter(Boolean) : []);
const unique = (values: string[]) => Array.from(new Set(values.map(clean).filter(Boolean)));

async function parseTrack(request: NextRequest, id: string): Promise<MetaResult> {
  try {
    const url = new URL('/api/track', request.url);
    url.searchParams.set('id', id);
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(await response.text());

    const bytes = Buffer.from(await response.arrayBuffer());
    const metadata = await parseBuffer(bytes, { path: `track-${id}.m4a` });
    const common: any = metadata.common || {};

    const artists = unique([...list(common.artists), ...list(common.artist)]);
    const albumArtists = unique([...list(common.albumartists), ...list(common.albumartist)]);
    const composers = unique(list(common.composer));
    const artist = clean(common.artist) || artists[0] || albumArtists[0] || '';
    const albumArtist = clean(common.albumartist) || albumArtists[0] || '';

    return {
      id,
      title: clean(common.title),
      album: clean(common.album),
      artist,
      artists: artists.length ? artists : (artist ? [artist] : []),
      albumArtist,
      albumArtists: albumArtists.length ? albumArtists : (albumArtist ? [albumArtist] : []),
      composers,
      genre: unique(list(common.genre)),
      year: typeof common.year === 'number' ? common.year : null,
      track: common.track || null,
    };
  } catch (error) {
    console.warn(`Metadata parse failed for ${id}:`, error);
    return { id, title: '', album: '', artist: '', artists: [], albumArtist: '', albumArtists: [], composers: [], genre: [], year: null, track: null };
  }
}

export async function GET(request: NextRequest) {
  const ids = (request.nextUrl.searchParams.get('ids') || '').split(',').map(v => v.trim()).filter(Boolean).slice(0, 10);
  if (!ids.length) return Response.json([]);

  const results: MetaResult[] = [];
  for (const id of ids) results.push(await parseTrack(request, id));
  return Response.json(results, { headers: { 'Cache-Control': 'no-store' } });
}
