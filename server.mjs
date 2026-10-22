import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// ==========================================
// MOTOR PRINCIPAL: iTunes Search API (GRATIS, sin bloqueos en servidores cloud)
// RESPALDO: Deezer API pública
// ==========================================

async function searchAlbumsItunes(q) {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=album&limit=20&country=US`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  const data = await res.json();

  const seen = new Set();
  const albums = [];

  (data.results || []).forEach(a => {
    const id = a.collectionId;
    if (!id || seen.has(id)) return;
    seen.add(id);
    albums.push({
      id: `itunes_${id}`,
      itunesId: id,
      title: a.collectionName || 'Álbum',
      artist: a.artistName || 'Artista',
      coverXl: (a.artworkUrl100 || '').replace('100x100bb', '1000x1000bb'),
      nbTracks: a.trackCount || 0,
      releaseDate: a.releaseDate ? a.releaseDate.substring(0, 10) : 'N/A',
      link: a.collectionViewUrl || '',
      lucidaUrl: `https://lucida.to/?url=${encodeURIComponent(a.collectionViewUrl || '')}`,
      source: 'itunes'
    });
  });

  return albums;
}

async function searchTracksItunes(q) {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=song&limit=20&country=US`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  const data = await res.json();

  return (data.results || []).map(t => ({
    id: `itunes_${t.trackId}`,
    itunesId: t.trackId,
    title: t.trackName || 'Pista',
    artist: t.artistName || 'Artista',
    album: t.collectionName || 'Álbum',
    albumId: `itunes_${t.collectionId}`,
    itunesAlbumId: t.collectionId,
    coverXl: (t.artworkUrl100 || '').replace('100x100bb', '1000x1000bb'),
    duration: Math.round((t.trackTimeMillis || 0) / 1000),
    preview: t.previewUrl || null,
    link: t.trackViewUrl || '',
    lucidaUrl: `https://lucida.to/?url=${encodeURIComponent(t.trackViewUrl || '')}`,
    source: 'itunes'
  }));
}

async function getAlbumTracksItunes(itunesAlbumId) {
  const url = `https://itunes.apple.com/lookup?id=${itunesAlbumId}&entity=song&country=US`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  const data = await res.json();

  const results = data.results || [];
  const albumInfo = results.find(r => r.wrapperType === 'collection') || results[0] || {};
  const tracks = results
    .filter(r => r.wrapperType === 'track' && r.kind === 'song')
    .map((t, idx) => ({
      position: t.trackNumber || idx + 1,
      id: `itunes_${t.trackId}`,
      title: t.trackName || 'Pista',
      artist: t.artistName || albumInfo.artistName || 'Artista',
      duration: Math.round((t.trackTimeMillis || 0) / 1000),
      preview: t.previewUrl || null,
      link: t.trackViewUrl || '',
      lucidaUrl: `https://lucida.to/?url=${encodeURIComponent(t.trackViewUrl || '')}`
    }));

  return {
    id: `itunes_${itunesAlbumId}`,
    itunesId: itunesAlbumId,
    title: albumInfo.collectionName || 'Álbum',
    artist: albumInfo.artistName || 'Artista',
    coverXl: (albumInfo.artworkUrl100 || '').replace('100x100bb', '1000x1000bb'),
    releaseDate: albumInfo.releaseDate ? albumInfo.releaseDate.substring(0, 10) : 'N/A',
    label: albumInfo.copyright || 'Discográfica',
    nbTracks: tracks.length,
    link: albumInfo.collectionViewUrl || '',
    lucidaAlbumZipUrl: `https://lucida.to/?url=${encodeURIComponent(albumInfo.collectionViewUrl || '')}`,
    tracks
  };
}

// ==========================================
// SERVIDOR HTTP
// ==========================================

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const reqUrl = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = reqUrl.pathname;

  try {
    // 1. BUSCADOR INTELIGENTE DE ÁLBUMES
    if (pathname === '/api/albums/search') {
      const q = (reqUrl.searchParams.get('q') || '').trim();
      if (!q) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Parámetro de búsqueda vacío' }));
      }

      // Buscar álbumes y pistas en paralelo desde iTunes
      const [albumResults, trackResults] = await Promise.all([
        searchAlbumsItunes(q),
        searchTracksItunes(q)
      ]);

      // Extraer álbumes de los tracks encontrados (para búsquedas por canción)
      const seen = new Set(albumResults.map(a => a.itunesId));
      const fromTracks = [];

      for (const t of trackResults) {
        if (t.itunesAlbumId && !seen.has(t.itunesAlbumId)) {
          seen.add(t.itunesAlbumId);
          fromTracks.push({
            id: `itunes_${t.itunesAlbumId}`,
            itunesId: t.itunesAlbumId,
            title: t.album,
            artist: t.artist,
            coverXl: t.coverXl,
            nbTracks: '—',
            matchedTrack: t.title,
            link: '',
            lucidaUrl: `https://lucida.to/?url=${encodeURIComponent(t.link || '')}`,
            source: 'itunes'
          });
        }
      }

      const combined = [...fromTracks, ...albumResults];

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ albums: combined }));
    }

    // 2. DETALLE COMPLETO DE UN ÁLBUM CON TODAS SUS CANCIONES
    if (pathname.startsWith('/api/album/')) {
      const rawId = pathname.replace('/api/album/', '');
      const itunesId = rawId.replace('itunes_', '');

      const album = await getAlbumTracksItunes(itunesId);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(album));
    }

    // 3. RESOLVER ENLACES O BUSCAR PISTAS INDIVIDUALES
    if (pathname === '/api/resolve') {
      const q = (reqUrl.searchParams.get('q') || '').trim();
      if (!q) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Parámetro de búsqueda vacío' }));
      }

      // Si es enlace de álbum de Deezer (soportar links viejos)
      const deezerAlbum = q.match(/deezer\.com\/album\/(\d+)/);
      if (deezerAlbum) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ isAlbum: true, albumId: `deezer_${deezerAlbum[1]}` }));
      }

      const tracks = await searchTracksItunes(q);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ isAlbum: false, data: tracks }));
    }

    // 4. AUDIO COMPLETO VÍA YOUTUBE (iFrame oficial sin restricciones)
    if (pathname === '/api/fullaudio') {
      const q = (reqUrl.searchParams.get('q') || '').trim();
      if (!q) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Parámetro vacío' }));
      }

      try {
        const queryYt = `${q} official audio`;
        const ytRes = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(queryYt)}`, {
          headers: { 'User-Agent': USER_AGENT },
          signal: AbortSignal.timeout(8000)
        });
        const html = await ytRes.text();
        const idx = html.indexOf('watch?v=');

        if (idx !== -1) {
          const videoId = html.substring(idx + 8, idx + 19);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            videoId,
            embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&enablejsapi=1`
          }));
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'No se encontró stream' }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: err.message }));
      }
    }

    // Servir frontend estático
    let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
    if (!filePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      return res.end('Acceso denegado');
    }
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(PUBLIC_DIR, 'index.html');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);

  } catch (error) {
    console.error('Error en el servidor:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n======================================================`);
  console.log(`🌴 VICE MUSIC // ITUNES ENGINE + AUDIO COMPLETO`);
  console.log(`🌐 Puerto: ${PORT}`);
  console.log(`======================================================\n`);
});
