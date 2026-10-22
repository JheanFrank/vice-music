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

      const [albumRes, trackRes] = await Promise.all([
        fetch(`https://api.deezer.com/search/album?q=${encodeURIComponent(q)}&limit=15`, {
          headers: { 'User-Agent': USER_AGENT }
        }).then(r => r.json()).catch(() => ({ data: [] })),
        fetch(`https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=15`, {
          headers: { 'User-Agent': USER_AGENT }
        }).then(r => r.json()).catch(() => ({ data: [] }))
      ]);

      const seenIds = new Set();
      const combinedAlbums = [];

      (trackRes.data || []).forEach(t => {
        if (t.album && t.album.id && !seenIds.has(t.album.id)) {
          seenIds.add(t.album.id);
          combinedAlbums.push({
            id: t.album.id,
            title: t.album.title,
            artist: t.artist?.name || 'Artista',
            coverXl: t.album.cover_xl || t.album.cover_big || 'https://via.placeholder.com/1000/180838/ff2a85?text=ALBUM',
            nbTracks: t.album.nb_tracks || 'Álbum',
            matchedTrack: t.title,
            link: `https://www.deezer.com/album/${t.album.id}`,
            lucidaUrl: `https://lucida.to/?url=${encodeURIComponent(`https://www.deezer.com/album/${t.album.id}`)}`
          });
        }
      });

      (albumRes.data || []).forEach(a => {
        if (a.id && !seenIds.has(a.id)) {
          seenIds.add(a.id);
          combinedAlbums.push({
            id: a.id,
            title: a.title,
            artist: a.artist?.name || 'Artista',
            coverXl: a.cover_xl || a.cover_big || 'https://via.placeholder.com/1000/180838/ff2a85?text=ALBUM',
            nbTracks: a.nb_tracks || 'Álbum',
            link: a.link || `https://www.deezer.com/album/${a.id}`,
            lucidaUrl: `https://lucida.to/?url=${encodeURIComponent(a.link || `https://www.deezer.com/album/${a.id}`)}`
          });
        }
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ albums: combinedAlbums }));
    }

    // 2. DETALLE COMPLETO DE UN ÁLBUM CON TODAS SUS CANCIONES
    if (pathname.startsWith('/api/album/')) {
      const albumId = pathname.replace('/api/album/', '');
      const dRes = await fetch(`https://api.deezer.com/album/${albumId}`, {
        headers: { 'User-Agent': USER_AGENT }
      });
      const albumData = await dRes.json();

      if (albumData.error) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: albumData.error.message }));
      }

      const albumDirectLink = albumData.link || `https://www.deezer.com/album/${albumData.id}`;

      const tracks = (albumData.tracks?.data || []).map((t, idx) => ({
        position: t.track_position || idx + 1,
        id: t.id,
        title: t.title,
        artist: t.artist?.name || albumData.artist?.name || 'Artista',
        duration: t.duration || 0,
        preview: t.preview || null,
        isrc: t.isrc || 'N/A',
        link: t.link || `https://www.deezer.com/track/${t.id}`,
        lucidaUrl: `https://lucida.to/?url=${encodeURIComponent(t.link || `https://www.deezer.com/track/${t.id}`)}`
      }));

      const fullAlbum = {
        id: albumData.id,
        title: albumData.title,
        artist: albumData.artist?.name || 'Artista',
        coverXl: albumData.cover_xl || albumData.cover_big,
        releaseDate: albumData.release_date || 'N/A',
        label: albumData.label || 'Discográfica',
        nbTracks: albumData.nb_tracks || tracks.length,
        link: albumDirectLink,
        lucidaAlbumZipUrl: `https://lucida.to/?url=${encodeURIComponent(albumDirectLink)}`,
        tracks
      };

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(fullAlbum));
    }

    // 3. RESOLVER ENLACES O BUSCAR PISTAS INDIVIDUALES
    if (pathname === '/api/resolve') {
      const q = (reqUrl.searchParams.get('q') || '').trim();
      if (!q) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Parámetro de búsqueda vacío' }));
      }

      const albumMatch = q.match(/album\/(\d+)/);
      if (albumMatch) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ isAlbum: true, albumId: albumMatch[1] }));
      }

      let searchTerm = q;

      if (q.includes('spotify.com/track')) {
        try {
          const oembedRes = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(q)}`, {
            headers: { 'User-Agent': USER_AGENT }
          });
          const oembedData = await oembedRes.json();
          if (oembedData.title) searchTerm = oembedData.title;
        } catch (e) {
          console.warn('Error en Spotify oEmbed:', e.message);
        }
      }

      const searchRes = await fetch(`https://api.deezer.com/search?q=${encodeURIComponent(searchTerm)}&limit=20`, {
        headers: { 'User-Agent': USER_AGENT }
      });
      const searchData = await searchRes.json();

      const tracks = (searchData.data || []).map(t => ({
        id: t.id,
        title: t.title,
        artist: t.artist?.name || 'Artista',
        album: t.album?.title || 'Álbum',
        albumId: t.album?.id || null,
        coverXl: t.album?.cover_xl || t.album?.cover_big,
        duration: t.duration || 0,
        preview: t.preview || null,
        isrc: t.isrc || 'N/A',
        link: t.link || `https://www.deezer.com/track/${t.id}`,
        lucidaUrl: `https://lucida.to/?url=${encodeURIComponent(t.link || `https://www.deezer.com/track/${t.id}`)}`
      }));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ isAlbum: false, data: tracks }));
    }

    // 4. NUEVO ENDPOINT: OBTENER AUDIO 100% COMPLETO (SIN LÍMITE DE 30s)
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
          signal: AbortSignal.timeout(7000)
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
        return res.end(JSON.stringify({ error: 'No se encontró stream completo' }));
      } catch (err) {
        console.error('Error buscando audio completo:', err.message);
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
  console.log(`🌴 VICE MUSIC // AUDIO COMPLETO & ÁLBUMES ACTIVOS`);
  console.log(`🌐 Puerto de ejecución: ${PORT}`);
  console.log(`======================================================\n`);
});
