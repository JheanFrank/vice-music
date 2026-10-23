// ========================================================
// VICE MUSIC // GTA VI EDITION (FULL ALBUMS & FLAC)
// ========================================================

const state = {
  currentMode: 'albums', // 'albums' | 'tracks'
  currentTrack: null,
  currentAlbum: null,
  isPlaying: false,
  playbackSource: 'preview', // 'preview' | 'full'
  currentSpeed: 1, // 1 | 1.25 | 1.5 | 2
  audio: document.getElementById('audioElement'),
  results: []
};

// DOM Elements
const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const resultsGrid = document.getElementById('resultsGrid');
const resultsTitle = document.getElementById('resultsTitle');
const resultsCount = document.getElementById('resultsCount');
const loader = document.getElementById('loader');
const toastNotification = document.getElementById('toastNotification');
const toastText = document.getElementById('toastText');

// Tabs
const tabAlbums = document.getElementById('tabAlbums');
const tabTracks = document.getElementById('tabTracks');
const searchHeaderTitle = document.getElementById('searchHeaderTitle');
const searchHeaderSub = document.getElementById('searchHeaderSub');

// Album Detail Section
const albumDetailView = document.getElementById('albumDetailView');
const albumHeroContent = document.getElementById('albumHeroContent');
const albumTracklist = document.getElementById('albumTracklist');
const btnBackToAlbums = document.getElementById('btnBackToAlbums');
const catalogSection = document.getElementById('catalogSection');

// Player DOM
const playerCover = document.getElementById('playerCover');
const playerTitle = document.getElementById('playerTitle');
const playerArtist = document.getElementById('playerArtist');
const playerDuration = document.getElementById('playerDuration');
const playerModeBadge = document.getElementById('playerModeBadge');
const btnPlayPause = document.getElementById('btnPlayPause');
const iconPlay = document.getElementById('iconPlay');
const iconPause = document.getElementById('iconPause');
const btnBackward = document.getElementById('btnBackward');
const btnForward = document.getElementById('btnForward');
const btnSpeed = document.getElementById('btnSpeed');
const speedLabel = document.getElementById('speedLabel');
const progressTrack = document.getElementById('progressTrack');
const progressFill = document.getElementById('progressFill');
const progressThumb = document.getElementById('progressThumb');
const currentTimeLabel = document.getElementById('currentTime');
const totalTimeLabel = document.getElementById('totalTime');
const waveIndicator = document.getElementById('waveIndicator');
const visualizerCanvas = document.getElementById('visualizerCanvas');
const btnPlayFullSong = document.getElementById('btnPlayFullSong');

const vCtx = visualizerCanvas ? visualizerCanvas.getContext('2d') : null;

// ========================================================
// MOTOR CLIENT-SIDE DEEZER JSONP (SIN RESTRICCIÓN DE NUBE)
// ========================================================
function fetchDeezerJsonp(endpoint) {
  return new Promise((resolve) => {
    const callbackName = 'dz_cb_' + Math.random().toString(36).substring(2, 9);
    const script = document.createElement('script');
    const separator = endpoint.includes('?') ? '&' : '?';
    script.src = `https://api.deezer.com${endpoint}${separator}output=jsonp&callback=${callbackName}`;
    
    const timeout = setTimeout(() => {
      cleanup();
      resolve(null);
    }, 4500);

    function cleanup() {
      clearTimeout(timeout);
      delete window[callbackName];
      if (script.parentNode) script.parentNode.removeChild(script);
    }

    window[callbackName] = function(data) {
      cleanup();
      resolve(data);
    };

    script.onerror = function() {
      cleanup();
      resolve(null);
    };

    document.head.appendChild(script);
  });
}

// ========================================================
// MOTOR YOUTUBE IFRAME (AUDIO COMPLETO EN SEGUNDO PLANO)
// ========================================================
let ytPlayer = null;
let ytReady = false;
let ytProgressInterval = null;
let ytPendingVideoId = null;

function initYtPlayer() {
  if (ytPlayer && typeof ytPlayer.loadVideoById === 'function') return;
  const slot = document.getElementById('ytPlayerSlot');
  if (!slot) return;
  if (window.YT && typeof window.YT.Player === 'function') {
    ytPlayer = new YT.Player('ytPlayerSlot', {
      height: '100%',
      width: '100%',
      playerVars: {
        autoplay: 1,
        controls: 0,
        disablekb: 1,
        fs: 0,
        modestbranding: 1,
        rel: 0,
        playsinline: 1
      },
      events: {
        onReady: (event) => {
          ytReady = true;
          console.log('[YouTube Player] Listo');
          if (ytPendingVideoId) {
            try {
              event.target.loadVideoById(ytPendingVideoId);
              event.target.playVideo();
              setPlayingState(true);
              startYtProgress();
            } catch (err) {
              console.warn('[YouTube onReady] Error iniciando video pendiente:', err);
            }
            ytPendingVideoId = null;
          }
        },
        onStateChange: onYtStateChange,
        onError: (err) => {
          console.warn('[YouTube Error]', err.data);
          showToast('⚠️ Reproducción de stream en progreso...');
        }
      }
    });
  }
}

window.onYouTubeIframeAPIReady = initYtPlayer;
if (window.YT && window.YT.Player) {
  initYtPlayer();
}

function onYtStateChange(event) {
  if (state.playbackSource !== 'full') return;

  if (event.data === 1) { // PLAYING
    setPlayingState(true);
    startYtProgress();
  } else if (event.data === 2) { // PAUSED
    setPlayingState(false);
    stopYtProgress();
  } else if (event.data === 0) { // ENDED
    setPlayingState(false);
    stopYtProgress();
    currentTimeLabel.innerText = '00:00';
    progressFill.style.width = '0%';
    progressThumb.style.left = '0%';
  }
}

function startYtProgress() {
  stopYtProgress();
  ytProgressInterval = setInterval(() => {
    if (!ytPlayer || typeof ytPlayer.getCurrentTime !== 'function') return;
    const cur = ytPlayer.getCurrentTime() || 0;
    const dur = ytPlayer.getDuration() || 0;

    currentTimeLabel.innerText = formatTime(cur);
    totalTimeLabel.innerText = dur > 0 ? formatTime(dur) : '00:00';
    if (dur > 0) {
      const pct = (cur / dur) * 100;
      progressFill.style.width = `${pct}%`;
      progressThumb.style.left = `${pct}%`;
    }
  }, 250);
}

function stopYtProgress() {
  if (ytProgressInterval) {
    clearInterval(ytProgressInterval);
    ytProgressInterval = null;
  }
}

// ========================================================
// INICIALIZACIÓN
// ========================================================
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  startVisualizer();
  
  // Búsqueda inicial por defecto
  performSearch('Blessd Superstar');
});

function setupEventListeners() {
  tabAlbums.addEventListener('click', () => switchViewMode('albums'));
  tabTracks.addEventListener('click', () => switchViewMode('tracks'));

  searchBtn.addEventListener('click', () => performSearch(searchInput.value));
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') performSearch(searchInput.value);
  });

  searchInput.addEventListener('paste', () => {
    setTimeout(() => performSearch(searchInput.value), 100);
  });

  // Chips sugeridos
  document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const q = chip.getAttribute('data-query');
      searchInput.value = q;
      performSearch(q);
    });
  });

  // Botón Volver de la vista de Álbum
  btnBackToAlbums.addEventListener('click', () => {
    albumDetailView.classList.add('hidden');
    catalogSection.classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // Botón Escuchar Canción Completa en la barra fija
  if (btnPlayFullSong) {
    btnPlayFullSong.addEventListener('click', () => {
      if (state.currentTrack) {
        playFullSong(state.currentTrack.artist, state.currentTrack.title, state.currentTrack.cover);
      } else {
        showToast('Selecciona primero una canción para escucharla completa.');
      }
    });
  }

  // Botón Descargar MP3 320 en la barra fija
  const btnPlayerDlMp3 = document.getElementById('btnPlayerDlMp3');
  if (btnPlayerDlMp3) {
    btnPlayerDlMp3.addEventListener('click', () => {
      if (state.currentTrack) {
        downloadMp3_320(state.currentTrack.artist, state.currentTrack.title, state.currentTrack.audioUrl);
      } else {
        showToast('Selecciona primero una canción para descargar en MP3 320.');
      }
    });
  }

  // Botones movil en btn-group (📥 y 🎧)
  const btnPlayerDlMp3Mobile = document.getElementById('btnPlayerDlMp3Mobile');
  if (btnPlayerDlMp3Mobile) {
    btnPlayerDlMp3Mobile.addEventListener('click', () => {
      if (state.currentTrack) {
        downloadMp3_320(state.currentTrack.artist, state.currentTrack.title, state.currentTrack.audioUrl);
      } else {
        showToast('Selecciona primero una cancion para descargar en MP3.');
      }
    });
  }
  const btnPlayFullSongMobile = document.getElementById('btnPlayFullSongMobile');
  if (btnPlayFullSongMobile) {
    btnPlayFullSongMobile.addEventListener('click', () => {
      if (state.currentTrack) {
        playFullSong(state.currentTrack.artist, state.currentTrack.title, state.currentTrack.cover);
      } else {
        showToast('Selecciona primero una cancion para escucharla completa.');
      }
    });
  }

  // Botón de Velocidad (1x -> 1.25x -> 1.5x -> 2x)
  if (btnSpeed) {
    btnSpeed.addEventListener('click', cyclePlaybackSpeed);
  }

  // Reproductor Controles Fijos
  btnPlayPause.addEventListener('click', togglePlayPause);
  
  btnBackward.addEventListener('click', () => {
    seekDelta(-5);
  });

  btnForward.addEventListener('click', () => {
    seekDelta(5);
  });

  progressTrack.addEventListener('click', (e) => {
    const rect = progressTrack.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));

    if (state.playbackSource === 'full' && ytPlayer && typeof ytPlayer.getDuration === 'function') {
      const dur = ytPlayer.getDuration();
      if (dur > 0) {
        ytPlayer.seekTo(pos * dur, true);
      }
    } else if (state.audio.duration) {
      state.audio.currentTime = pos * state.audio.duration;
    }
  });

  state.audio.addEventListener('timeupdate', () => {
    if (state.playbackSource === 'preview') {
      updateProgress();
    }
  });
  state.audio.addEventListener('ended', () => {
    if (state.playbackSource === 'preview') setPlayingState(false);
  });
  state.audio.addEventListener('play', () => {
    if (state.playbackSource === 'preview') setPlayingState(true);
  });
  state.audio.addEventListener('pause', () => {
    if (state.playbackSource === 'preview') setPlayingState(false);
  });
}

function switchViewMode(mode) {
  state.currentMode = mode;
  albumDetailView.classList.add('hidden');
  catalogSection.classList.remove('hidden');

  if (mode === 'albums') {
    tabAlbums.classList.add('active');
    tabTracks.classList.remove('active');
    searchHeaderTitle.innerText = 'BUSCA CUALQUIER ÁLBUM O CANCIÓN';
    searchHeaderSub.innerHTML = 'Escribe un artista o canción (ej: <strong>Blessd Superstar</strong>, <strong>Karol G</strong>) para ver álbumes completos.';
    searchInput.placeholder = 'Busca un artista o canción (ej: Blessd Superstar, Karol G, Feid)...';
    resultsTitle.innerText = 'ÁLBUMES DISPONIBLES';
  } else {
    tabTracks.classList.add('active');
    tabAlbums.classList.remove('active');
    searchHeaderTitle.innerText = 'BUSCA PISTAS O PEGA ENLACES';
    searchHeaderSub.innerHTML = 'Encuentra canciones sueltas y salta a su <strong>álbum completo</strong> con un solo clic.';
    searchInput.placeholder = 'Busca canción (ej: Superstar, BbY WOW, Mírame)...';
    resultsTitle.innerText = 'PISTAS IDENTIFICADAS';
  }

  const query = searchInput.value.trim() || 'Blessd Superstar';
  performSearch(query);
}

// Búsqueda Híbrida (Backend Render + Cliente Deezer JSONP Directo)
async function performSearch(query) {
  if (!query || !query.trim()) return;

  albumDetailView.classList.add('hidden');
  catalogSection.classList.remove('hidden');

  loader.classList.remove('hidden');
  resultsGrid.innerHTML = '';
  resultsCount.innerText = 'LOCALIZANDO...';

  try {
    if (state.currentMode === 'albums') {
      // 1. Backend Search (iTunes + Server Deezer)
      const backendPromise = fetch(`/api/albums/search?q=${encodeURIComponent(query.trim())}`)
        .then(r => r.json())
        .catch(() => ({ albums: [] }));

      // 2. Client-side JSONP Deezer (Directo desde el navegador del usuario, inmune a bloqueos de nube)
      const clientDeezerAlbumPromise = fetchDeezerJsonp(`/search/album?q=${encodeURIComponent(query.trim())}&limit=15`);
      const clientDeezerTrackPromise = fetchDeezerJsonp(`/search?q=${encodeURIComponent(query.trim())}&limit=20`);

      const [backendData, dzAlbumData, dzTrackData] = await Promise.all([
        backendPromise,
        clientDeezerAlbumPromise,
        clientDeezerTrackPromise
      ]);

      const seen = new Set();
      const combined = [];

      function addAlbum(a) {
        if (!a || !a.title || !a.artist) return;
        const norm = `${a.title.toLowerCase().trim()}_${a.artist.toLowerCase().trim()}`;
        if (seen.has(norm)) return;
        seen.add(norm);
        combined.push(a);
      }

      // Procesar canciones de Deezer para sacar su álbum (ej: Blessd Superstar -> Álbum SUPERSTAR)
      if (dzTrackData && Array.isArray(dzTrackData.data)) {
        dzTrackData.data.forEach(t => {
          if (t.album && t.album.id) {
            addAlbum({
              id: `deezer_${t.album.id}`,
              deezerId: t.album.id,
              title: t.album.title,
              artist: t.artist ? t.artist.name : 'Artista',
              coverXl: t.album.cover_xl || t.album.cover_big || t.album.cover_medium,
              nbTracks: '—',
              matchedTrack: t.title,
              link: `https://www.deezer.com/album/${t.album.id}`,
              lucidaUrl: `https://lucida.to/?url=${encodeURIComponent(`https://www.deezer.com/album/${t.album.id}`)}`,
              source: 'deezer'
            });
          }
        });
      }

      // Procesar álbumes directos de Deezer
      if (dzAlbumData && Array.isArray(dzAlbumData.data)) {
        dzAlbumData.data.forEach(a => {
          addAlbum({
            id: `deezer_${a.id}`,
            deezerId: a.id,
            title: a.title,
            artist: a.artist ? a.artist.name : 'Artista',
            coverXl: a.cover_xl || a.cover_big || a.cover_medium,
            nbTracks: a.nb_tracks || '—',
            link: a.link || `https://www.deezer.com/album/${a.id}`,
            lucidaUrl: `https://lucida.to/?url=${encodeURIComponent(a.link || `https://www.deezer.com/album/${a.id}`)}`,
            source: 'deezer'
          });
        });
      }

      // Procesar álbumes del Backend (iTunes + Server)
      (backendData.albums || []).forEach(a => addAlbum(a));

      state.results = combined;
      renderAlbums(state.results);

    } else {
      // Modo Pistas
      const backendPromise = fetch(`/api/resolve?q=${encodeURIComponent(query.trim())}`)
        .then(r => r.json())
        .catch(() => ({ data: [] }));

      const clientDeezerTrackPromise = fetchDeezerJsonp(`/search?q=${encodeURIComponent(query.trim())}&limit=30`);

      const [backendData, dzTrackData] = await Promise.all([
        backendPromise,
        clientDeezerTrackPromise
      ]);

      const seen = new Set();
      const combinedTracks = [];

      function addTrack(t) {
        if (!t || !t.title || !t.artist) return;
        const norm = `${t.title.toLowerCase().trim()}_${t.artist.toLowerCase().trim()}`;
        if (seen.has(norm)) return;
        seen.add(norm);
        combinedTracks.push(t);
      }

      // Pistas de Deezer JSONP
      if (dzTrackData && Array.isArray(dzTrackData.data)) {
        dzTrackData.data.forEach(t => {
          addTrack({
            id: `deezer_${t.id}`,
            title: t.title,
            artist: t.artist ? t.artist.name : 'Artista',
            album: t.album ? t.album.title : 'Álbum',
            albumId: t.album ? `deezer_${t.album.id}` : null,
            coverXl: t.album ? (t.album.cover_xl || t.album.cover_big) : (t.artist ? t.artist.picture_xl : ''),
            duration: t.duration || 0,
            preview: t.preview || null,
            link: t.link || `https://www.deezer.com/track/${t.id}`,
            lucidaUrl: `https://lucida.to/?url=${encodeURIComponent(t.link || `https://www.deezer.com/track/${t.id}`)}`,
            source: 'deezer'
          });
        });
      }

      // Pistas del Backend (iTunes)
      (backendData.data || []).forEach(t => addTrack(t));

      state.results = combinedTracks;
      renderTracks(state.results);
    }
  } catch (error) {
    console.error('Error al buscar:', error);
    resultsGrid.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 3rem; color: #ff2a85;">
        <h3>Error al consultar satélites</h3>
        <p style="font-family: var(--font-mono); font-size: 0.85rem; margin-top: 0.5rem;">${error.message}</p>
      </div>
    `;
  } finally {
    loader.classList.add('hidden');
  }
}

// Renderizar Álbumes
function renderAlbums(albums) {
  resultsCount.innerText = `${albums.length} ÁLBUMES DETECTADOS`;

  if (albums.length === 0) {
    resultsGrid.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 4rem 1rem;">
        <h3 style="font-family: var(--font-logo); color: var(--vice-pink);">No se encontraron álbumes</h3>
        <p style="color: var(--text-dim); margin-top: 0.5rem;">Prueba buscando el nombre directo del artista o canción (ej: Blessd Superstar, Karol G, Feid).</p>
      </div>
    `;
    return;
  }

  albums.forEach(album => {
    const card = document.createElement('div');
    card.className = 'album-card';

    const matchedPill = album.matchedTrack 
      ? `<span class="badge-tag-hd" style="top: 8px; left: 8px; border-color: var(--vice-cyan); color: var(--vice-cyan); font-size: 0.62rem; padding: 0.2rem 0.5rem;">🎯 CONTIENE: "${album.matchedTrack}"</span>` 
      : '';

    card.innerHTML = `
      <div class="album-cover-wrapper">
        <img class="album-cover" src="${album.coverXl}" alt="${album.title}" loading="lazy" onerror="this.src='https://via.placeholder.com/400/1a0933/ff2a85?text=VICE'">
        ${matchedPill}
        <span class="album-badge-tracks">${album.nbTracks} CANCIONES</span>
      </div>
      <div class="album-info">
        <h3 class="album-title" title="${album.title}">${album.title}</h3>
        <p class="album-artist" title="${album.artist}">${album.artist}</p>
        <div class="btn-open-album">VER ÁLBUM COMPLETO ➔</div>
      </div>
    `;

    card.addEventListener('click', () => openAlbumDetail(album.id));
    resultsGrid.appendChild(card);
  });
}

// Abrir Vista Detallada del Álbum con TODAS sus canciones y DESCARGA COMPLETA
async function openAlbumDetail(albumId) {
  catalogSection.classList.add('hidden');
  albumDetailView.classList.remove('hidden');
  window.scrollTo({ top: 120, behavior: 'smooth' });

  albumHeroContent.innerHTML = `
    <div style="text-align: center; width: 100%; padding: 3rem 0;">
      <div class="vice-spinner"><div class="inner-vi">VI</div></div>
      <p style="font-family: var(--font-mono); color: var(--vice-pink); margin-top: 1rem;">CARGANDO DISCOGRAFÍA Y TODAS LAS CANCIONES...</p>
    </div>
  `;
  albumTracklist.innerHTML = '';

  try {
    let album = null;

    // Si es de Deezer, obtener directo por JSONP (más rápido y sin bloqueos)
    if (albumId.startsWith('deezer_')) {
      const deezerId = albumId.replace('deezer_', '');
      const dzData = await fetchDeezerJsonp(`/album/${deezerId}`);
      if (dzData && !dzData.error) {
        album = {
          id: `deezer_${dzData.id}`,
          deezerId: dzData.id,
          title: dzData.title || 'Álbum',
          artist: dzData.artist ? dzData.artist.name : 'Artista',
          coverXl: dzData.cover_xl || dzData.cover_big || dzData.cover_medium,
          releaseDate: dzData.release_date || 'Oficial',
          label: dzData.label || 'Discográfica',
          nbTracks: dzData.nb_tracks || (dzData.tracks?.data?.length || 0),
          link: dzData.link || `https://www.deezer.com/album/${dzData.id}`,
          lucidaAlbumZipUrl: `https://lucida.to/?url=${encodeURIComponent(dzData.link || `https://www.deezer.com/album/${dzData.id}`)}`,
          tracks: (dzData.tracks?.data || []).map((t, idx) => ({
            position: t.track_position || idx + 1,
            id: `deezer_${t.id}`,
            title: t.title,
            artist: t.artist ? t.artist.name : (dzData.artist ? dzData.artist.name : 'Artista'),
            duration: t.duration || 0,
            preview: t.preview || null,
            link: t.link || `https://www.deezer.com/track/${t.id}`,
            lucidaUrl: `https://lucida.to/?url=${encodeURIComponent(t.link || `https://www.deezer.com/track/${t.id}`)}`
          }))
        };
      }
    }

    // Si no fue de Deezer o falló, consultar al backend
    if (!album) {
      const res = await fetch(`/api/album/${albumId}`);
      album = await res.json();
    }

    state.currentAlbum = album;

    // Renderizar Hero del Álbum
    albumHeroContent.innerHTML = `
      <div class="album-hero-cover-wrapper">
        <img src="${album.coverXl}" alt="${album.title}" onerror="this.src='https://via.placeholder.com/500/1a0933/ff2a85?text=VICE'">
      </div>
      <div class="album-hero-meta">
        <span class="album-badge-type">DISCOGRAFÍA OFICIAL MASTER</span>
        <h2 class="album-hero-title">${album.title}</h2>
        <p class="album-hero-artist">${album.artist}</p>
        <div class="album-hero-details">
          <span>📅 Lanzamiento: ${album.releaseDate}</span>
          <span>💿 ${album.nbTracks} Canciones</span>
          <span>🏷️ ${album.label || 'Oficial'}</span>
          <span>🖼️ Portada: 1000x1000 HD</span>
        </div>
        <div class="album-hero-actions">
          <!-- BOTÓN PRINCIPAL: DESCARGAR ÁLBUM COMPLETO EN FLAC -->
          <button class="vice-btn-primary btn-download-full-album" style="background: linear-gradient(135deg, #00f0ff, #ff2a85); font-size: 0.95rem; padding: 0.9rem 1.8rem;">
            <span>📦 DESCARGAR ÁLBUM COMPLETO (FLAC .ZIP)</span>
          </button>

          <button class="btn-back btn-download-album-cover" style="margin-bottom: 0;">
            <span>🖼️ DESCARGAR CARÁTULA EN 1000px HD</span>
          </button>
        </div>
      </div>
    `;

    // Acción: Descargar Álbum Completo (.ZIP en FLAC con Lucida)
    albumHeroContent.querySelector('.btn-download-full-album').addEventListener('click', () => {
      showToast(`📦 Abriendo descarga del álbum completo en ZIP / FLAC para: ${album.title}`);
      window.open(album.lucidaAlbumZipUrl, '_blank');
    });

    // Acción: Descargar Carátula HD
    albumHeroContent.querySelector('.btn-download-album-cover').addEventListener('click', () => {
      downloadFile(album.coverXl, `Cover_${album.title.replace(/[^a-zA-Z0-9]/g, '_')}_1000px.jpg`);
      showToast('🖼️ Descargando carátula oficial del álbum en 1000x1000 px...');
    });

    // Renderizar TODAS las canciones del álbum
    albumTracklist.innerHTML = '';

    album.tracks.forEach((track, index) => {
      const trackRow = document.createElement('div');
      trackRow.className = 'album-track-item';

      const trackNum = (track.position || index + 1).toString().padStart(2, '0');
      const durationMin = formatTime(track.duration);

      trackRow.innerHTML = `
        <div class="track-number">${trackNum}</div>
        <div class="track-main-info">
          <h4 title="${track.title}">${track.title}</h4>
          <p>${track.artist}</p>
        </div>
        <div class="track-duration">${durationMin}</div>
        <div class="track-actions">
          <button class="btn-track-play" title="Escuchar Muestra (30s)">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3"></polygon>
            </svg>
          </button>
          <button class="btn-track-action btn-play-full" style="background: rgba(0, 240, 255, 0.2); border: 1px solid var(--vice-cyan); color: var(--vice-cyan);" title="Escuchar Canción Completa">
            🎧 COMPLETA
          </button>
          <button class="btn-track-action btn-dl-mp3" title="Descargar MP3 320 kbps (Audio YouTube)">
            📥 MP3 320
          </button>
          <button class="btn-track-action btn-dl-flac" title="Descargar pista individual en FLAC">
            ⚡ FLAC
          </button>
        </div>
      `;

      // Escuchar muestra de 30s
      trackRow.querySelector('.btn-track-play').addEventListener('click', () => {
        if (!track.preview) {
          showToast('⚠️ Muestra de 30s no disponible. Reproduciendo canción completa oficial...');
          playFullSong(track.artist, track.title, album.coverXl);
          return;
        }
        loadTrack({
          title: track.title,
          artist: track.artist,
          cover: album.coverXl,
          audioUrl: track.preview
        });
      });

      // Escuchar Canción Completa (YouTube Audio Oficial en segundo plano)
      trackRow.querySelector('.btn-play-full').addEventListener('click', () => {
        playFullSong(track.artist, track.title, album.coverXl);
      });

      // Descargar MP3 320 kbps oficial vía stream
      trackRow.querySelector('.btn-dl-mp3').addEventListener('click', () => {
        downloadMp3_320(track.artist, track.title, track.preview || track.audioUrl);
      });

      // Descargar pista individual
      trackRow.querySelector('.btn-dl-flac').addEventListener('click', () => {
        showToast(`⚡ Abriendo enlace FLAC para: ${track.title}`);
        window.open(track.lucidaUrl, '_blank');
      });

      albumTracklist.appendChild(trackRow);
    });

  } catch (err) {
    console.error('Error al abrir álbum:', err);
    albumHeroContent.innerHTML = `<p style="color: #ff2a85; padding: 2rem;">Error al cargar el álbum: ${err.message}</p>`;
  }
}

// Renderizar Pistas Sueltas CON BOTÓN PARA IR DIRECTO AL ÁLBUM COMPLETO
function renderTracks(tracks) {
  resultsCount.innerText = `${tracks.length} PISTAS IDENTIFICADAS`;

  if (tracks.length === 0) {
    resultsGrid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 4rem;">No se encontraron canciones.</div>`;
    return;
  }

  tracks.forEach(track => {
    const card = document.createElement('div');
    card.className = 'album-card';

    const goToAlbumBtn = track.albumId ? `
      <button class="btn-go-to-album" style="
        width: 100%;
        margin-bottom: 0.6rem;
        background: linear-gradient(90deg, #ff2a85, #9d00ff);
        color: #fff;
        border: none;
        padding: 0.6rem;
        border-radius: 10px;
        font-family: var(--font-logo);
        font-size: 0.78rem;
        font-weight: 900;
        font-style: italic;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.4rem;
        box-shadow: 0 4px 15px rgba(255, 42, 133, 0.35);
      ">
        <span>💿 IR AL ÁLBUM COMPLETO ➔</span>
      </button>
    ` : '';

    card.innerHTML = `
      <div class="album-cover-wrapper">
        <img class="album-cover" src="${track.coverXl}" alt="${track.title}" loading="lazy" onerror="this.src='https://via.placeholder.com/400/1a0933/ff2a85?text=VICE'">
        <span class="album-badge-tracks" style="background: rgba(0, 240, 255, 0.2); border: 1px solid var(--vice-cyan); color: var(--vice-cyan);">
          💿 ${track.album}
        </span>
      </div>
      <div class="album-info">
        <h3 class="album-title" title="${track.title}">${track.title}</h3>
        <p class="album-artist" title="${track.artist}">${track.artist}</p>
        
        <div style="margin-top: auto;">
          ${goToAlbumBtn}
          <div style="display: flex; gap: 0.35rem; flex-wrap: wrap;">
            <button class="btn-track-action btn-single-full" style="flex: 1; min-width: 65px; padding: 0.55rem; font-size: 0.72rem; background: rgba(0, 240, 255, 0.2); border: 1px solid var(--vice-cyan); color: var(--vice-cyan);">
              🎧 COMPLETA
            </button>
            <button class="btn-track-action btn-single-mp3 btn-dl-mp3" style="padding: 0.55rem 0.6rem; font-size: 0.72rem;" title="Descargar MP3 320 kbps (YouTube Audio)">
              📥 MP3
            </button>
            <button class="btn-track-action btn-single-flac" style="padding: 0.55rem 0.6rem; font-size: 0.72rem;" title="Descargar FLAC Lossless">
              ⚡ FLAC
            </button>
            <button class="btn-track-play btn-single-play" title="Muestra 30s">
              <svg viewBox="0 0 24 24" fill="currentColor" style="width: 14px; height: 14px;"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
            </button>
          </div>
        </div>
      </div>
    `;

    if (track.albumId) {
      card.querySelector('.btn-go-to-album').addEventListener('click', (e) => {
        e.stopPropagation();
        openAlbumDetail(track.albumId);
      });
    }

    card.querySelector('.btn-single-full').addEventListener('click', (e) => {
      e.stopPropagation();
      playFullSong(track.artist, track.title, track.coverXl);
    });

    card.querySelector('.btn-single-mp3').addEventListener('click', (e) => {
      e.stopPropagation();
      downloadMp3_320(track.artist, track.title, track.preview || track.audioUrl);
    });

    card.querySelector('.btn-single-flac').addEventListener('click', (e) => {
      e.stopPropagation();
      window.open(track.lucidaUrl, '_blank');
    });

    card.querySelector('.btn-single-play').addEventListener('click', (e) => {
      e.stopPropagation();
      loadTrack({
        title: track.title,
        artist: track.artist,
        cover: track.coverXl,
        audioUrl: track.preview
      });
    });

    resultsGrid.appendChild(card);
  });
}

// ========================================================
// REPRODUCTOR UNIFICADO (PREVIEW 30S + CANCIÓN COMPLETA)
// ========================================================

function loadTrack(track) {
  // Detener YouTube si estaba sonando
  if (state.playbackSource === 'full' && ytPlayer && typeof ytPlayer.pauseVideo === 'function') {
    ytPlayer.pauseVideo();
    stopYtProgress();
  }

  state.playbackSource = 'preview';
  state.currentTrack = track;
  playerTitle.innerText = track.title;
  playerArtist.innerText = track.artist;
  playerCover.src = track.cover || 'https://via.placeholder.com/80/1a0933/ff2a85?text=VI';

  playerModeBadge.innerText = 'PREVIEW 30S';
  playerModeBadge.className = 'spec-pill';

  if (track.audioUrl) {
    state.audio.src = track.audioUrl;
    state.audio.playbackRate = state.currentSpeed;
    state.audio.play().then(() => setPlayingState(true)).catch(() => setPlayingState(false));
  }
}

// REPRODUCIR CANCIÓN 100% COMPLETA (SIN VIDEO MOLESTO EN PANTALLA)
async function playFullSong(artist, title, cover = null) {
  // Pausar audio de muestra si está sonando
  if (state.audio) {
    state.audio.pause();
  }

  state.playbackSource = 'full';
  state.currentTrack = (state.currentTrack && state.currentTrack.title === title)
    ? { ...state.currentTrack, title, artist, cover }
    : { title, artist, cover };

  playerTitle.innerText = title;
  playerArtist.innerText = artist;
  if (cover) {
    playerCover.src = cover;
  }
  playerModeBadge.innerText = '🎧 CANCIÓN COMPLETA';
  playerModeBadge.className = 'spec-pill gold';
  currentTimeLabel.innerText = '00:00';
  totalTimeLabel.innerText = 'Cargando...';
  progressFill.style.width = '0%';
  progressThumb.style.left = '0%';

  showToast('🎧 Sintonizando canción completa: ' + title + '...');

  try {
    const res = await fetch('/api/fullaudio?q=' + encodeURIComponent(artist + ' ' + title));
    const data = await res.json();

    if (data.videoId) {
      if (state.currentTrack) {
        state.currentTrack.videoId = data.videoId;
      }
      initYtPlayer();

      const tryPlay = () => {
        if (ytPlayer && typeof ytPlayer.loadVideoById === 'function') {
          ytPlayer.loadVideoById(data.videoId);
          ytPlayer.playVideo();
          if (typeof ytPlayer.setPlaybackRate === 'function') {
            ytPlayer.setPlaybackRate(state.currentSpeed);
          }
          setPlayingState(true);
          startYtProgress();
          showToast('🎧 Reproduciendo canción completa oficial: ' + title);
          return true;
        }
        return false;
      };

      if (!tryPlay()) {
        ytPendingVideoId = data.videoId;
        showToast('⏳ Sintonizando reproductor...');
        let retries = 0;
        const interval = setInterval(() => {
          retries++;
          if (tryPlay() || retries > 12) {
            clearInterval(interval);
          }
        }, 350);
      }
    } else {
      showToast('❌ No se encontró el stream oficial para esta canción.');
    }
  } catch (err) {
    console.error('Error al conectar con stream:', err);
    showToast('Error al sintonizar stream completo: ' + err.message);
  }
}

// DESCARGAR AUDIO EN MP3 DIRECTO DESDE NUESTRA PROPIA PAGINA (CANCIÓN COMPLETA)
async function downloadMp3_320(artist, title, audioUrl = null, videoId = null) {
  showToast('⏳ Sintonizando audio de: ' + title + '...');
  
  const targetVid = videoId || (state.currentTrack && state.currentTrack.title === title ? state.currentTrack.videoId : null);
  const q = encodeURIComponent(artist + ' ' + title);
  let startEndpoint = '/api/start-mp3-conversion?q=' + q;
  if (targetVid) {
    startEndpoint += '&videoId=' + encodeURIComponent(targetVid);
  }

  try {
    // 1. Iniciar conversión en el servidor
    const res = await fetch(startEndpoint);
    const data = await res.json();

    if (!res.ok || !data.progressUrl) {
      throw new Error(data.error || 'No se pudo iniciar la conversión');
    }

    const progressUrl = data.progressUrl;
    showToast('⚙️ Convirtiendo canción completa a MP3 320 kbps...');

    // 2. Pollear el progreso desde el navegador para evitar cortes de conexión de Render
    let attempts = 0;
    const maxAttempts = 35; // hasta 70 segundos máximo
    let downloadUrl = null;

    while (attempts < maxAttempts) {
      attempts++;
      await new Promise(r => setTimeout(r, 2000));

      try {
        const checkRes = await fetch('/api/check-mp3-progress?url=' + encodeURIComponent(progressUrl));
        if (checkRes.ok) {
          const checkData = await checkRes.json();
          if (checkData.isFinished && checkData.downloadUrl) {
            downloadUrl = checkData.downloadUrl;
            break;
          } else {
            const stepText = checkData.text || 'Procesando';
            showToast(`⚙️ Convirtiendo: ${stepText}... (${Math.min(95, attempts * 5)}%)`);
          }
        }
      } catch (pollErr) {
        console.warn('Reintento de sondeo:', pollErr.message);
      }
    }

    if (!downloadUrl) {
      throw new Error('La conversión tardó más de lo esperado. Por favor presiona descargar nuevamente.');
    }

    showToast('🚀 ¡Audio listo! Descargando canción completa: ' + title + '...');

    // 3. Descarga directa en el navegador desde el CDN de audio verificado (sin cortes de Render)
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.setAttribute('download', `${title} - ${artist}.mp3`);
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      if (document.body.contains(a)) {
        document.body.removeChild(a);
      }
    }, 4000);

  } catch (err) {
    console.error('Error al descargar MP3 completo:', err);
    showToast('❌ Error al preparar descarga MP3: ' + err.message);
  }
}

function togglePlayPause() {
  if (state.playbackSource === 'full') {
    if (!ytPlayer || typeof ytPlayer.getPlayerState !== 'function') return;
    const ytState = ytPlayer.getPlayerState();
    if (ytState === 1) { // está reproduciendo
      ytPlayer.pauseVideo();
      setPlayingState(false);
    } else {
      ytPlayer.playVideo();
      setPlayingState(true);
    }
  } else {
    if (!state.audio.src) return;
    if (state.audio.paused) {
      state.audio.play();
    } else {
      state.audio.pause();
    }
  }
}

function seekDelta(seconds) {
  if (state.playbackSource === 'full') {
    if (!ytPlayer || typeof ytPlayer.getCurrentTime !== 'function') return;
    const cur = ytPlayer.getCurrentTime() || 0;
    const dur = ytPlayer.getDuration() || 0;
    const target = Math.max(0, Math.min(dur, cur + seconds));
    ytPlayer.seekTo(target, true);
  } else {
    if (!state.audio.duration) return;
    state.audio.currentTime = Math.max(0, Math.min(state.audio.duration, state.audio.currentTime + seconds));
  }
}

// Alternar velocidad (1x -> 1.25x -> 1.5x -> 2x)
function cyclePlaybackSpeed() {
  const speeds = [1, 1.25, 1.5, 2];
  const currentIndex = speeds.indexOf(state.currentSpeed);
  const nextIndex = (currentIndex + 1) % speeds.length;
  state.currentSpeed = speeds[nextIndex];

  if (speedLabel) {
    speedLabel.innerText = `${state.currentSpeed}x`;
  }

  // Aplicar a YouTube
  if (state.playbackSource === 'full' && ytPlayer && typeof ytPlayer.setPlaybackRate === 'function') {
    ytPlayer.setPlaybackRate(state.currentSpeed);
  }

  // Aplicar a Audio HTML5
  if (state.audio) {
    state.audio.playbackRate = state.currentSpeed;
  }

  showToast(`⚡ Velocidad ajustada a ${state.currentSpeed}x`);
}

function setPlayingState(playing) {
  state.isPlaying = playing;
  if (playing) {
    iconPlay.classList.add('hidden');
    iconPause.classList.remove('hidden');
    waveIndicator.classList.add('playing');
  } else {
    iconPlay.classList.remove('hidden');
    iconPause.classList.add('hidden');
    waveIndicator.classList.remove('playing');
  }
}

function updateProgress() {
  const current = state.audio.currentTime || 0;
  const total = state.audio.duration || 0;

  currentTimeLabel.innerText = formatTime(current);
  totalTimeLabel.innerText = formatTime(total);

  if (total > 0) {
    const percent = (current / total) * 100;
    progressFill.style.width = `${percent}%`;
    progressThumb.style.left = `${percent}%`;
  }
}

function formatTime(seconds) {
  if (isNaN(seconds) || seconds < 0) return '00:00';
  const min = Math.floor(seconds / 60);
  const sec = Math.floor(seconds % 60);
  return `${min.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
}

function downloadFile(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.target = '_blank';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function showToast(message) {
  toastText.innerText = message;
  toastNotification.classList.remove('hidden');
  setTimeout(() => toastNotification.classList.add('hidden'), 4500);
}

function startVisualizer() {
  if (!vCtx) return;

  function draw() {
    vCtx.clearRect(0, 0, visualizerCanvas.width, visualizerCanvas.height);
    const numBars = 16;
    const barWidth = 4;
    const spacing = 4;

    for (let i = 0; i < numBars; i++) {
      let height = 4;
      if (state.isPlaying) {
        const factor = state.currentSpeed || 1;
        const wave = Math.sin((Date.now() * factor) / 140 + i * 0.7) * 14 + Math.cos((Date.now() * factor) / 200 + i) * 6;
        height = Math.max(3, Math.min(visualizerCanvas.height - 4, 16 + wave));
      }

      const x = i * (barWidth + spacing) + 4;
      const y = visualizerCanvas.height - height;

      const grad = vCtx.createLinearGradient(0, y, 0, visualizerCanvas.height);
      grad.addColorStop(0, '#ff2a85');
      grad.addColorStop(1, '#00f0ff');

      vCtx.fillStyle = state.isPlaying ? grad : 'rgba(255, 255, 255, 0.15)';
      vCtx.fillRect(x, y, barWidth, height);
    }

    requestAnimationFrame(draw);
  }

  draw();
}
