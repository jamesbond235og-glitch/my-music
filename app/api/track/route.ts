import { File } from 'megajs';
import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MP3_URL = process.env.MEGA_TEST_URL;
const M4A_URL = 'https://mega.nz/file/Jz4SAZIK#7cJMxdT44BN9QIh6ea_neDwqvs5ztaj2OepUe0tqfjw';

function getAudioContentType(format: string | null, fileName: string): string {
  // Prefer the explicitly requested format so a MEGA filename without an
  // extension cannot cause the browser to receive application/octet-stream.
  if (format === 'm4a') return 'audio/mp4';
  if (format === 'mp3') return 'audio/mpeg';

  const extension = fileName.toLowerCase().split('.').pop();
  switch (extension) {
    case 'mp3': return 'audio/mpeg';
    case 'm4a':
    case 'm4b':
    case 'mp4': return 'audio/mp4';
    case 'aac': return 'audio/aac';
    case 'wav': return 'audio/wav';
    case 'ogg': return 'audio/ogg';
    case 'flac': return 'audio/flac';
    default: return 'application/octet-stream';
  }
}

export async function GET(request: NextRequest) {
  const format = request.nextUrl.searchParams.get('format');
  const megaUrl = format === 'm4a' ? M4A_URL : MP3_URL;

  if (!megaUrl) {
    return new Response('MEGA_TEST_URL is not configured', { status: 500 });
  }

  try {
    const file = File.fromURL(megaUrl);
    await file.loadAttributes();

    const size = Number(file.size || 0);
    if (!size) return new Response('MEGA file has no readable size', { status: 502 });

    const fileName = String(file.name || (format === 'm4a' ? 'track.m4a' : 'track.mp3'));
    const contentType = getAudioContentType(format, fileName);
    const range = request.headers.get('range');
    let start = 0;
    let end = size - 1;

    if (range) {
      const match = range.match(/bytes=(\d*)-(\d*)/);
      if (!match) return new Response('Invalid Range', { status: 416 });

      if (match[1]) start = Number(match[1]);
      if (match[2]) end = Number(match[2]);
      else end = size - 1;

      // Handle suffix byte ranges correctly: bytes=-N.
      if (!match[1] && match[2]) {
        const suffixLength = Number(match[2]);
        start = Math.max(0, size - suffixLength);
        end = size - 1;
      }

      if (start >= size || end >= size || start > end) {
        return new Response(null, {
          status: 416,
          headers: { 'Content-Range': `bytes */${size}` },
        });
      }
    }

    const length = end - start + 1;
    const megaStream = file.download({
      start,
      end,
      maxConnections: 1,
      forceHttps: true,
    });

    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        megaStream.on('data', (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
        megaStream.on('end', () => controller.close());
        megaStream.on('error', (error: Error) => controller.error(error));
      },
      cancel() {
        megaStream.destroy();
      },
    });

    const headers = new Headers({
      'Content-Type': contentType,
      'Content-Disposition': `inline; filename="${fileName.replace(/["\\\r\n]/g, '_')}"`,
      'Accept-Ranges': 'bytes',
      'Content-Length': String(length),
      'Cache-Control': 'private, no-store',
    });

    if (range) {
      headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
    }

    return new Response(body, {
      status: range ? 206 : 200,
      headers,
    });
  } catch (error) {
    console.error('MEGA streaming error:', error);
    const message = error instanceof Error ? error.message : String(error);
    return new Response(`Unable to stream the MEGA file: ${message}`, { status: 502 });
  }
}
