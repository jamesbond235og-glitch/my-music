# My Music

Private Spotify-style music player using MEGA as the first storage backend.

## First MEGA test

1. Install Node.js 20+ and npm.
2. Run `npm install`.
3. Copy `.env.example` to `.env.local`.
4. Keep `MEGA_TEST_URL` as your private test-link value (or replace it with another MEGA file link).
5. Run `npm run dev`.
6. Open http://localhost:3000.
7. Click play on `03. Namaste`.

The server uses the `megajs` package to load the shared MEGA file and exposes it through `/api/track` with HTTP byte-range support so the browser audio element can seek.

## Security

Do not put your MEGA password in source code. The first test uses the shared file link. Anyone with that link may be able to access the shared file, so revoke/replace the link later if you want the file private.

## Next milestone

Replace the single test link with authenticated library indexing, scan metadata/artwork, and build the full Songs/Albums/Artists library.
