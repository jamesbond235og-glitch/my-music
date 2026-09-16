import { File as MEGAFile } from 'megajs';
import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MEGA_FOLDER_URL = 'https://mega.nz/folder/J6ZzRYoa#kQ2tDf5tNP8NMrrGm_EXow';

function getContentType(fileName: string): string {
  const extension = fileName.toLowerCase().split('.').pop();
  switch (extension) {
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'png': return 'image/png';
    case 'webp': return 'image/webp';
    case 'gif': return 'image/gif';
    default: return 'application/octet-stream';
  }
}

async function findById(folder: any, id: string): Promise<any | null> {
  const children = Array.isArray(folder?.children) ? folder.children : [];
  for (const child of children) {
    if (String(child?.nodeId || child?.downloadId || '') === id) return child;
    if (child?.directory || Array.isArray(child?.children)) {
      const found = await findById(child, id);
      if (found) return found;
    }
  }
  return null;
}

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id');
  if (!id) return new Response('Missing cover id', { status: 400 });

  try {
    const root = MEGAFile.fromURL(MEGA_FOLDER_URL);
    await root.loadAttributes();
    const file = await findById(root, id);
    if (!file || file.directory) return new Response('Cover not found', { status: 404 });

    const fileName = String(file.name || 'cover.jpg');
    const size = Number(file.size || 0);
    if (!size) return new Response('Cover has no readable size', { status: 502 });

    const stream = file.download({ start: 0, end: size - 1, maxConnections: 1, forceHttps: true });
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        stream.on('data', (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
        stream.on('end', () => controller.close());
        stream.on('error', (error: Error) => controller.error(error));
      },
      cancel() { stream.destroy(); },
    });

    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': getContentType(fileName),
        'Content-Length': String(size),
        'Cache-Control': 'private, max-age=300',
      },
    });
  } catch (error) {
    console.error('MEGA cover error:', error);
    const message = error instanceof Error ? error.message : String(error);
    return new Response(`Unable to load the album cover: ${message}`, { status: 502 });
  }
}
