// Build trigger: 2026-10-23T00:30:00.0000000Z
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dns from 'dns';

// Prevenir caídas del servidor ante errores imprevistos
process.on('uncaughtException', (err) => {
  console.error('🛡️ [Uncaught Exception Evitada]:', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('🛡️ [Unhandled Rejection Evitada]:', reason);
});

// Forzar resolución IPv4 primero para evitar timeouts con Deezer, Apple Music y YouTube
dns.setDefaultResultOrder('ipv4first');

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
// MOTOR 1: DEEZER API (Catálogo Latino & Urbano Completo)
// ==========================================

async function fetchDeezer(endpoint) {
  try {
    const res = await fetch(`https://api.deezer.com${endpoint}`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.warn(`[Deezer] Falló ${endpoint}:`, err.message);
    return null;
  }
}

async function searchAlbumsDeezer(q) {
  const data = await fetchDeezer(`/search/album?q=${encodeURIComponent(q)}&limit=15`);
  if (!data || !Array.isArray(data.data)) return [];

  return data.data.map(a => ({
    id: `deezer_${a.id}`,
    deezerId: a.id,
    title: a.title,
    artist: a.artist ? a.artist.name : 'Artista',
    coverXl: a.cover_xl || a.cover_big || a.cover_medium,
    nbTracks: a.nb_tracks || '—',
    releaseDate: 'Oficial',
    link: a.link || `https://www.deezer.com/album/${a.id}`,
    lucidaUrl: `https://lucida.to/?url=${encodeURIComponent(a.link || `https://www.deezer.com/album/${a.id}`)}`,
    source: 'deezer'
  }));
}

async function searchTracksDeezer(q) {
  const data = await fetchDeezer(`/search?q=${encodeURIComponent(q)}&limit=25`);
  if (!data || !Array.isArray(data.data)) return [];

  return data.data.map(t => ({
    id: `deezer_${t.id}`,
    deezerId: t.id,
    title: t.title,
    artist: t.artist ? t.artist.name : 'Artista',
    album: t.album ? t.album.title : 'Álbum',
    albumId: t.album ? `deezer_${t.album.id}` : null,
    deezerAlbumId: t.album ? t.album.id : null,
    coverXl: t.album ? (t.album.cover_xl || t.album.cover_big) : (t.artist ? t.artist.picture_xl : ''),
    duration: t.duration || 0,
    preview: t.preview || null,
    link: t.link || `https://www.deezer.com/track/${t.id}`,
    lucidaUrl: `https://lucida.to/?url=${encodeURIComponent(t.link || `https://www.deezer.com/track/${t.id}`)}`,
    source: 'deezer'
  }));
}

async function getAlbumTracksDeezer(deezerAlbumId) {
  const album = await fetchDeezer(`/album/${deezerAlbumId}`);
  if (!album || album.error) return null;

  const tracks = (album.tracks && Array.isArray(album.tracks.data))
    ? album.tracks.data.map((t, idx) => ({
        position: t.track_position || idx + 1,
        id: `deezer_${t.id}`,
        title: t.title,
        artist: t.artist ? t.artist.name : (album.artist ? album.artist.name : 'Artista'),
        duration: t.duration || 0,
        preview: t.preview || null,
        link: t.link || `https://www.deezer.com/track/${t.id}`,
        lucidaUrl: `https://lucida.to/?url=${encodeURIComponent(t.link || `https://www.deezer.com/track/${t.id}`)}`
      }))
    : [];

  return {
    id: `deezer_${deezerAlbumId}`,
    deezerId: deezerAlbumId,
    title: album.title || 'Álbum',
    artist: album.artist ? album.artist.name : 'Artista',
    coverXl: album.cover_xl || album.cover_big || album.cover_medium,
    releaseDate: album.release_date || 'N/A',
    label: album.label || 'Discográfica',
    nbTracks: album.nb_tracks || tracks.length,
    link: album.link || `https://www.deezer.com/album/${deezerAlbumId}`,
    lucidaAlbumZipUrl: `https://lucida.to/?url=${encodeURIComponent(album.link || `https://www.deezer.com/album/${deezerAlbumId}`)}`,
    tracks
  };
}

// ==========================================
// MOTOR 2: ITUNES SEARCH API (Apple Music Master)
// ==========================================

async function fetchItunes(endpoint) {
  try {
    const res = await fetch(`https://itunes.apple.com${endpoint}`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.warn(`[iTunes] Falló ${endpoint}:`, err.message);
    return null;
  }
}

async function searchAlbumsItunes(q) {
  const data = await fetchItunes(`/search?term=${encodeURIComponent(q)}&entity=album&limit=15&country=US`);
  if (!data || !Array.isArray(data.results)) return [];

  const seen = new Set();
  const albums = [];

  data.results.forEach(a => {
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
  const data = await fetchItunes(`/search?term=${encodeURIComponent(q)}&entity=song&limit=25&country=US`);
  if (!data || !Array.isArray(data.results)) return [];

  return data.results.map(t => ({
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
  const data = await fetchItunes(`/lookup?id=${itunesAlbumId}&entity=song&country=US`);
  if (!data || !Array.isArray(data.results) || data.results.length === 0) return null;

  const results = data.results;
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
    // 0. VERIFICADOR DE VERSIÓN
    if (pathname === '/api/version') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ version: '3.2', status: 'online', engine: 'Hybrid Deezer + Apple Music + YouTube Full Audio' }));
    }

    // 1. BUSCADOR INTELIGENTE DE ÁLBUMES (Deezer + iTunes Combinados)
    if (pathname === '/api/albums/search') {
      const q = (reqUrl.searchParams.get('q') || '').trim();
      if (!q) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Parámetro de búsqueda vacío' }));
      }

      // Consultar en paralelo Deezer e iTunes
      const [deezerAlbums, itunesAlbums, deezerTracks, itunesTracks] = await Promise.all([
        searchAlbumsDeezer(q),
        searchAlbumsItunes(q),
        searchTracksDeezer(q),
        searchTracksItunes(q)
      ]);

      const seenAlbums = new Set();
      const combined = [];

      function addAlbum(album, matchedTrackName = null) {
        const normKey = `${album.title.toLowerCase().trim()}_${album.artist.toLowerCase().trim()}`;
        if (seenAlbums.has(normKey)) return;
        seenAlbums.add(normKey);

        if (matchedTrackName) {
          album.matchedTrack = matchedTrackName;
        }
        combined.push(album);
      }

      // Primero: Álbumes extraídos directamente de las pistas coincidentes (ej: "blessd superstar" -> álbum SUPERSTAR)
      for (const t of deezerTracks) {
        if (t.album && t.deezerAlbumId) {
          addAlbum({
            id: `deezer_${t.deezerAlbumId}`,
            deezerId: t.deezerAlbumId,
            title: t.album,
            artist: t.artist,
            coverXl: t.coverXl,
            nbTracks: '—',
            releaseDate: 'Oficial',
            link: t.link,
            lucidaUrl: t.lucidaUrl,
            source: 'deezer'
          }, t.title);
        }
      }

      for (const t of itunesTracks) {
        if (t.album && t.itunesAlbumId) {
          addAlbum({
            id: `itunes_${t.itunesAlbumId}`,
            itunesId: t.itunesAlbumId,
            title: t.album,
            artist: t.artist,
            coverXl: t.coverXl,
            nbTracks: '—',
            releaseDate: 'Oficial',
            link: t.link,
            lucidaUrl: t.lucidaUrl,
            source: 'itunes'
          }, t.title);
        }
      }

      // Luego agregar los álbumes oficiales devueltos por búsqueda directa
      for (const a of deezerAlbums) addAlbum(a);
      for (const a of itunesAlbums) addAlbum(a);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ albums: combined }));
    }

    // 2. DETALLE COMPLETO DE UN ÁLBUM CON TODAS SUS CANCIONES
    if (pathname.startsWith('/api/album/')) {
      const rawId = pathname.replace('/api/album/', '');
      let album = null;

      if (rawId.startsWith('deezer_')) {
        const deezerId = rawId.replace('deezer_', '');
        album = await getAlbumTracksDeezer(deezerId);
      } else if (rawId.startsWith('itunes_')) {
        const itunesId = rawId.replace('itunes_', '');
        album = await getAlbumTracksItunes(itunesId);
      } else {
        // Por defecto intentar Deezer y si no iTunes
        album = await getAlbumTracksDeezer(rawId);
        if (!album) album = await getAlbumTracksItunes(rawId);
      }

      if (!album) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Álbum no encontrado' }));
      }

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

      // Enlaces directos de Deezer
      const deezerAlbumMatch = q.match(/deezer\.com\/(?:\w{2}\/)?album\/(\d+)/);
      if (deezerAlbumMatch) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ isAlbum: true, albumId: `deezer_${deezerAlbumMatch[1]}` }));
      }

      // Enlaces directos de Apple Music
      const itunesAlbumMatch = q.match(/music\.apple\.com\/(?:\w{2}\/)?album\/(?:[^/]+\/)?(\d+)/);
      if (itunesAlbumMatch) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ isAlbum: true, albumId: `itunes_${itunesAlbumMatch[1]}` }));
      }

      // Búsqueda en paralelo Deezer + iTunes
      const [deezerTracks, itunesTracks] = await Promise.all([
        searchTracksDeezer(q),
        searchTracksItunes(q)
      ]);

      const seen = new Set();
      const combinedTracks = [];

      for (const t of deezerTracks) {
        const key = `${t.title.toLowerCase().trim()}_${t.artist.toLowerCase().trim()}`;
        if (!seen.has(key)) {
          seen.add(key);
          combinedTracks.push(t);
        }
      }

      for (const t of itunesTracks) {
        const key = `${t.title.toLowerCase().trim()}_${t.artist.toLowerCase().trim()}`;
        if (!seen.has(key)) {
          seen.add(key);
          combinedTracks.push(t);
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ isAlbum: false, data: combinedTracks }));
    }

    // 4. AUDIO COMPLETO VÍA YOUTUBE (Transmisión oficial controlable)
    if (pathname === '/api/fullaudio') {
      const q = (reqUrl.searchParams.get('q') || '').trim();
      if (!q) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Parámetro vacío' }));
      }

      try {
        const queryYt = `${q} audio`;
        const ytRes = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(queryYt)}`, {
          headers: { 'User-Agent': USER_AGENT },
          signal: AbortSignal.timeout(8000)
        });
        const html = await ytRes.text();

        // Extraer el primer videoId válido de los resultados de YouTube
        const regex = /"videoRenderer":\{"videoId":"([^"]+)".+?"title":\{"runs":\[\{"text":"([^"]+)"\}\]/g;
        let match;
        let videoId = null;
        let videoTitle = null;

        while ((match = regex.exec(html)) !== null) {
          const id = match[1];
          const title = match[2];
          // Evitar shorts o IDs inválidos
          if (id && id.length === 11) {
            videoId = id;
            videoTitle = title;
            break;
          }
        }

        if (!videoId) {
          const idx = html.indexOf('watch?v=');
          if (idx !== -1) {
            videoId = html.substring(idx + 8, idx + 19);
          }
        }

        if (videoId) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            videoId,
            videoTitle,
            embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&enablejsapi=1`
          }));
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'No se encontró stream de audio' }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: err.message }));
      }
    }

    // 5. INICIAR CONVERSIÓN MP3 COMPLETA (Vía motor limpio p.savenow.to)
    if (pathname === '/api/start-mp3-conversion') {
      const q = (reqUrl.searchParams.get('q') || '').trim();
      const videoIdParam = (reqUrl.searchParams.get('videoId') || '').trim();

      if (!q && !videoIdParam) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Parámetro vacío' }));
      }

      try {
        let targetVideoId = (videoIdParam && videoIdParam.length === 11) ? videoIdParam : null;

        if (!targetVideoId && q) {
          try {
            const ytRes = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(q + ' audio')}`, {
              headers: { 'User-Agent': USER_AGENT },
              signal: AbortSignal.timeout(8000)
            });
            const html = await ytRes.text();
            const match = html.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
            if (match) targetVideoId = match[1];
          } catch (e) {
            console.warn('[Start MP3] Búsqueda de videoId falló:', e.message);
          }
        }

        if (!targetVideoId) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'No se encontró el video en YouTube' }));
        }

        console.log(`[Start MP3] Iniciando conversión limpia para videoId: ${targetVideoId}`);

        // Llamar directamente al backend limpio p.savenow.to
        const startRes = await fetch(`https://p.savenow.to/ajax/download.php?format=mp3&url=https://www.youtube.com/watch?v=${targetVideoId}`, {
          headers: { 'User-Agent': USER_AGENT },
          signal: AbortSignal.timeout(15000)
        });
        const startData = await startRes.json();

        if (!startData.success || !startData.progress_url) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'El servidor de conversión no respondió adecuadamente' }));
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          success: true,
          id: startData.id,
          progressUrl: startData.progress_url,
          title: startData.title || startData.info?.title || 'cancion',
          videoId: targetVideoId
        }));
      } catch (err) {
        console.error('[Start MP3] Error:', err.message);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: err.message }));
        }
        return;
      }
    }

    // 5.1 VERIFICAR PROGRESO DE CONVERSIÓN Y ENTREGAR URL DIRECTA DE DESCARGA
    if (pathname === '/api/check-mp3-progress') {
      const progressUrl = (reqUrl.searchParams.get('url') || '').trim();
      if (!progressUrl) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'URL de progreso requerida' }));
      }

      try {
        const progRes = await fetch(progressUrl, {
          headers: { 'User-Agent': USER_AGENT },
          signal: AbortSignal.timeout(10000)
        });
        const progData = await progRes.json();

        // Validar que el progreso sea 1000 y que la URL venga de un servidor CDN de almacenamiento válido
        const hasValidUrl = progData.download_url && progData.download_url.includes('savenow.to') && !progData.download_url.includes('affadaffa');
        const isFinished = progData.progress === 1000 && hasValidUrl;

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          progress: progData.progress || 0,
          text: progData.text || '',
          isFinished: !!isFinished,
          downloadUrl: isFinished ? progData.download_url : null
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: err.message }));
      }
    }

    // 6. PROXY DE DESCARGA MP3 (Descarga desde savenow CDN con validación de audio)
    if (pathname === '/api/download-mp3') {
      const downloadUrl = (reqUrl.searchParams.get('url') || '').trim();
      const filename = (reqUrl.searchParams.get('filename') || 'cancion').trim();

      if (!downloadUrl) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'URL de descarga vacía' }));
      }

      const safeFilename = filename.replace(/[^\w\s\-\.áéíóúñÁÉÍÓÚÑ]/g, '').trim() || 'cancion';
      const encodedFilename = encodeURIComponent(safeFilename);

      try {
        const audioFetch = await fetch(downloadUrl, {
          headers: { 'User-Agent': USER_AGENT },
          signal: AbortSignal.timeout(60000)
        });

        if (!audioFetch.ok) {
          throw new Error('El servidor de almacenamiento respondió con status ' + audioFetch.status);
        }

        const contentType = audioFetch.headers.get('content-type') || '';
        if (contentType.includes('text') || contentType.includes('html')) {
          throw new Error('El archivo aún se está procesando o no es válido.');
        }

        const contentLength = audioFetch.headers.get('content-length');
        const headers = {
          'Content-Type': 'audio/mpeg',
          'Content-Disposition': `attachment; filename="${safeFilename}.mp3"; filename*=UTF-8''${encodedFilename}.mp3`,
          'Cache-Control': 'no-cache'
        };
        if (contentLength) {
          headers['Content-Length'] = contentLength;
        }

        res.writeHead(200, headers);

        const reader = audioFetch.body.getReader();
        const pump = async () => {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              res.end();
              break;
            }
            if (!res.write(value)) {
              await new Promise(resolve => res.once('drain', resolve));
            }
          }
        };

        res.on('close', () => {
          try { reader.cancel(); } catch (e) {}
        });

        await pump();
        return;
      } catch (err) {
        console.error('[Download MP3 Proxy] Error:', err.message);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: err.message }));
        }
        return;
      }
    }

    // Servir archivos estáticos del frontend
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
  console.log(`🌴 VICE MUSIC // MOTOR DUAL: DEEZER + ITUNES + AUDIO STREAM`);
  console.log(`🌐 Puerto: ${PORT}`);
  console.log(`======================================================\n`);
});
