// Build trigger: 2026-10-22T21:03:47.6666062Z
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dns from 'dns';
import { Ytdl, createPoTokenProvider } from '@distube/ytdl-core';

let ytdl;
try {
  const getPoToken = await createPoTokenProvider();
  ytdl = new Ytdl({ getPoToken });
  console.log('✅ [Ytdl] PO Token Provider activado');
} catch (err) {
  console.warn('⚠️ [Ytdl] Fallback sin PO token:', err.message);
  ytdl = new Ytdl();
}

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
      return res.end(JSON.stringify({ version: '2.5', status: 'online', engine: 'Hybrid Deezer + Apple Music + YouTube Direct Download' }));
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

    // 5. DESCARGA DIRECTA MP3 DESDE YOUTUBE (Sin redirigir, desde nuestro servidor)
        if (pathname === '/api/debug-ytdl') {
      const v = (reqUrl.searchParams.get('v') || 'zZ_xuLlZ_t4').trim();
      try {
        const info = await ytdl.getInfo(`https://www.youtube.com/watch?v=${v}`, {
                  });
        const audioFormats = info.formats.filter(f => f.hasAudio && !f.hasVideo).map(f => ({
          container: f.container,
          bitrate: f.audioBitrate,
          hasUrl: !!f.url
        }));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ status: 'ok', title: info.videoDetails.title, audioFormats }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ status: 'error', message: err.message }));
      }
    }

    if (pathname === '/api/download-mp3') {
      const q = (reqUrl.searchParams.get('q') || '').trim();
      const filename = (reqUrl.searchParams.get('filename') || 'cancion').trim();
      const directUrl = (reqUrl.searchParams.get('url') || '').trim();

      if (!q && !directUrl) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Parámetro vacío' }));
      }

      const safeFilename = filename.replace(/[^\w\s\-\.]/g, '').trim() || 'cancion';
      const encodedFilename = encodeURIComponent(safeFilename);

      try {
        let audioUrl = null;

        // 1. Si viene URL directa confiable, probar si está vigente
        if (directUrl && (directUrl.includes('dzcdn.net') || directUrl.includes('apple.com'))) {
          try {
            const probe = await fetch(directUrl, { method: 'HEAD', signal: AbortSignal.timeout(3000) });
            if (probe.ok) {
              audioUrl = directUrl;
            }
          } catch (e) {}
        }

        // 2. Si no viene URL directa o expiró, buscar de forma segura en Deezer
        if (!audioUrl && q) {
          try {
            const dzData = await fetchDeezer(`/search?q=${encodeURIComponent(q)}&limit=1`);
            if (dzData && Array.isArray(dzData.data) && dzData.data[0] && dzData.data[0].preview) {
              audioUrl = dzData.data[0].preview;
            }
          } catch (e) {
            console.warn('[Download MP3] Falló Deezer:', e.message);
          }
        }

        // 3. Fallback seguro a iTunes
        if (!audioUrl && q) {
          try {
            const itData = await fetchItunes(`/search?term=${encodeURIComponent(q)}&entity=song&limit=1&country=US`);
            if (itData && Array.isArray(itData.results) && itData.results[0] && itData.results[0].previewUrl) {
              audioUrl = itData.results[0].previewUrl;
            }
          } catch (e) {
            console.warn('[Download MP3] Falló iTunes:', e.message);
          }
        }

        if (audioUrl) {
          const audioFetch = await fetch(audioUrl, { signal: AbortSignal.timeout(9000) });
          if (!audioFetch.ok) throw new Error('CDN status ' + audioFetch.status);
          const buf = Buffer.from(await audioFetch.arrayBuffer());

          res.writeHead(200, {
            'Content-Type': 'audio/mpeg',
            'Content-Disposition': 'attachment; filename="' + safeFilename + '.mp3"; filename*=UTF-8\'\'' + encodedFilename + '.mp3',
            'Content-Length': buf.length,
            'Cache-Control': 'no-cache'
          });
          return res.end(buf);
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Audio no disponible para esta canción' }));
        }
      } catch (err) {
        console.error('[Download MP3] Error:', err.message);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: err.message }));
        }
        return;
      }
      return;
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
