// Build trigger: 2026-10-23T22:30:00.0000000Z
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dns from 'dns';
import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import { Ytdl, Client, createPoTokenProvider } from '@distube/ytdl-core';
import { getUser, createUser, getPlaylist, addToPlaylist, removeFromPlaylist } from './db.mjs';

let ytdlInstance = new Ytdl({ clients: [Client.VisionOS, Client.WebEmbedded] });
try {
  console.log('🛡️ [YTDL] Inicializando motor de PO Token contra bloqueos de YouTube...');
  const poTokenProvider = await createPoTokenProvider();
  ytdlInstance = new Ytdl({ poTokenProvider });
  console.log('🛡️ [YTDL] ¡Motor de PO Token activado con éxito!');
} catch (poErr) {
  console.warn('⚠️ [YTDL] Motor PO Token no pudo iniciar, usando cliente VisionOS:', poErr.message);
}

const audioUrlCache = new Map();
const motionArtworkCache = new Map();

async function getFullSongMp3Url(videoId) {
  if (audioUrlCache.has(videoId)) {
    return audioUrlCache.get(videoId);
  }

  const startRes = await fetch(`https://p.savenow.to/ajax/download.php?format=mp3&url=https://www.youtube.com/watch?v=${videoId}`, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(12000)
  });
  const startData = await startRes.json();
  if (!startData.success || !startData.progress_url) {
    throw new Error('Servidor de audio ocupado');
  }

  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 800));
    const progRes = await fetch(startData.progress_url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(8000)
    });
    const progData = await progRes.json();
    if (progData.download_url && progData.download_url.includes('savenow.to') && !progData.download_url.includes('affadaffa')) {
      let finalUrl = progData.download_url;
      if (finalUrl.startsWith('http://')) finalUrl = finalUrl.replace('http://', 'https://');
      audioUrlCache.set(videoId, finalUrl);
      return finalUrl;
    }
  }
  throw new Error('Tiempo de espera agotado al preparar audio');
}

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

let cachedTopColombia = null;
let cachedTopColombiaTime = 0;

async function getTopColombia() {
  const now = Date.now();
  if (cachedTopColombia && cachedTopColombia.tracks && cachedTopColombia.tracks.length > 0 && (now - cachedTopColombiaTime < 1000 * 60 * 20)) {
    return cachedTopColombia;
  }

  try {
    const plData = await fetchDeezer('/playlist/1116188451');
    let tracks = (plData && plData.tracks && Array.isArray(plData.tracks.data))
      ? plData.tracks.data.slice(0, 10).map((t, idx) => ({
          rank: idx + 1,
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
        }))
      : [];

    let albums = [];
    const albQueries = ['Blessd Superstar', 'Feid', 'Karol G'];
    for (const q of albQueries) {
      const albRes = await fetchDeezer(`/search/album?q=${encodeURIComponent(q)}&limit=2`);
      if (albRes && Array.isArray(albRes.data)) {
        albRes.data.forEach(a => {
          if (!albums.some(existing => existing.deezerId === a.id)) {
            albums.push({
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
            });
          }
        });
      }
    }

    // Fallback Apple Music Oficial Colombia (100% libre de restricciones en cualquier nube)
    if (tracks.length === 0) {
      try {
        const itunesRes = await fetch('https://itunes.apple.com/co/rss/topsongs/limit=10/json', {
          headers: { 'User-Agent': USER_AGENT },
          signal: AbortSignal.timeout(6000)
        });
        const itunesData = await itunesRes.json();
        const entries = itunesData.feed?.entry || [];
        tracks = entries.map((e, idx) => {
          const previewObj = Array.isArray(e.link) ? e.link.find(l => l.attributes && l.attributes['im:assetType'] === 'preview') : null;
          const imgObj = (e['im:image'] && e['im:image'].length) ? e['im:image'][e['im:image'].length - 1] : null;
          const rawImg = imgObj ? imgObj.label : '';
          const coverXl = rawImg ? rawImg.replace(/\/\d+x\d+bb\./, '/1000x1000bb.') : '';
          const trackId = e.id?.attributes?.['im:id'] || `itunes_${idx}`;

          return {
            rank: idx + 1,
            id: `itunes_${trackId}`,
            deezerId: null,
            title: e['im:name']?.label || 'Canción',
            artist: e['im:artist']?.label || 'Artista',
            album: e['im:collection']?.['im:name']?.label || 'Álbum',
            albumId: null,
            deezerAlbumId: null,
            coverXl: coverXl,
            duration: 30,
            preview: previewObj ? previewObj.attributes?.href : null,
            link: e.id?.label || '',
            lucidaUrl: `https://lucida.to/?url=${encodeURIComponent(e.id?.label || '')}`,
            source: 'itunes'
          };
        });
      } catch (itunesErr) {
        console.warn('Fallback iTunes Top Songs falló:', itunesErr.message);
      }
    }

    if (albums.length === 0) {
      try {
        const itunesAlbRes = await fetch('https://itunes.apple.com/co/rss/topalbums/limit=6/json', {
          headers: { 'User-Agent': USER_AGENT },
          signal: AbortSignal.timeout(6000)
        });
        const itunesAlbData = await itunesAlbRes.json();
        const albEntries = itunesAlbData.feed?.entry || [];
        albums = albEntries.map(a => {
          const imgObj = (a['im:image'] && a['im:image'].length) ? a['im:image'][a['im:image'].length - 1] : null;
          const rawImg = imgObj ? imgObj.label : '';
          const coverXl = rawImg ? rawImg.replace(/\/\d+x\d+bb\./, '/1000x1000bb.') : '';
          const albId = a.id?.attributes?.['im:id'] || 'itunes_alb';
          return {
            id: `itunes_${albId}`,
            title: a['im:name']?.label || 'Álbum',
            artist: a['im:artist']?.label || 'Artista',
            coverXl: coverXl,
            nbTracks: a['im:itemCount']?.label || '—',
            releaseDate: 'Oficial',
            link: a.link?.attributes?.href || '',
            source: 'itunes'
          };
        });
      } catch (itunesAlbErr) {
        console.warn('Fallback iTunes Top Albums falló:', itunesAlbErr.message);
      }
    }

    if (tracks.length > 0) {
      cachedTopColombia = { tracks, albums };
      cachedTopColombiaTime = now;
    }
    return { tracks, albums };
  } catch (err) {
    console.error('Error al obtener Top Colombia:', err);
    if (cachedTopColombia) return cachedTopColombia;
    return { tracks: [], albums: [] };
  }
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

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
      return res.end(JSON.stringify({ version: '6.9', status: 'online', engine: 'Vice Music 3D Coverflow + PO Token Native MP3 320 Engine' }));
    }

    // 0.05 OBTENER CARÁTULA EN MOVIMIENTO OFICIAL DE APPLE MUSIC (HLS VIDEO / M3U8)
    if (pathname === '/api/motion-artwork') {
      const artist = (reqUrl.searchParams.get('artist') || '').trim();
      const title = (reqUrl.searchParams.get('title') || '').trim();
      const album = (reqUrl.searchParams.get('album') || '').trim();

      if (!artist && !title && !album) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'Faltan parámetros' }));
      }

      const cacheKey = `${artist}::${album || title}`.toLowerCase();
      if (motionArtworkCache.has(cacheKey)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(motionArtworkCache.get(cacheKey)));
      }

      try {
        const queryTerm = encodeURIComponent(`${artist} ${album || title}`);
        const itunesRes = await fetch(`https://itunes.apple.com/search?media=music&entity=album&limit=3&term=${queryTerm}`, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });
        const itunesData = await itunesRes.json();

        let videoUrl = null;
        if (itunesData && Array.isArray(itunesData.results)) {
          const normArtist = artist.toLowerCase().trim();
          const normTitle = (album || title).toLowerCase().trim();

          for (const item of itunesData.results) {
            if (!item.collectionViewUrl) continue;

            const itemArtist = (item.artistName || '').toLowerCase().trim();
            const itemAlbum = (item.collectionName || '').toLowerCase().trim();

            // Verificación estricta: Artista o Álbum deben coincidir para no asignar carátulas erróneas
            const artistMatches = itemArtist.includes(normArtist) || normArtist.includes(itemArtist);
            const albumMatches = itemAlbum.includes(normTitle) || normTitle.includes(itemAlbum);

            if (!artistMatches && !albumMatches) {
              continue;
            }

            try {
              const htmlRes = await fetch(item.collectionViewUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
                signal: AbortSignal.timeout(3500)
              });
              const html = await htmlRes.text();
              const matches = html.match(/https:\/\/mvod\.itunes\.apple\.com\/itunes-assets\/[^\s\"']+\.m3u8/gi);
              if (matches && matches.length > 0) {
                videoUrl = matches[0];
                break;
              }
            } catch (pageErr) {
              // siguiente álbum
            }
          }
        }

        const result = {
          success: true,
          hasMotion: !!videoUrl,
          videoUrl: videoUrl || null
        };

        motionArtworkCache.set(cacheKey, result);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(result));
      } catch (err) {
        console.warn('Error en motion-artwork:', err.message);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, hasMotion: false, error: err.message }));
      }
    }

    // 0.0 AUTENTICACIÓN VIP / REGISTRO / LOGIN CON BASE DE DATOS
    if (pathname === '/api/register' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body || '{}');
          const username = (parsed.username || '').trim();
          const password = (parsed.password || '').trim();
          if (!username || !password) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, error: 'Ingresa un usuario y contraseña válidos.' }));
          }
          const user = createUser(username, password, 'VIP Member');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            success: true,
            user: user.username,
            role: user.role,
            token: `vice_token_${Date.now()}`
          }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: e.message }));
        }
      });
      return;
    }

    if (pathname === '/api/login' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body || '{}');
          const username = (parsed.username || '').trim();
          const password = (parsed.password || '').trim();

          const user = getUser(username);
          if (user && user.password === password) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({
              success: true,
              user: user.username,
              role: user.role || 'VIP Member',
              token: `vice_token_${Date.now()}`
            }));
          } else {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({
              success: false,
              error: 'Usuario o contraseña incorrectos. Verifica tus credenciales o regístrate.'
            }));
          }
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'Petición inválida.' }));
        }
      });
      return;
    }

    // 0.02 PLAYLIST PERSISTENTE POR CADA USUARIO REGISTRADO
    if (pathname === '/api/playlist') {
      if (req.method === 'GET') {
        const user = (reqUrl.searchParams.get('user') || '').trim();
        const tracks = getPlaylist(user);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, tracks }));
      }

      if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          try {
            const parsed = JSON.parse(body || '{}');
            const user = (parsed.user || '').trim();
            const track = parsed.track;
            if (!user) throw new Error('Usuario requerido');
            if (!track) throw new Error('Canción requerida');
            const tracks = addToPlaylist(user, track);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: true, tracks, message: 'Canción guardada en tu playlist' }));
          } catch (e) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, error: e.message }));
          }
        });
        return;
      }

      if (req.method === 'DELETE') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          try {
            const parsed = JSON.parse(body || '{}');
            const user = (parsed.user || '').trim();
            const title = (parsed.title || '').trim();
            const artist = (parsed.artist || '').trim();
            const tracks = removeFromPlaylist(user, title, artist);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: true, tracks, message: 'Canción eliminada de tu playlist' }));
          } catch (e) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, error: e.message }));
          }
        });
        return;
      }
    }

    // 0.05 TOP 10 COLOMBIA EN VIVO
    if (pathname === '/api/top-colombia') {
      const topData = await getTopColombia();
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      });
      return res.end(JSON.stringify({
        success: true,
        count: topData.tracks.length,
        tracks: topData.tracks,
        albums: topData.albums
      }));
    }

    // 0.1 STREAM DIRECTO MP3 PARA REPRODUCTOR NATIVO (100% Cero YouTube)
    if (pathname === '/api/fullaudio-stream') {
      const q = (reqUrl.searchParams.get('q') || '').trim();
      let videoId = (reqUrl.searchParams.get('videoId') || '').trim();

      try {
        if (!videoId && q) {
          const ytRes = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(q + ' audio')}`, {
            headers: { 'User-Agent': USER_AGENT },
            signal: AbortSignal.timeout(8000)
          });
          const html = await ytRes.text();
          const match = html.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
          if (match) videoId = match[1];
        }

        if (!videoId) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Audio no encontrado' }));
        }

        const mp3Url = await getFullSongMp3Url(videoId);
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        });
        return res.end(JSON.stringify({
          success: true,
          videoId,
          audioUrl: mp3Url
        }));
      } catch (err) {
        console.error('[FullAudio Stream] Error:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: err.message }));
      }
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

    // 4. AUDIO COMPLETO VÍA YOUTUBE (Filtro Estricto Anti-Canales Piratas / FusaUrbano)
    if (pathname === '/api/fullaudio') {
      const q = (reqUrl.searchParams.get('q') || '').trim();
      if (!q) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Parámetro vacío' }));
      }

      try {
        const cleanQuery = q.replace(/\s*[\(\[].*?[\)\]]/gi, '').trim();
        const queriesToTry = [
          `${cleanQuery} audio oficial`,
          `${cleanQuery} topic`,
          `${q} audio`,
          `${cleanQuery} audio`,
          q,
          `${cleanQuery} official`,
          cleanQuery
        ];

        let videoId = null;
        let videoTitle = null;

        const BAD_CHANNELS = [
          'latinhype', 'cantoyo', 'karaoke', 'clean hits', 'reaction', 'tutorial',
          'videos oficiales fm', 'flowkalle', 'gustavo paternina', 'ted sky', 'lover of music'
        ];

        function parseDurationSec(durStr) {
          if (!durStr) return 0;
          const parts = durStr.trim().split(':').map(Number);
          if (parts.some(isNaN)) return 0;
          if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
          if (parts.length === 2) return parts[0] * 60 + parts[1];
          return parts[0] || 0;
        }

        for (const queryTerm of queriesToTry) {
          if (videoId) break;

          try {
            const ytRes = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(queryTerm)}`, {
              headers: {
                'User-Agent': USER_AGENT,
                'Accept-Language': 'es-419,es;q=0.9,en;q=0.8'
              },
              signal: AbortSignal.timeout(6000)
            });
            const html = await ytRes.text();

            const startIdx = html.indexOf('var ytInitialData = ');
            if (startIdx !== -1) {
              const endIdx = html.indexOf(';</script>', startIdx);
              const jsonStr = html.substring(startIdx + 20, endIdx);
              const data = JSON.parse(jsonStr);
              const sections = data.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];

              const candidates = [];
              for (const s of sections) {
                const items = s.itemSectionRenderer?.contents || [];
                for (const it of items) {
                  const v = it.videoRenderer;
                  if (v && v.videoId && v.videoId.length === 11) {
                    const title = v.title?.runs?.[0]?.text || '';
                    const channel = v.ownerText?.runs?.[0]?.text || '';
                    const badges = v.ownerBadges?.map(b => b.metadataBadgeRenderer?.style) || [];
                    const isVerified = badges.some(b => b && b.includes('VERIFIED'));
                    const isTopic = channel.includes('Topic');
                    const durStr = v.lengthText?.simpleText || v.thumbnailOverlays?.[0]?.thumbnailOverlayTimeStatusRenderer?.text?.simpleText || '';
                    const durSec = parseDurationSec(durStr);
                    candidates.push({ id: v.videoId, title, channel, isVerified, isTopic, durStr, durSec });
                  }
                }
              }

              if (candidates.length > 0) {
                const queryWords = cleanQuery.toLowerCase()
                  .replace(/[^\w\sáéíóúüñ]/gi, ' ')
                  .split(/\s+/)
                  .filter(w => w.length >= 2);

                function scoreCandidate(c) {
                  const cTitle = (c.title || '').toLowerCase();
                  const cChannel = (c.channel || '').toLowerCase();
                  let score = 0;

                  let matchedTitleWords = 0;
                  let matchedChannelWords = 0;
                  for (const w of queryWords) {
                    if (cTitle.includes(w)) {
                      score += 25;
                      matchedTitleWords++;
                    }
                    if (cChannel.includes(w)) {
                      score += 15;
                      matchedChannelWords++;
                    }
                  }

                  // Si el canal coincide con varias palabras del query (nombre de artista oficial)
                  if (matchedChannelWords >= 2) {
                    score += 55;
                  }

                  // Si ninguna palabra clave del query está en el título
                  if (queryWords.length >= 2 && matchedTitleWords === 0) {
                    score -= 80;
                  }

                  // Priorizar canales oficiales "Topic" y versiones de audio oficial (sin intros habladas, sincronía perfecta con letras)
                  if (c.isTopic) score += 50;
                  if (cTitle.includes('audio oficial') || cTitle.includes('official audio') || cTitle.includes('pista')) score += 35;
                  if (c.isVerified) score += 25;
                  if (cTitle.includes('lyric video') || cTitle.includes('video lyric') || cTitle.includes('audio')) score += 20;
                  if (cTitle.includes('video oficial') || cTitle.includes('official video') || cTitle.includes('music video')) score += 15;

                  // Penalizar remixes no oficiales, parodias, karaoke, slowed, loops de 1 hora
                  if (cTitle.includes('karaoke') || cTitle.includes('parodia') || cTitle.includes('reacción') || cTitle.includes('lofi') || cTitle.includes('lo-fi') || cTitle.includes('slowed') || cTitle.includes('1 hour') || cTitle.includes('1 hora') || cTitle.includes('loop')) score -= 100;

                  // Penalizar duraciones sospechosas (cortes < 120s o loops/mixes > 600s)
                  if (c.durSec > 0 && c.durSec < 120) score -= 90;
                  if (c.durSec > 600) score -= 100;

                  if (BAD_CHANNELS.some(b => cChannel.includes(b))) score -= 80;

                  return score;
                }

                candidates.sort((a, b) => scoreCandidate(b) - scoreCandidate(a));
                const best = candidates[0];
                if (best && scoreCandidate(best) > -40) {
                  videoId = best.id;
                  videoTitle = best.title;
                  console.log(`[FullAudio] Video oficial filtrado seleccionado: [${videoId}] "${videoTitle}" (Canal: ${best.channel}, Duración: ${best.durStr})`);
                  break;
                }
              }
            }

            // Fallback si ytInitialData no arrojó candidatos pero hay coincidencia directa de videoId
            if (!videoId) {
              const match = html.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
              if (match) {
                videoId = match[1];
                videoTitle = queryTerm;
                break;
              }
            }
          } catch (tryErr) {
            // Siguiente término de búsqueda
          }
        }

        if (videoId) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            videoId,
            videoTitle
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
  if (mp3Buffer && mp3Buffer.length > 10 && mp3Buffer.toString('ascii', 0, 3) === 'ID3') {
    const size = ((mp3Buffer[6] & 0x7f) << 21) | ((mp3Buffer[7] & 0x7f) << 14) | ((mp3Buffer[8] & 0x7f) << 7) | (mp3Buffer[9] & 0x7f);
    const totalHeader = size + 10;
    if (totalHeader > 0 && totalHeader < mp3Buffer.length) {
      return mp3Buffer.subarray(totalHeader);
    }
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
            const match = html.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
            if (match && match[1]) {
              targetVideoId = match[1];
            } else {
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

        // ESTRATEGIA 1: Extracción nativa directa con YTDL PO Token + FFmpeg
        try {
          console.log(`[Native MP3 Engine] Extracción directa con PO Token para ${targetVideoId}...`);
          let stream;
          try {
            stream = await ytdlInstance.download(targetVideoId, {
              filter: { hasAudio: true, hasVideo: false },
              quality: 'highestaudio'
            });
          } catch (e1) {
            console.warn(`[Native MP3 Engine] highestaudio falló (${e1.message}), probando stream general...`);
            stream = await ytdlInstance.download(targetVideoId, {
              filter: { hasAudio: true }
            });
          }

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

          if (!rawMp3 || rawMp3.length < 50000) {
            throw new Error(`Extracción insuficiente: ${rawMp3 ? rawMp3.length : 0} bytes`);
          }

          console.log(`[Native MP3 Engine] Extracción local exitosa: ${(rawMp3.length / (1024 * 1024)).toFixed(2)} MB`);
        } catch (localErr) {
          console.warn(`[Native MP3 Engine] Extracción local no disponible (${localErr.message}). Activando ESTRATEGIA 2 en la nube anti-bot...`);

          // ESTRATEGIA 2: Motor en la nube con proxies rotativos (para Render y servidores cloud)
          try {
            const startRes = await fetch(`https://p.savenow.to/ajax/download.php?format=mp3&audio_quality=320&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${targetVideoId}`)}`, {
              headers: { 'User-Agent': USER_AGENT },
              signal: AbortSignal.timeout(12000)
            });
            const startData = await startRes.json();

            if (!startData.success || !startData.progress_url) {
              throw new Error('Servidor de conversión en la nube no devolvió progress_url');
            }

            let downloadUrl = null;
            for (let i = 0; i < 22; i++) {
              await new Promise(r => setTimeout(r, 1000));
              const pr = await fetch(startData.progress_url, {
                headers: { 'User-Agent': USER_AGENT },
                signal: AbortSignal.timeout(8000)
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

            console.log(`[Native MP3 Engine] Descargando audio convertido desde CDN (${downloadUrl}) para inyectar metadatos Apple Music...`);
            const cdnAudioRes = await fetch(downloadUrl, {
              headers: { 'User-Agent': USER_AGENT },
              signal: AbortSignal.timeout(35000)
            });
            if (!cdnAudioRes.ok) {
              throw new Error(`Fallo al descargar archivo desde CDN: ${cdnAudioRes.status}`);
            }
            rawMp3 = Buffer.from(await cdnAudioRes.arrayBuffer());
            console.log(`[Native MP3 Engine] Audio CDN obtenido con éxito: ${(rawMp3.length / (1024 * 1024)).toFixed(2)} MB`);
          } catch (cloudErr) {
            console.error(`[Native MP3 Engine] Error en ambas estrategias:`, cloudErr.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'Error al generar MP3: ' + cloudErr.message }));
          }
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
