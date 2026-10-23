// Build trigger: 2026-10-23T00:30:00.0000000Z
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dns from 'dns';
import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import { Ytdl, Client } from '@distube/ytdl-core';

const ytdl = new Ytdl({ clients: [Client.VisionOS, Client.WebEmbedded] });

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
      return res.end(JSON.stringify({ version: '4.1', status: 'online', engine: 'Vice Music Audio Stream + Apple Music HD Metadata' }));
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
            streamUrl: `/api/stream-audio?videoId=${videoId}`,
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

    // 4.1 STREAM DE AUDIO DIRECTO HTML5 (Sin logos, sin embeds, 100% nativo para reproductor móvil y PC)
    if (pathname === '/api/stream-audio') {
      const videoId = (reqUrl.searchParams.get('videoId') || '').trim();
      if (!videoId || videoId.length !== 11) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'videoId inválido' }));
      }

      try {
        console.log(`[Stream Audio] Abriendo stream nativo para videoId: ${videoId}`);
        const stream = ytdl.download(videoId, {
          filter: { hasAudio: true, hasVideo: false },
          highWaterMark: 1 << 22
        });

        res.writeHead(200, {
          'Content-Type': 'audio/webm',
          'Cache-Control': 'no-cache, no-store',
          'Accept-Ranges': 'bytes',
          'Access-Control-Allow-Origin': '*'
        });

        stream.pipe(res);

        stream.on('error', (err) => {
          console.warn('[Stream Audio] Advertencia de stream:', err.message);
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
          } else {
            res.end();
          }
        });

        req.on('close', () => {
          if (typeof stream.destroy === 'function') stream.destroy();
        });
      } catch (err) {
        console.error('[Stream Audio] Error al iniciar stream:', err.message);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      }
      return;
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

        let downloadUrl = isFinished ? progData.download_url : null;
        if (downloadUrl && downloadUrl.startsWith('http://')) {
          downloadUrl = downloadUrl.replace('http://', 'https://');
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          progress: progData.progress || 0,
          text: progData.text || '',
          isFinished: !!isFinished,
          downloadUrl: downloadUrl
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: err.message }));
      }
    }

// ==========================================
// MOTOR ID3v2.3: GENERADOR DE METADATOS Y CARÁTULA OFICIAL HD 1000PX
// ==========================================

function encodeSyncSafe(size) {
  return Buffer.from([
    (size >> 21) & 0x7f,
    (size >> 14) & 0x7f,
    (size >> 7) & 0x7f,
    size & 0x7f
  ]);
}

function makeTextFrame(id, text) {
  if (!text) return Buffer.alloc(0);
  const strBuf = Buffer.from(text, 'utf16le');
  const bom = Buffer.from([0xff, 0xfe]);
  const content = Buffer.concat([Buffer.from([0x01]), bom, strBuf]);
  const header = Buffer.alloc(10);
  header.write(id, 0, 4, 'ascii');
  header.writeUInt32BE(content.length, 4);
  return Buffer.concat([header, content]);
}

function makeApicFrame(imageBuffer, mimeType = 'image/jpeg') {
  if (!imageBuffer || imageBuffer.length === 0) return Buffer.alloc(0);
  const mimeBuf = Buffer.from(mimeType + '\0', 'latin1');
  const picType = Buffer.from([0x03]); // Cover (front)
  const desc = Buffer.from([0x00]); // Descripción vacía null
  const content = Buffer.concat([Buffer.from([0x00]), mimeBuf, picType, desc, imageBuffer]);
  const header = Buffer.alloc(10);
  header.write('APIC', 0, 4, 'ascii');
  header.writeUInt32BE(content.length, 4);
  return Buffer.concat([header, content]);
}

function makeCommentFrame(text, lang = 'eng') {
  if (!text) return Buffer.alloc(0);
  const langBuf = Buffer.from(lang.slice(0, 3), 'ascii');
  const bom = Buffer.from([0xff, 0xfe]);
  const emptyDesc = Buffer.from([0x00, 0x00]);
  const textBuf = Buffer.from(text, 'utf16le');
  const content = Buffer.concat([Buffer.from([0x01]), langBuf, bom, emptyDesc, bom, textBuf]);
  const header = Buffer.alloc(10);
  header.write('COMM', 0, 4, 'ascii');
  header.writeUInt32BE(content.length, 4);
  return Buffer.concat([header, content]);
}

function createId3Tag({ title, artist, albumArtist, album, composer, publisher, copyright, isrc, encodedBy, comment, year, releaseDate, track, totalTracks, disk, genre, imageBuffer }) {
  const frames = [];
  if (title) frames.push(makeTextFrame('TIT2', title));
  if (artist) frames.push(makeTextFrame('TPE1', artist));
  if (albumArtist || artist) frames.push(makeTextFrame('TPE2', albumArtist || artist));
  if (album) frames.push(makeTextFrame('TALB', album));
  if (composer) frames.push(makeTextFrame('TCOM', composer));
  if (publisher) frames.push(makeTextFrame('TPUB', publisher));
  if (copyright) frames.push(makeTextFrame('TCOP', copyright));
  if (isrc) frames.push(makeTextFrame('TSRC', isrc));
  if (encodedBy) frames.push(makeTextFrame('TENC', encodedBy));

  // Pista (TRCK): e.g. "3/15" o "3"
  if (track) {
    const trackStr = totalTracks ? `${track}/${totalTracks}` : String(track);
    frames.push(makeTextFrame('TRCK', trackStr));
  }

  // Disco (TPOS): e.g. "1" o "1/1"
  if (disk) {
    frames.push(makeTextFrame('TPOS', String(disk)));
  }

  // Género musical (TCON)
  if (genre) {
    frames.push(makeTextFrame('TCON', genre));
  }

  // Año estándar TYER (4 dígitos YYYY limpio para evitar caracteres '\\' en Mp3tag)
  const cleanYear = (year || releaseDate || '').match(/\b(19\d{2}|20\d{2})\b/);
  if (cleanYear) {
    frames.push(makeTextFrame('TYER', cleanYear[0]));
  }

  // Fecha día y mes (TDAT DDMM) estándar en ID3v2.3
  if (releaseDate && releaseDate.includes('-')) {
    const parts = releaseDate.split('-');
    if (parts.length >= 3) {
      frames.push(makeTextFrame('TDAT', parts[2].slice(0, 2) + parts[1].slice(0, 2)));
    }
  }

  // Sin comentarios molestos para dejar el campo Comentario 100% limpio
  if (imageBuffer) frames.push(makeApicFrame(imageBuffer, 'image/jpeg'));

  const totalFrames = Buffer.concat(frames);
  const tagHeader = Buffer.alloc(10);
  tagHeader.write('ID3', 0, 3, 'ascii');
  tagHeader.writeUInt8(3, 3); // ID3v2.3
  tagHeader.writeUInt8(0, 4);
  tagHeader.writeUInt8(0, 5); // flags
  encodeSyncSafe(totalFrames.length).copy(tagHeader, 6);

  return Buffer.concat([tagHeader, totalFrames]);
}

function stripOldId3(mp3Buffer) {
  if (mp3Buffer.length > 10 && mp3Buffer.toString('ascii', 0, 3) === 'ID3') {
    const size = (mp3Buffer[6] << 21) | (mp3Buffer[7] << 14) | (mp3Buffer[8] << 7) | mp3Buffer[9];
    const totalHeader = size + 10;
    return mp3Buffer.subarray(totalHeader);
  }
  return mp3Buffer;
}

    // 6. MOTOR NATIVO DEFINITIVO: DESCARGA MP3 320 KBPS CON METADATOS Y CARÁTULA HD 1000PX
    if (pathname === '/api/download-mp3') {
      const q = (reqUrl.searchParams.get('q') || '').trim();
      const videoIdParam = (reqUrl.searchParams.get('videoId') || '').trim();
      const filename = (reqUrl.searchParams.get('filename') || 'cancion').trim();
      let title = (reqUrl.searchParams.get('title') || '').trim();
      let artist = (reqUrl.searchParams.get('artist') || '').trim();
      let album = (reqUrl.searchParams.get('album') || '').trim();
      let albumArtist = (reqUrl.searchParams.get('albumArtist') || '').trim();
      let year = (reqUrl.searchParams.get('year') || '').trim();
      let releaseDate = (reqUrl.searchParams.get('releaseDate') || '').trim();
      let track = (reqUrl.searchParams.get('track') || '').trim();
      let totalTracks = (reqUrl.searchParams.get('totalTracks') || '').trim();
      let disk = (reqUrl.searchParams.get('disk') || '').trim();
      let genre = (reqUrl.searchParams.get('genre') || '').trim();
      let publisher = (reqUrl.searchParams.get('publisher') || reqUrl.searchParams.get('label') || '').trim();
      let copyright = (reqUrl.searchParams.get('copyright') || '').trim();
      let composer = (reqUrl.searchParams.get('composer') || '').trim();
      let isrc = (reqUrl.searchParams.get('isrc') || '').trim();
      let coverUrl = (reqUrl.searchParams.get('cover') || '').trim();

      const safeFilename = filename.replace(/[^\w\s\-\.áéíóúñÁÉÍÓÚÑ]/g, '').trim() || 'cancion';
      const encodedFilename = encodeURIComponent(safeFilename);

      try {
        // Enriquecer metadatos automáticamente con Deezer si faltan datos de discografía
        if (!genre || !track || !releaseDate || !albumArtist || !publisher || !isrc) {
          try {
            const dzSearchRes = await fetch(`https://api.deezer.com/search?q=${encodeURIComponent(`${artist || ''} ${title || q}`.trim())}&limit=1`, {
              headers: { 'User-Agent': USER_AGENT },
              signal: AbortSignal.timeout(3500)
            });
            const dzSearchData = await dzSearchRes.json();
            if (dzSearchData.data && dzSearchData.data[0]) {
              const dzItem = dzSearchData.data[0];
              if (!title && dzItem.title) title = dzItem.title;
              if (!artist && dzItem.artist?.name) artist = dzItem.artist.name;
              if (!album && dzItem.album?.title) album = dzItem.album.title;
              if (!albumArtist && (dzItem.album?.artist || dzItem.artist?.name)) albumArtist = dzItem.album?.artist || dzItem.artist?.name;
              if (!coverUrl && (dzItem.album?.cover_xl || dzItem.album?.cover_big)) coverUrl = dzItem.album?.cover_xl || dzItem.album?.cover_big;

              // Obtener track_position, disk_number, ISRC y compositores desde el endpoint de pista
              if (!track || !disk || !isrc || !composer) {
                try {
                  const trkRes = await fetch(`https://api.deezer.com/track/${dzItem.id}`, {
                    headers: { 'User-Agent': USER_AGENT },
                    signal: AbortSignal.timeout(3000)
                  });
                  const trkData = await trkRes.json();
                  if (!track && trkData.track_position) track = String(trkData.track_position);
                  if (!disk && trkData.disk_number) disk = String(trkData.disk_number);
                  if (!releaseDate && trkData.release_date) releaseDate = trkData.release_date;
                  if (!isrc && trkData.isrc) isrc = trkData.isrc;
                  if (!composer && trkData.contributors?.length > 0) {
                    composer = trkData.contributors.map(c => c.name).join(' / ');
                  }
                } catch (_) {}
              }

              if (dzItem.album?.id) {
                try {
                  const albRes = await fetch(`https://api.deezer.com/album/${dzItem.album.id}`, {
                    headers: { 'User-Agent': USER_AGENT },
                    signal: AbortSignal.timeout(3500)
                  });
                  const albData = await albRes.json();
                  if (!genre && albData.genres?.data?.length > 0) {
                    genre = albData.genres.data.map(g => g.name).join(' / ');
                  }
                  if (!releaseDate && albData.release_date) {
                    releaseDate = albData.release_date;
                  }
                  if (!totalTracks && albData.nb_tracks) {
                    totalTracks = String(albData.nb_tracks);
                  }
                  if (!albumArtist && albData.artist?.name) {
                    albumArtist = albData.artist.name;
                  }
                  if (!publisher && albData.label) {
                    publisher = albData.label;
                  }
                } catch (_) {}
              }
            }
          } catch (_) {}
        }
        let targetVideoId = (videoIdParam && videoIdParam.length === 11) ? videoIdParam : null;

        if (!targetVideoId && q) {
          try {
            const ytRes = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(q + ' audio')}`, {
              headers: { 'User-Agent': USER_AGENT },
              signal: AbortSignal.timeout(8000)
            });
            const html = await ytRes.text();
            const regex = /"videoRenderer":\{"videoId":"([^"]+)".+?"title":\{"runs":\[\{"text":"([^"]+)"\}\]/g;
            let m;
            while ((m = regex.exec(html)) !== null) {
              if (m[1] && m[1].length === 11) {
                targetVideoId = m[1];
                break;
              }
            }
            if (!targetVideoId) {
              const idx = html.indexOf('watch?v=');
              if (idx !== -1) {
                targetVideoId = html.substring(idx + 8, idx + 19);
              }
            }
          } catch (e) {
            console.warn('[Native Engine] Búsqueda de videoId falló:', e.message);
          }
        }

        if (!targetVideoId) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'No se encontró el video en YouTube' }));
        }

        console.log(`[Native MP3 Engine] Generando MP3 320 kbps para "${safeFilename}" (${targetVideoId})...`);

        // Descarga de carátula oficial 1000x1000 en paralelo
        let coverBuf = null;
        if (coverUrl) {
          try {
            const cRes = await fetch(coverUrl, {
              headers: { 'User-Agent': USER_AGENT },
              signal: AbortSignal.timeout(10000)
            });
            if (cRes.ok) coverBuf = Buffer.from(await cRes.arrayBuffer());
          } catch (cErr) {
            console.warn('[Native MP3 Engine] Falló descarga de carátula:', cErr.message);
          }
        }

        let rawMp3 = null;

        // ESTRATEGIA 1: Transcodificación directa local de alta fidelidad 320 kbps
        try {
          console.log(`[Native MP3 Engine] Intentando extracción local directa para ${targetVideoId}...`);
          const stream = await ytdl.download(targetVideoId, {
            filter: f => f.hasAudio && !f.hasVideo,
            quality: 'highestaudio'
          });

          const ffmpeg = spawn(ffmpegPath, [
            '-i', 'pipe:0',
            '-vn',
            '-c:a', 'libmp3lame',
            '-b:a', '320k',
            '-f', 'mp3',
            'pipe:1'
          ]);

          stream.pipe(ffmpeg.stdin);

          const chunks = [];
          ffmpeg.stdout.on('data', c => chunks.push(c));

          rawMp3 = await new Promise((resolve, reject) => {
            ffmpeg.on('close', code => {
              if (code === 0) resolve(Buffer.concat(chunks));
              else reject(new Error('FFmpeg finalizó con código ' + code));
            });
            ffmpeg.stderr.on('data', () => {});
            stream.on('error', reject);
            ffmpeg.on('error', reject);
          });

          if (!rawMp3 || rawMp3.length < 100000) {
            throw new Error(`Extracción insuficiente: ${rawMp3 ? rawMp3.length : 0} bytes`);
          }

          console.log(`[Native MP3 Engine] Extracción local exitosa: ${(rawMp3.length / (1024 * 1024)).toFixed(2)} MB`);
        } catch (localErr) {
          console.warn(`[Native MP3 Engine] Extracción local no disponible (${localErr.message}). Activando motor en la nube con proxies anti-bot...`);

          // ESTRATEGIA 2: Motor en la nube con proxies rotativos (para Render y servidores cloud)
          const startRes = await fetch(`https://p.savenow.to/ajax/download.php?format=mp3&audio_quality=320&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${targetVideoId}`)}`, {
            headers: { 'User-Agent': USER_AGENT },
            signal: AbortSignal.timeout(15000)
          });
          const startData = await startRes.json();

          if (!startData.success || !startData.progress_url) {
            throw new Error('Servidor de conversión en la nube no disponible temporalmente');
          }

          let downloadUrl = null;
          for (let i = 0; i < 28; i++) {
            await new Promise(r => setTimeout(r, 1000));
            const pr = await fetch(startData.progress_url, {
              headers: { 'User-Agent': USER_AGENT },
              signal: AbortSignal.timeout(10000)
            });
            const pd = await pr.json();
            if (pd.download_url && pd.progress === 1000) {
              downloadUrl = pd.download_url;
              break;
            }
            if (pd.error) throw new Error(pd.error);
          }

          if (!downloadUrl) {
            throw new Error('Tiempo de espera agotado al procesar audio en la nube');
          }

          console.log(`[Native MP3 Engine] Descargando audio desde servidor de alta velocidad...`);
          const fileRes = await fetch(downloadUrl, {
            headers: { 'User-Agent': USER_AGENT },
            signal: AbortSignal.timeout(45000)
          });

          if (!fileRes.ok) throw new Error(`Error ${fileRes.status} al descargar archivo de audio`);

          const cloudBuffer = Buffer.from(await fileRes.arrayBuffer());
          rawMp3 = stripOldId3(cloudBuffer);

          if (!rawMp3 || rawMp3.length < 100000) {
            throw new Error(`Audio en la nube corrupto o insuficiente (${rawMp3 ? rawMp3.length : 0} bytes)`);
          }

          console.log(`[Native MP3 Engine] Audio recibido desde la nube: ${(rawMp3.length / (1024 * 1024)).toFixed(2)} MB`);
        }

        if (!rawMp3 || rawMp3.length === 0) {
          throw new Error('No se pudo obtener el archivo de audio');
        }

        // Inyectar metadatos ID3v2.3 completos estilo Apple Music (Disquera, Copyright, ISRC, Compositor, Pista, Género, Carátula 1000px HD, sin comentarios)
        const cleanYear = (year || releaseDate || '').match(/\b(19\d{2}|20\d{2})\b/)?.[0] || String(new Date().getFullYear());
        const tag = createId3Tag({
          title: title || safeFilename,
          artist: artist || 'Artista',
          albumArtist: albumArtist || artist || 'Artista',
          album: album || title || 'Álbum',
          composer: composer || null,
          publisher: publisher || null,
          copyright: copyright || (publisher ? `℗ ${cleanYear} ${publisher}` : `℗ ${cleanYear} ${artist}`),
          isrc: isrc || null,
          year: cleanYear,
          releaseDate: releaseDate || year,
          track: track,
          totalTracks: totalTracks,
          disk: disk || '1',
          genre: genre || 'Latino / Música',
          imageBuffer: coverBuf
        });

        const finalMp3 = Buffer.concat([tag, rawMp3]);

        res.writeHead(200, {
          'Content-Type': 'audio/mpeg',
          'Content-Disposition': `attachment; filename="${safeFilename}.mp3"; filename*=UTF-8''${encodedFilename}.mp3`,
          'Content-Length': finalMp3.length,
          'Cache-Control': 'no-cache'
        });

        res.end(finalMp3);
        console.log(`[Native MP3 Engine] ✅ Enviado exitosamente al cliente: "${safeFilename}.mp3" (${(finalMp3.length / (1024 * 1024)).toFixed(2)} MB)`);
        return;
      } catch (err) {
        console.error('[Native MP3 Engine] Error:', err.message);
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
    res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' });
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
