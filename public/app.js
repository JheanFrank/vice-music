// ========================================================
// VICE MUSIC // GTA VI EDITION (FULL ALBUMS & FLAC)
// ========================================================

const state = {
  currentMode: 'home', // 'home' | 'albums' | 'tracks'
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
const tabHome = document.getElementById('tabHome');
const tabAlbums = document.getElementById('tabAlbums');
const tabTracks = document.getElementById('tabTracks');
const searchHeaderTitle = document.getElementById('searchHeaderTitle');
const searchHeaderSub = document.getElementById('searchHeaderSub');

// Home Section Elements
const homeSection = document.getElementById('homeSection');
const topRankingList = document.getElementById('topRankingList');
const homeTrendingGrid = document.getElementById('homeTrendingGrid');

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
const playerLabel = document.getElementById('playerLabel');
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
  if (state.playbackSource !== 'full' && state.playbackSource !== 'full_yt') return;

  if (event.data === 1) { // PLAYING
    setPlayingState(true);
    startYtProgress();
    if (state.currentTrack) updateMediaSession(state.currentTrack);
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
  } else if (event.data === 2) { // PAUSED
    setPlayingState(false);
    stopYtProgress();
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
  } else if (event.data === 0) { // ENDED
    setPlayingState(false);
    stopYtProgress();
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'none';
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
      updateMediaSessionPosition(cur, dur);
    }

    if (state.currentTrack && 'mediaSession' in navigator) {
      if (!navigator.mediaSession.metadata || navigator.mediaSession.metadata.title !== state.currentTrack.title) {
        updateMediaSession(state.currentTrack);
      }
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
// SISTEMA DE AUTENTICACIÓN VIP (ADMIN / ADMIN)
// ========================================================
const AUTH_STORAGE_KEY = 'vice_vip_session_v1';
let pendingPostAuthAction = null;

function getAuthUser() {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (session && session.user === 'admin') {
      return session;
    }
  } catch (e) {
    console.error('Error al leer sesión VIP:', e);
  }
  return null;
}

function isUserLoggedIn() {
  return !!getAuthUser();
}

function updateAuthUI() {
  const user = getAuthUser();
  const btnOpenLogin = document.getElementById('btnOpenLogin');
  const authUserInfo = document.getElementById('authUserInfo');
  const authUserName = document.getElementById('authUserName');

  if (user) {
    if (btnOpenLogin) btnOpenLogin.classList.add('hidden');
    if (authUserInfo) authUserInfo.classList.remove('hidden');
    if (authUserName) authUserName.textContent = user.user || 'admin';
  } else {
    if (btnOpenLogin) btnOpenLogin.classList.remove('hidden');
    if (authUserInfo) authUserInfo.classList.add('hidden');
  }
}

function openLoginModal(subtitle = null, onLoginSuccess = null) {
  pendingPostAuthAction = (typeof onLoginSuccess === 'function') ? onLoginSuccess : null;
  const modal = document.getElementById('loginModal');
  const subtitleEl = document.getElementById('loginModalSubtitle');
  const alertEl = document.getElementById('loginAlert');
  const userInput = document.getElementById('loginUsername');
  const pwdInput = document.getElementById('loginPassword');

  if (alertEl) {
    alertEl.classList.add('hidden');
    alertEl.textContent = '';
  }
  if (subtitleEl && subtitle) {
    subtitleEl.textContent = subtitle;
  } else if (subtitleEl) {
    subtitleEl.textContent = 'Accede con tu cuenta VIP para descargar MP3 a 320 kbps y discografías completas.';
  }

  if (userInput) userInput.value = '';
  if (pwdInput) pwdInput.value = '';

  if (modal) {
    modal.classList.remove('hidden');
    setTimeout(() => {
      if (userInput) userInput.focus();
    }, 120);
  }
}

function closeLoginModal() {
  const modal = document.getElementById('loginModal');
  if (modal) modal.classList.add('hidden');
}

async function handleLoginSubmit(e) {
  if (e) e.preventDefault();
  const userInput = document.getElementById('loginUsername');
  const pwdInput = document.getElementById('loginPassword');
  const alertEl = document.getElementById('loginAlert');
  const btnSubmit = document.getElementById('btnLoginSubmit');
  const btnText = document.getElementById('loginBtnText');
  const spinner = document.getElementById('loginBtnSpinner');

  const username = (userInput ? userInput.value : '').trim();
  const password = (pwdInput ? pwdInput.value : '').trim();

  if (!username || !password) {
    if (alertEl) {
      alertEl.textContent = 'Por favor ingresa usuario y contraseña.';
      alertEl.classList.remove('hidden');
    }
    return;
  }

  if (btnSubmit) btnSubmit.disabled = true;
  if (btnText) btnText.textContent = 'VERIFICANDO...';
  if (spinner) spinner.classList.remove('hidden');
  if (alertEl) alertEl.classList.add('hidden');

  try {
    let data = null;
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      data = await res.json();
    } catch (netErr) {
      // Fallback si la petición de red falla momentáneamente
      if (username === 'admin' && password === 'admin') {
        data = { success: true, user: 'admin', role: 'VIP Admin' };
      } else {
        data = { success: false, error: 'Credenciales inválidas.' };
      }
    }

    if (data && data.success) {
      const session = {
        user: data.user || username,
        role: data.role || 'VIP Admin',
        token: data.token || 'vice_vip_admin_token_2026',
        timestamp: Date.now()
      };
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
      updateAuthUI();
      closeLoginModal();
      showToast(`👑 ¡Sesión iniciada con éxito! Bienvenido, VIP ${session.user}.`);

      if (pendingPostAuthAction) {
        const action = pendingPostAuthAction;
        pendingPostAuthAction = null;
        try {
          action();
        } catch (actErr) {
          console.error('Error al ejecutar descarga tras login:', actErr);
        }
      }
    } else {
      if (alertEl) {
        alertEl.textContent = (data && data.error) || 'Usuario o contraseña incorrectos. Verifica tus credenciales.';
        alertEl.classList.remove('hidden');
      }
    }
  } catch (err) {
    if (alertEl) {
      alertEl.textContent = 'Error al comunicarse con el servidor.';
      alertEl.classList.remove('hidden');
    }
  } finally {
    if (btnSubmit) btnSubmit.disabled = false;
    if (btnText) btnText.textContent = 'INGRESAR AL SISTEMA';
    if (spinner) spinner.classList.add('hidden');
  }
}

function handleLogout() {
  localStorage.removeItem(AUTH_STORAGE_KEY);
  updateAuthUI();
  showToast('🔒 Sesión cerrada. Se requerirá login para descargar.');
}

// ========================================================
// INICIALIZACIÓN
// ========================================================
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  updateAuthUI();
  startVisualizer();
  loadHomeContent();
  switchViewMode('home');
});

function setupEventListeners() {
  if (tabHome) tabHome.addEventListener('click', () => switchViewMode('home'));
  tabAlbums.addEventListener('click', () => switchViewMode('albums'));
  tabTracks.addEventListener('click', () => switchViewMode('tracks'));

  searchBtn.addEventListener('click', () => performSearch(searchInput.value));
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') performSearch(searchInput.value);
  });

  searchInput.addEventListener('paste', () => {
    setTimeout(() => performSearch(searchInput.value), 100);
  });

  // Chips sugeridos: Más buscados de Colombia
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
    if (state.currentMode === 'home') {
      if (homeSection) homeSection.classList.remove('hidden');
    } else {
      catalogSection.classList.remove('hidden');
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // Botón Volver de la vista de Artista
  const btnBackFromArtist = document.getElementById('btnBackFromArtist');
  if (btnBackFromArtist) {
    btnBackFromArtist.addEventListener('click', () => {
      const artistDetailView = document.getElementById('artistDetailView');
      if (artistDetailView) artistDetailView.classList.add('hidden');
      if (state.previousMode === 'albums' || state.previousMode === 'tracks') {
        if (catalogSection) catalogSection.classList.remove('hidden');
      } else if (state.previousMode === 'album_detail') {
        if (albumDetailView) albumDetailView.classList.remove('hidden');
      } else {
        if (homeSection) homeSection.classList.remove('hidden');
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  // Clic en el nombre del artista en la barra fija
  if (playerArtist) {
    playerArtist.classList.add('artist-clickable');
    playerArtist.addEventListener('click', () => {
      if (state.currentTrack && state.currentTrack.artist) {
        openArtistProfile(state.currentTrack.artist);
      }
    });
  }

  // Botón Escuchar Canción Completa en la barra fija
  if (btnPlayFullSong) {
    btnPlayFullSong.addEventListener('click', () => {
      if (state.currentTrack) {
        playFullSong(state.currentTrack.artist, state.currentTrack.title, state.currentTrack.cover, state.currentTrack.album);
      } else {
        showToast('Selecciona primero una canción para escucharla completa.');
      }
    });
  }

  // Botón Descargar MP3 320 en la barra fija
  const btnPlayerDlMp3 = document.getElementById('btnPlayerDlMp3');
  if (btnPlayerDlMp3) {
    btnPlayerDlMp3.addEventListener('click', (e) => {
      if (state.currentTrack) {
        downloadMp3_320(state.currentTrack.artist, state.currentTrack.title, state.currentTrack.audioUrl, state.currentTrack.videoId, {
          album: state.currentTrack.album,
          coverUrl: state.currentTrack.cover,
          year: state.currentTrack.releaseDate
        }, e.currentTarget);
      } else {
        showToast('Selecciona primero una canción para descargar en MP3 320.');
      }
    });
  }

  // Botones movil en btn-group (📥 y 🎧)
  const btnPlayerDlMp3Mobile = document.getElementById('btnPlayerDlMp3Mobile');
  if (btnPlayerDlMp3Mobile) {
    btnPlayerDlMp3Mobile.addEventListener('click', (e) => {
      if (state.currentTrack) {
        downloadMp3_320(state.currentTrack.artist, state.currentTrack.title, state.currentTrack.audioUrl, state.currentTrack.videoId, {
          album: state.currentTrack.album,
          coverUrl: state.currentTrack.cover,
          year: state.currentTrack.releaseDate
        }, e.currentTarget);
      } else {
        showToast('Selecciona primero una canción para descargar en MP3.');
      }
    });
  }
  const btnPlayFullSongMobile = document.getElementById('btnPlayFullSongMobile');
  if (btnPlayFullSongMobile) {
    btnPlayFullSongMobile.addEventListener('click', () => {
      if (state.currentTrack) {
        playFullSong(state.currentTrack.artist, state.currentTrack.title, state.currentTrack.cover, state.currentTrack.album);
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

    if ((state.playbackSource === 'full' || state.playbackSource === 'full_yt') && ytPlayer && typeof ytPlayer.getDuration === 'function') {
      const dur = ytPlayer.getDuration();
      if (dur > 0) {
        ytPlayer.seekTo(pos * dur, true);
        updateMediaSessionPosition(pos * dur, dur);
      }
    } else if (state.audio.duration) {
      state.audio.currentTime = pos * state.audio.duration;
      updateMediaSessionPosition(state.audio.currentTime, state.audio.duration);
    }
  });

  state.audio.addEventListener('timeupdate', () => {
    if (state.playbackSource === 'preview' || state.playbackSource === 'full_stream') {
      updateProgress();
    }
  });
  state.audio.addEventListener('ended', () => {
    if (state.playbackSource === 'preview' || state.playbackSource === 'full_stream') {
      setPlayingState(false);
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'none';
    }
  });
  state.audio.addEventListener('play', () => {
    if (state.playbackSource === 'preview' || state.playbackSource === 'full_stream') {
      setPlayingState(true);
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
      if (state.currentTrack) updateMediaSession(state.currentTrack);
    }
  });
  state.audio.addEventListener('pause', () => {
    if (state.playbackSource === 'preview' || state.playbackSource === 'full_stream') {
      setPlayingState(false);
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
    }
  });

  // Eventos de Autenticación VIP
  const btnOpenLogin = document.getElementById('btnOpenLogin');
  if (btnOpenLogin) btnOpenLogin.addEventListener('click', () => openLoginModal());

  const btnCloseLoginModal = document.getElementById('btnCloseLoginModal');
  if (btnCloseLoginModal) btnCloseLoginModal.addEventListener('click', closeLoginModal);

  const loginModalBackdrop = document.getElementById('loginModalBackdrop');
  if (loginModalBackdrop) loginModalBackdrop.addEventListener('click', closeLoginModal);

  const loginForm = document.getElementById('loginForm');
  if (loginForm) loginForm.addEventListener('submit', handleLoginSubmit);

  const btnLogout = document.getElementById('btnLogout');
  if (btnLogout) btnLogout.addEventListener('click', handleLogout);

  const btnTogglePassword = document.getElementById('btnTogglePassword');
  if (btnTogglePassword) {
    btnTogglePassword.addEventListener('click', () => {
      const pwdInput = document.getElementById('loginPassword');
      if (!pwdInput) return;
      if (pwdInput.type === 'password') {
        pwdInput.type = 'text';
        btnTogglePassword.textContent = '🙈';
      } else {
        pwdInput.type = 'password';
        btnTogglePassword.textContent = '👁️';
      }
    });
  }

  // Cerrar modal VIP con tecla Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeLoginModal();
  });
}

function switchViewMode(mode) {
  state.currentMode = mode;
  albumDetailView.classList.add('hidden');

  if (mode === 'home') {
    if (tabHome) tabHome.classList.add('active');
    if (tabAlbums) tabAlbums.classList.remove('active');
    if (tabTracks) tabTracks.classList.remove('active');
    if (homeSection) homeSection.classList.remove('hidden');
    if (catalogSection) catalogSection.classList.add('hidden');
    searchHeaderTitle.innerText = 'BUSCA CUALQUIER ARTISTA O CANCIÓN';
    searchHeaderSub.innerHTML = 'Escribe cualquier artista o canción para explorar discografías completas y sencillos en alta calidad.';
    searchInput.placeholder = 'Busca cualquier artista o canción...';
    return;
  }

  if (homeSection) homeSection.classList.add('hidden');
  catalogSection.classList.remove('hidden');

  if (mode === 'albums') {
    if (tabAlbums) tabAlbums.classList.add('active');
    if (tabHome) tabHome.classList.remove('active');
    if (tabTracks) tabTracks.classList.remove('active');
    searchHeaderTitle.innerText = 'BUSCA CUALQUIER ÁLBUM O DISCOGRAFÍA';
    searchHeaderSub.innerHTML = 'Escribe cualquier artista o canción para ver álbumes completos.';
    searchInput.placeholder = 'Busca artista o álbum...';
    resultsTitle.innerText = 'ÁLBUMES DISPONIBLES';
  } else {
    if (tabTracks) tabTracks.classList.add('active');
    if (tabHome) tabHome.classList.remove('active');
    if (tabAlbums) tabAlbums.classList.remove('active');
    searchHeaderTitle.innerText = 'BUSCA CUALQUIER PISTA O CANCIÓN';
    searchHeaderSub.innerHTML = 'Encuentra canciones sueltas y salta a su álbum completo con un solo clic.';
    searchInput.placeholder = 'Busca cualquier canción...';
    resultsTitle.innerText = 'PISTAS IDENTIFICADAS';
  }

  const query = searchInput.value.trim() || 'Blessd';
  performSearch(query);
}

// Búsqueda Híbrida (Backend Render + Cliente Deezer JSONP Directo)
async function performSearch(query) {
  if (!query || !query.trim()) return;

  // Si estábamos en modo 'home', activar visualmente el modo 'albums'
  if (state.currentMode === 'home') {
    state.currentMode = 'albums';
    if (tabHome) tabHome.classList.remove('active');
    if (tabAlbums) tabAlbums.classList.add('active');
    if (tabTracks) tabTracks.classList.remove('active');
  }

  if (homeSection) homeSection.classList.add('hidden');
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
      <div class="album-cover-wrapper" title="Clic para ver el álbum completo">
        <img class="album-cover" src="${album.coverXl}" alt="${album.title}" loading="lazy" onerror="this.src='https://via.placeholder.com/400/1a0933/ff2a85?text=VICE'">
        <div class="cover-overlay-hint"><span>💿 VER ÁLBUM</span></div>
        ${matchedPill}
        <span class="album-badge-tracks">${album.nbTracks} CANCIONES</span>
      </div>
      <div class="album-info">
        <h3 class="album-title" title="${album.title}">${album.title}</h3>
        <p class="album-artist artist-clickable" data-artist="${album.artist}" title="Ver discografía y perfil de ${album.artist}">${album.artist}</p>
        <div class="btn-open-album">VER ÁLBUM COMPLETO ➔</div>
      </div>
    `;

    card.addEventListener('click', (e) => {
      if (e.target.closest('.artist-clickable')) return;
      openAlbumDetail(album.id);
    });

    const artistLink = card.querySelector('.album-artist');
    if (artistLink) {
      artistLink.addEventListener('click', (e) => {
        e.stopPropagation();
        openArtistProfile(album.artist);
      });
    }

    resultsGrid.appendChild(card);
  });
}

// Abrir Vista Detallada del Álbum con TODAS sus canciones y DESCARGA COMPLETA
async function openAlbumDetail(albumId) {
  state.previousMode = 'album_detail';
  const artistDetailView = document.getElementById('artistDetailView');
  if (artistDetailView) artistDetailView.classList.add('hidden');
  if (homeSection) homeSection.classList.add('hidden');
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
        <p class="album-hero-artist artist-clickable" data-artist="${album.artist}" title="Ver discografía y perfil de ${album.artist}">Por <strong>${album.artist}</strong></p>
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
      if (!isUserLoggedIn()) {
        openLoginModal(`Inicia sesión como VIP para descargar el álbum completo "${album.title}".`, () => {
          showToast(`📦 Abriendo descarga del álbum completo en ZIP / FLAC para: ${album.title}`);
          window.open(album.lucidaAlbumZipUrl, '_blank');
        });
        return;
      }
      showToast(`📦 Abriendo descarga del álbum completo en ZIP / FLAC para: ${album.title}`);
      window.open(album.lucidaAlbumZipUrl, '_blank');
    });

    // Acción: Descargar Carátula HD
    albumHeroContent.querySelector('.btn-download-album-cover').addEventListener('click', () => {
      downloadFile(album.coverXl, `Cover_${album.title.replace(/[^a-zA-Z0-9]/g, '_')}_1000px.jpg`);
      showToast('🖼️ Descargando carátula oficial del álbum en 1000x1000 px...');
    });

    const heroArtistLink = albumHeroContent.querySelector('.album-hero-artist');
    if (heroArtistLink) {
      heroArtistLink.addEventListener('click', (e) => {
        e.stopPropagation();
        openArtistProfile(album.artist);
      });
    }

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
          playFullSong(track.artist, track.title, album.coverXl, album.title);
          return;
        }
        loadTrack({
          title: track.title,
          artist: track.artist,
          cover: album.coverXl,
          album: album.title,
          audioUrl: track.preview
        });
      });

      // Escuchar Canción Completa (Audio Oficial en segundo plano)
      trackRow.querySelector('.btn-play-full').addEventListener('click', () => {
        playFullSong(track.artist, track.title, album.coverXl, album.title);
      });

      // Descargar MP3 320 kbps oficial vía stream
      trackRow.querySelector('.btn-dl-mp3').addEventListener('click', (e) => {
        downloadMp3_320(track.artist, track.title, track.preview || track.audioUrl, null, {
          album: album.title,
          albumArtist: album.artist,
          publisher: album.label || null,
          coverUrl: album.coverXl,
          year: album.releaseDate,
          releaseDate: album.releaseDate,
          track: track.position || (index + 1),
          totalTracks: album.tracks ? album.tracks.length : null,
          disk: track.disk || 1,
          genre: album.genre || null
        }, e.currentTarget);
      });

      // Descargar pista individual
      trackRow.querySelector('.btn-dl-flac').addEventListener('click', () => {
        if (!isUserLoggedIn()) {
          openLoginModal(`Inicia sesión como VIP para descargar FLAC de "${track.title}".`, () => {
            showToast(`⚡ Abriendo enlace FLAC para: ${track.title}`);
            window.open(track.lucidaUrl, '_blank');
          });
          return;
        }
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
    card.className = 'album-card track-card-modern';

    card.innerHTML = `
      <div class="album-cover-wrapper" title="Clic para escuchar o ver álbum completo">
        <img class="album-cover" src="${track.coverXl}" alt="${track.title}" loading="lazy" onerror="this.src='https://via.placeholder.com/400/1a0933/ff2a85?text=VICE'">
        <div class="cover-overlay-hint">
          <span>${track.albumId ? '💿 VER ÁLBUM' : '▶ ESCUCHAR'}</span>
        </div>
        ${track.album ? `
          <span class="album-badge-tracks" style="background: rgba(0, 240, 255, 0.2); border: 1px solid var(--vice-cyan); color: var(--vice-cyan);">
            💿 ${track.album}
          </span>
        ` : ''}
      </div>

      <div class="album-info">
        <h3 class="album-title" title="${track.title}">${track.title}</h3>
        <p class="album-artist artist-clickable" data-artist="${track.artist}" title="Ver discografía y perfil de ${track.artist}">${track.artist}</p>
        
        <div class="track-card-actions">
          <!-- Fila 1: Reproducción Instantánea -->
          <div class="actions-row-play">
            <button class="btn-card-action btn-card-preview btn-single-play" title="Escuchar muestra de 30s">
              ▶ <span>PREVIEW</span>
            </button>
            <button class="btn-card-action btn-card-full btn-single-full" title="Escuchar canción completa">
              🎧 <span>COMPLETA</span>
            </button>
          </div>

          <!-- Fila 2: Descargas y Acceso a Álbum -->
          <div class="actions-row-dl">
            <button class="btn-card-action btn-card-mp3 btn-single-mp3" title="Descargar MP3 320 kbps (VIP)">
              📥 <span>MP3 320</span>
            </button>
            ${track.albumId ? `
              <button class="btn-card-action btn-card-album btn-go-to-album" title="Ver álbum completo con todas sus canciones">
                💿 <span>ÁLBUM</span>
              </button>
            ` : `
              <button class="btn-card-action btn-card-flac btn-single-flac" title="Descargar FLAC Lossless">
                ⚡ <span>FLAC</span>
              </button>
            `}
          </div>
        </div>
      </div>
    `;

    // Clic en la carátula: si tiene álbum abre el álbum, si no reproduce el preview
    card.querySelector('.album-cover-wrapper').addEventListener('click', (e) => {
      e.stopPropagation();
      if (track.albumId) {
        openAlbumDetail(track.albumId);
      } else {
        loadTrack({
          title: track.title,
          artist: track.artist,
          cover: track.coverXl,
          audioUrl: track.preview,
          album: track.album
        });
      }
    });

    // Clic en el nombre del artista: abre el perfil del artista
    const artistEl = card.querySelector('.album-artist');
    if (artistEl) {
      artistEl.addEventListener('click', (e) => {
        e.stopPropagation();
        openArtistProfile(track.artist);
      });
    }

    if (track.albumId) {
      const albumBtn = card.querySelector('.btn-go-to-album');
      if (albumBtn) {
        albumBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          openAlbumDetail(track.albumId);
        });
      }
    }

    const flacBtn = card.querySelector('.btn-single-flac');
    if (flacBtn) {
      flacBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!isUserLoggedIn()) {
          openLoginModal(`Inicia sesión como VIP para descargar FLAC de "${track.title}".`, () => {
            showToast(`⚡ Abriendo enlace FLAC para: ${track.title}`);
            window.open(track.lucidaUrl, '_blank');
          });
          return;
        }
        showToast(`⚡ Abriendo enlace FLAC para: ${track.title}`);
        window.open(track.lucidaUrl, '_blank');
      });
    }

    card.querySelector('.btn-single-full').addEventListener('click', (e) => {
      e.stopPropagation();
      playFullSong(track.artist, track.title, track.coverXl, track.album);
    });

    card.querySelector('.btn-single-mp3').addEventListener('click', (e) => {
      e.stopPropagation();
      downloadMp3_320(track.artist, track.title, track.preview || track.audioUrl, null, {
        album: track.album,
        albumArtist: track.artist,
        coverUrl: track.coverXl,
        year: track.releaseDate,
        releaseDate: track.releaseDate,
        track: track.trackPosition || null,
        genre: track.genre || null
      }, e.currentTarget);
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
// SISTEMA DE PERFIL DE ARTISTA (SPOTIFY / APPLE MUSIC STYLE)
// ========================================================
async function openArtistProfile(artistName) {
  if (!artistName) return;
  const cleanName = artistName.replace(/\s*(feat\.|ft\.|con|&|,).*/i, '').trim() || artistName.trim();

  state.previousMode = state.currentMode;

  const artistDetailView = document.getElementById('artistDetailView');
  const artistHeroContent = document.getElementById('artistHeroContent');
  const artistContentContainer = document.getElementById('artistContentContainer');

  if (homeSection) homeSection.classList.add('hidden');
  if (catalogSection) catalogSection.classList.add('hidden');
  if (albumDetailView) albumDetailView.classList.add('hidden');
  if (artistDetailView) artistDetailView.classList.remove('hidden');

  window.scrollTo({ top: 120, behavior: 'smooth' });

  if (artistHeroContent) {
    artistHeroContent.innerHTML = `
      <div style="text-align: center; width: 100%; padding: 3rem 0;">
        <div class="vice-spinner"><div class="inner-vi">VI</div></div>
        <p style="font-family: var(--font-mono); color: var(--vice-pink); margin-top: 1rem;">CARGANDO PERFIL OFICIAL DE ${cleanName.toUpperCase()}...</p>
      </div>
    `;
  }
  if (artistContentContainer) artistContentContainer.innerHTML = '';

  try {
    const artistSearch = await fetchDeezerJsonp(`/search/artist?q=${encodeURIComponent(cleanName)}&limit=1`);
    const artistObj = (artistSearch && artistSearch.data && artistSearch.data.length > 0) ? artistSearch.data[0] : null;

    const artistId = artistObj ? artistObj.id : null;
    const artistPhoto = artistObj ? (artistObj.picture_xl || artistObj.picture_big) : 'https://via.placeholder.com/400/1a0933/ff2a85?text=VICE';
    const artistFans = artistObj ? (artistObj.nb_fan ? `${artistObj.nb_fan.toLocaleString()} seguidores` : 'Oficial') : 'Leonida State';

    if (artistHeroContent) {
      artistHeroContent.innerHTML = `
        <div class="artist-hero-card">
          <div class="artist-hero-backdrop" style="background-image: url('${artistPhoto}');"></div>
          <div class="artist-avatar-wrap">
            <img src="${artistPhoto}" alt="${cleanName}" class="artist-avatar-img" onerror="this.src='https://via.placeholder.com/400/1a0933/ff2a85?text=VICE'">
          </div>
          <div class="artist-hero-info">
            <div class="artist-badge-verified">
              <span>✓ ARTISTA VERIFICADO 🇨🇴</span>
            </div>
            <h2 class="artist-hero-name">${cleanName}</h2>
            <div class="artist-hero-stats">
              <span>👥 ${artistFans}</span>
              <span>📀 Audio Master Studio 1000px HD</span>
            </div>
          </div>
        </div>
      `;
    }

    setupArtistNavTabs(cleanName, artistId);
    switchArtistTab('top', cleanName, artistId);

  } catch (err) {
    console.error('Error cargando perfil de artista:', err);
    if (artistHeroContent) {
      artistHeroContent.innerHTML = `<p style="color: #ff2a85; padding: 2rem;">Error al cargar perfil de ${cleanName}: ${err.message}</p>`;
    }
  }
}

function setupArtistNavTabs(artistName, artistId) {
  const tabs = [
    { id: 'btnArtistTabTop', mode: 'top' },
    { id: 'btnArtistTabAlbums', mode: 'albums' },
    { id: 'btnArtistTabRemixes', mode: 'remixes' },
    { id: 'btnArtistTabAll', mode: 'all' }
  ];

  tabs.forEach(t => {
    const btn = document.getElementById(t.id);
    if (btn) {
      btn.onclick = () => {
        tabs.forEach(other => {
          const ob = document.getElementById(other.id);
          if (ob) ob.classList.remove('active');
        });
        btn.classList.add('active');
        switchArtistTab(t.mode, artistName, artistId);
      };
    }
  });

  const btnTop = document.getElementById('btnArtistTabTop');
  if (btnTop) btnTop.classList.add('active');
}

async function switchArtistTab(mode, artistName, artistId) {
  const artistContentContainer = document.getElementById('artistContentContainer');
  if (!artistContentContainer) return;

  artistContentContainer.innerHTML = `
    <div style="text-align: center; width: 100%; padding: 2.5rem 0;">
      <div class="vice-spinner"><div class="inner-vi">VI</div></div>
      <p style="font-family: var(--font-mono); color: var(--vice-cyan); margin-top: 1rem;">CARGANDO CONTENIDO...</p>
    </div>
  `;

  try {
    if (mode === 'top') {
      let tracksData = null;
      if (artistId) {
        tracksData = await fetchDeezerJsonp(`/artist/${artistId}/top?limit=10`);
      }
      if (!tracksData || !tracksData.data || tracksData.data.length === 0) {
        tracksData = await fetchDeezerJsonp(`/search?q=${encodeURIComponent(artistName)}&limit=10`);
      }

      const tracks = tracksData?.data || [];
      if (tracks.length === 0) {
        artistContentContainer.innerHTML = `<p style="padding: 2rem; color: var(--text-dim); text-align: center;">No se encontraron canciones destacadas.</p>`;
        return;
      }

      const wrapper = document.createElement('div');
      wrapper.className = 'top-ranking-wrapper';
      wrapper.innerHTML = `
        <h3 style="font-family: var(--font-logo); font-style: italic; font-size: 1.3rem; margin-bottom: 1rem; color: #fff;">
          🔥 CANCIONES MÁS POPULARES DE ${artistName.toUpperCase()}
        </h3>
        <div class="top-ranking-list"></div>
      `;
      const listEl = wrapper.querySelector('.top-ranking-list');

      tracks.forEach((track, index) => {
        const row = document.createElement('div');
        row.className = `ranking-row ${index === 0 ? 'rank-first' : ''}`;
        const rankStr = index < 9 ? `0${index + 1}` : `${index + 1}`;
        const cover = track.album ? (track.album.cover_xl || track.album.cover_big) : 'https://via.placeholder.com/80/1a0933/ff2a85?text=VI';
        const albumTitle = track.album ? track.album.title : 'Sencillo';
        const albumId = track.album ? `deezer_${track.album.id}` : null;
        const durationFormatted = formatTime(track.duration || 0);

        row.innerHTML = `
          <div class="ranking-num">${index === 0 ? '👑 01' : rankStr}</div>
          <div class="ranking-track-cell">
            <div class="ranking-thumb-wrap">
              <img src="${cover}" alt="${track.title}" class="ranking-thumb-img" loading="lazy">
              <div class="ranking-thumb-play">▶</div>
            </div>
            <div class="ranking-track-meta">
              <span class="ranking-track-title" title="${track.title}">${track.title}</span>
              <span class="ranking-track-artist">${track.artist ? track.artist.name : artistName}</span>
            </div>
          </div>
          <div class="ranking-album-cell">
            <span class="ranking-album-link" title="${albumTitle}">${albumTitle}</span>
          </div>
          <div class="ranking-time-cell">${durationFormatted}</div>
          <div class="ranking-actions-cell">
            <button class="btn-rank-action btn-rank-play" title="Escuchar preview">▶ <span>PREVIEW</span></button>
            <button class="btn-rank-action btn-rank-full" title="Escuchar completa">🎧 <span>COMPLETA</span></button>
            <button class="btn-rank-action btn-dl-vip" title="Descargar MP3 320 kbps (VIP)">📥 <span>MP3 320</span></button>
          </div>
        `;

        const playPrev = () => {
          loadTrack({
            title: track.title,
            artist: track.artist ? track.artist.name : artistName,
            cover: cover,
            audioUrl: track.preview,
            album: albumTitle
          });
        };

        row.querySelector('.ranking-thumb-wrap').addEventListener('click', (e) => { e.stopPropagation(); playPrev(); });
        row.querySelector('.btn-rank-play').addEventListener('click', (e) => { e.stopPropagation(); playPrev(); });
        row.querySelector('.btn-rank-full').addEventListener('click', (e) => {
          e.stopPropagation();
          playFullSong(track.artist ? track.artist.name : artistName, track.title, cover, albumTitle);
        });
        row.querySelector('.btn-dl-vip').addEventListener('click', (e) => {
          e.stopPropagation();
          downloadMp3_320(track.artist ? track.artist.name : artistName, track.title, track.preview, null, {
            album: albumTitle,
            coverUrl: cover
          }, e.currentTarget);
        });

        if (albumId) {
          const albLink = row.querySelector('.ranking-album-link');
          if (albLink) {
            albLink.style.cursor = 'pointer';
            albLink.addEventListener('click', (e) => {
              e.stopPropagation();
              openAlbumDetail(albumId);
            });
          }
        }

        listEl.appendChild(row);
      });

      artistContentContainer.innerHTML = '';
      artistContentContainer.appendChild(wrapper);

    } else if (mode === 'albums') {
      const albData = await fetchDeezerJsonp(`/search/album?q=${encodeURIComponent(artistName)}&limit=25`);
      const albums = albData?.data || [];

      if (albums.length === 0) {
        artistContentContainer.innerHTML = `<p style="padding: 2rem; color: var(--text-dim); text-align: center;">No se encontraron álbumes registrados para este artista.</p>`;
        return;
      }

      const grid = document.createElement('div');
      grid.className = 'results-grid';

      albums.forEach(a => {
        const card = document.createElement('div');
        card.className = 'album-card';
        const cover = a.cover_xl || a.cover_big || a.cover_medium;
        card.innerHTML = `
          <div class="album-cover-wrapper" title="Clic para ver discografía">
            <img src="${cover}" alt="${a.title}" class="album-cover-img" loading="lazy">
            <div class="cover-overlay-hint"><span>💿 ABRIR ÁLBUM</span></div>
            <div class="cover-flac-badge">1000PX HD</div>
          </div>
          <div class="album-info">
            <h4 class="album-title" title="${a.title}">${a.title}</h4>
            <p class="album-artist">${a.artist ? a.artist.name : artistName}</p>
            <div class="album-meta">
              <span class="album-tracks-count">${a.nb_tracks || '—'} canciones</span>
              <span class="album-type-badge">ÁLBUM</span>
            </div>
          </div>
        `;
        card.addEventListener('click', () => openAlbumDetail(`deezer_${a.id}`));
        grid.appendChild(card);
      });

      artistContentContainer.innerHTML = `
        <h3 style="font-family: var(--font-logo); font-style: italic; font-size: 1.3rem; margin-bottom: 0.5rem; color: #fff;">
          📀 DISCOGRAFÍA Y ÁLBUMES DE ${artistName.toUpperCase()}
        </h3>
      `;
      artistContentContainer.appendChild(grid);

    } else if (mode === 'remixes') {
      const remixData = await fetchDeezerJsonp(`/search?q=${encodeURIComponent(artistName + ' remix')}&limit=25`);
      const tracks = remixData?.data || [];

      if (tracks.length === 0) {
        artistContentContainer.innerHTML = `<p style="padding: 2rem; color: var(--text-dim); text-align: center;">No se encontraron remixes oficiales de este artista.</p>`;
        return;
      }

      renderArtistTrackCards(tracks, artistName, '🎛️ REMIXES OFICIALES DE', artistContentContainer);

    } else if (mode === 'all') {
      const allData = await fetchDeezerJsonp(`/search?q=${encodeURIComponent(artistName)}&limit=35`);
      const tracks = allData?.data || [];

      if (tracks.length === 0) {
        artistContentContainer.innerHTML = `<p style="padding: 2rem; color: var(--text-dim); text-align: center;">No se encontraron canciones.</p>`;
        return;
      }

      renderArtistTrackCards(tracks, artistName, '🎵 TODAS LAS CANCIONES DE', artistContentContainer);
    }

  } catch (tabErr) {
    console.error('Error al cambiar pestaña de artista:', tabErr);
    artistContentContainer.innerHTML = `<p style="padding: 2rem; color: var(--text-dim); text-align: center;">Error al cargar contenido.</p>`;
  }
}

function renderArtistTrackCards(tracks, artistName, titlePrefix, container) {
  container.innerHTML = `
    <h3 style="font-family: var(--font-logo); font-style: italic; font-size: 1.3rem; margin-bottom: 0.5rem; color: #fff;">
      ${titlePrefix} ${artistName.toUpperCase()}
    </h3>
  `;
  const grid = document.createElement('div');
  grid.className = 'results-grid';

  tracks.forEach(track => {
    const card = document.createElement('div');
    card.className = 'album-card track-card-modern';
    const cover = track.album ? (track.album.cover_xl || track.album.cover_big) : (track.artist ? track.artist.picture_xl : '');
    const albumTitle = track.album ? track.album.title : 'Sencillo';
    const albumId = track.album ? `deezer_${track.album.id}` : null;

    card.innerHTML = `
      <div class="album-cover-wrapper" title="Clic para escuchar o ver álbum">
        <img class="album-cover" src="${cover}" alt="${track.title}" loading="lazy">
        <div class="cover-overlay-hint"><span>${albumId ? '💿 VER ÁLBUM' : '▶ ESCUCHAR'}</span></div>
      </div>
      <div class="album-info">
        <h3 class="album-title" title="${track.title}">${track.title}</h3>
        <p class="album-artist">${track.artist ? track.artist.name : artistName}</p>
        <div class="track-card-actions">
          <div class="actions-row-play">
            <button class="btn-card-action btn-card-preview btn-single-play" title="Escuchar muestra">▶ <span>PREVIEW</span></button>
            <button class="btn-card-action btn-card-full btn-single-full" title="Escuchar completa">🎧 <span>COMPLETA</span></button>
          </div>
          <div class="actions-row-dl">
            <button class="btn-card-action btn-card-mp3 btn-single-mp3" title="Descargar MP3 320 kbps (VIP)">📥 <span>MP3 320</span></button>
            ${albumId ? `
              <button class="btn-card-action btn-card-album btn-go-to-album" title="Ver álbum">💿 <span>ÁLBUM</span></button>
            ` : `
              <button class="btn-card-action btn-card-flac btn-single-flac" title="Descargar en FLAC">⚡ <span>FLAC</span></button>
            `}
          </div>
        </div>
      </div>
    `;

    card.querySelector('.album-cover-wrapper').addEventListener('click', (e) => {
      e.stopPropagation();
      if (albumId) openAlbumDetail(albumId);
      else loadTrack({ title: track.title, artist: track.artist ? track.artist.name : artistName, cover, audioUrl: track.preview, album: albumTitle });
    });

    if (albumId) {
      const albBtn = card.querySelector('.btn-go-to-album');
      if (albBtn) albBtn.addEventListener('click', (e) => { e.stopPropagation(); openAlbumDetail(albumId); });
    }

    card.querySelector('.btn-single-play').addEventListener('click', (e) => {
      e.stopPropagation();
      loadTrack({ title: track.title, artist: track.artist ? track.artist.name : artistName, cover, audioUrl: track.preview, album: albumTitle });
    });

    card.querySelector('.btn-single-full').addEventListener('click', (e) => {
      e.stopPropagation();
      playFullSong(track.artist ? track.artist.name : artistName, track.title, cover, albumTitle);
    });

    card.querySelector('.btn-single-mp3').addEventListener('click', (e) => {
      e.stopPropagation();
      downloadMp3_320(track.artist ? track.artist.name : artistName, track.title, track.preview, null, { album: albumTitle, coverUrl: cover }, e.currentTarget);
    });

    grid.appendChild(card);
  });

  container.appendChild(grid);
}

// ========================================================
// SISTEMA OFICIAL MEDIA SESSION (Control Nativo Móvil, Pantalla de Bloqueo y Chrome)
// Oculta 100% cualquier rastro o procedencia de YouTube
// ========================================================
let mediaSessionActionsConfigured = false;

function setupMediaSessionActions() {
  if (mediaSessionActionsConfigured || !('mediaSession' in navigator)) return;
  mediaSessionActionsConfigured = true;

  const handlers = [
    ['play', () => {
      togglePlayPause();
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
    }],
    ['pause', () => {
      togglePlayPause();
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
    }],
    ['previoustrack', () => {
      seekDelta(-10);
    }],
    ['nexttrack', () => {
      seekDelta(10);
    }],
    ['seekbackward', (details) => {
      seekDelta(-(details.seekOffset || 10));
    }],
    ['seekforward', (details) => {
      seekDelta(details.seekOffset || 10);
    }],
    ['seekto', (details) => {
      if (details.seekTime !== undefined) {
        if ((state.playbackSource === 'full_yt' || state.playbackSource === 'full') && ytPlayer && typeof ytPlayer.seekTo === 'function') {
          ytPlayer.seekTo(details.seekTime, true);
        } else if (state.audio) {
          state.audio.currentTime = details.seekTime;
        }
      }
    }]
  ];

  for (const [action, handler] of handlers) {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch (e) {
      // Ignorar si el navegador no soporta alguna acción específica
    }
  }
}

function updateMediaSession(track) {
  if (!('mediaSession' in navigator)) return;
  try {
    const rawCover = (track && track.cover) || (state.currentTrack && state.currentTrack.cover) || (state.currentAlbum && state.currentAlbum.coverXl) || 'https://via.placeholder.com/512/1a0933/ff2a85?text=VI';
    let coverUrl = rawCover;
    if (coverUrl && coverUrl.startsWith('http://')) {
      coverUrl = coverUrl.replace('http://', 'https://');
    }

    const title = (track && track.title) || (state.currentTrack && state.currentTrack.title) || 'Vice Music';
    const artist = (track && track.artist) || (state.currentTrack && state.currentTrack.artist) || 'Vice Music Official';
    const album = (track && track.album) || (state.currentAlbum && state.currentAlbum.title) || title;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: title,
      artist: artist,
      album: album,
      artwork: [
        { src: coverUrl, sizes: '96x96', type: 'image/jpeg' },
        { src: coverUrl, sizes: '128x128', type: 'image/jpeg' },
        { src: coverUrl, sizes: '192x192', type: 'image/jpeg' },
        { src: coverUrl, sizes: '256x256', type: 'image/jpeg' },
        { src: coverUrl, sizes: '384x384', type: 'image/jpeg' },
        { src: coverUrl, sizes: '512x512', type: 'image/jpeg' },
        { src: coverUrl, sizes: '1000x1000', type: 'image/jpeg' }
      ]
    });

    navigator.mediaSession.playbackState = state.isPlaying ? 'playing' : 'paused';
    setupMediaSessionActions();
  } catch (err) {
    console.warn('[MediaSession] Error al sincronizar metadatos:', err.message);
  }
}

function updateMediaSessionPosition(position, duration) {
  if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
  try {
    if (duration > 0 && position >= 0 && position <= duration) {
      navigator.mediaSession.setPositionState({
        duration: duration,
        playbackRate: state.currentSpeed || 1,
        position: position
      });
    }
  } catch (e) {}
}

// ========================================================
// REPRODUCTOR UNIFICADO (PREVIEW 30S + CANCIÓN COMPLETA)
// ========================================================

function loadTrack(track) {
  // Detener YouTube si estaba sonando
  if ((state.playbackSource === 'full' || state.playbackSource === 'full_yt') && ytPlayer && typeof ytPlayer.pauseVideo === 'function') {
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

  const labelText = (state.currentAlbum && state.currentAlbum.label) || (track && track.label) || '';
  if (playerLabel) {
    if (labelText) {
      playerLabel.innerText = '🏷️ ' + labelText;
      playerLabel.style.display = 'inline-block';
    } else {
      playerLabel.style.display = 'none';
    }
  }

  updateMediaSession(track);

  if (track.audioUrl) {
    state.audio.src = track.audioUrl;
    state.audio.playbackRate = state.currentSpeed;
    state.audio.play().then(() => {
      setPlayingState(true);
      updateMediaSession(track);
    }).catch(() => setPlayingState(false));
  }
}

// REPRODUCIR CANCIÓN 100% COMPLETA (RESPUESTA INSTANTÁNEA + METADATOS LIMPIOS HD)
async function playFullSong(artist, title, cover = null, album = null) {
  // Pausar audio de muestra si está sonando
  if (state.audio) {
    state.audio.pause();
  }

  state.playbackSource = 'full';
  const trackObj = {
    title,
    artist,
    cover: cover || (state.currentTrack && state.currentTrack.cover) || (state.currentAlbum && state.currentAlbum.coverXl),
    album: album || (state.currentAlbum && state.currentAlbum.title) || title
  };

  state.currentTrack = trackObj;

  playerTitle.innerText = title;
  playerArtist.innerText = artist;
  if (trackObj.cover) {
    playerCover.src = trackObj.cover;
  }
  playerModeBadge.innerText = '🎧 CANCIÓN COMPLETA';
  playerModeBadge.className = 'spec-pill gold';

  const labelTextFull = (state.currentAlbum && state.currentAlbum.label) || '';
  if (playerLabel) {
    if (labelTextFull) {
      playerLabel.innerText = '🏷️ ' + labelTextFull;
      playerLabel.style.display = 'inline-block';
    } else {
      playerLabel.style.display = 'none';
    }
  }
  currentTimeLabel.innerText = '00:00';
  totalTimeLabel.innerText = 'Cargando...';
  progressFill.style.width = '0%';
  progressThumb.style.left = '0%';

  updateMediaSession(trackObj);
  showToast('🎧 Sintonizando canción completa: ' + title + '...');

  try {
    const res = await fetch('/api/fullaudio?q=' + encodeURIComponent(artist + ' ' + title));
    const data = await res.json();

    if (data.videoId) {
      state.currentTrack.videoId = data.videoId;
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
          updateMediaSession(trackObj);
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

// ========================================================
// CONTROLADOR DE PROGRESO DE DESCARGA EN VIVO (BARRA NANO + WIDGET FLOTANTE)
// ========================================================
let isDownloadingMp3 = false;
let dlProgressTimer = null;

function setDownloadProgress(percent, stepText, trackName) {
  const topBar = document.getElementById('topProgressBar');
  const topFill = document.getElementById('topProgressFill');
  const widget = document.getElementById('dlFloatingWidget');
  const widgetTrack = document.getElementById('dlWidgetTrack');
  const widgetPercent = document.getElementById('dlWidgetPercent');
  const widgetFill = document.getElementById('dlWidgetBarFill');
  const widgetStep = document.getElementById('dlWidgetStep');

  if (topBar && topFill) {
    topBar.classList.add('active');
    topFill.style.width = `${percent}%`;
  }

  if (widget) {
    widget.classList.remove('hidden');
    if (widgetTrack && trackName) widgetTrack.innerText = trackName;
    if (widgetPercent) widgetPercent.innerText = `${Math.round(percent)}%`;
    if (widgetFill) widgetFill.style.width = `${percent}%`;
    if (widgetStep && stepText) widgetStep.innerText = stepText;
  }
}

function hideDownloadProgress() {
  if (dlProgressTimer) {
    clearInterval(dlProgressTimer);
    dlProgressTimer = null;
  }
  const topBar = document.getElementById('topProgressBar');
  const topFill = document.getElementById('topProgressFill');
  const widget = document.getElementById('dlFloatingWidget');

  if (topFill) topFill.style.width = '100%';
  if (widget) {
    const widgetPercent = document.getElementById('dlWidgetPercent');
    const widgetFill = document.getElementById('dlWidgetBarFill');
    const widgetStep = document.getElementById('dlWidgetStep');
    if (widgetPercent) widgetPercent.innerText = '100%';
    if (widgetFill) widgetFill.style.width = '100%';
    if (widgetStep) widgetStep.innerText = '¡Descarga iniciada con éxito!';
  }

  setTimeout(() => {
    if (topBar) topBar.classList.remove('active');
    if (widget) widget.classList.add('hidden');
    if (topFill) topFill.style.width = '0%';
  }, 2200);
}

// ========================================================
// DESCARGAR AUDIO 320 KBPS CON METADATOS OFICIALES Y CARÁTULA HD 1000PX
// (100% EN LA MISMA PÁGINA, CON BARRA DE PROGRESO EN VIVO Y CONTROL ANTI-SPAM)
// ========================================================
async function downloadMp3_320(artist, title, audioUrl = null, videoId = null, extraMeta = {}, triggerBtn = null) {
  const displayTitle = title || 'Canción';

  // Verificación de credenciales VIP para descargar
  if (!isUserLoggedIn()) {
    openLoginModal(`Inicia sesión como VIP para descargar "${artist} - ${displayTitle}" en MP3 320 kbps.`, () => {
      downloadMp3_320(artist, title, audioUrl, videoId, extraMeta, triggerBtn);
    });
    return;
  }

  if (isDownloadingMp3) {
    showToast(`⏳ Ya hay una descarga en curso. Espera unos segundos para no saturar tu conexión.`);
    return;
  }

  isDownloadingMp3 = true;
  const safeName = `${artist} - ${title}`.replace(/[^\w\s\-\.áéíóúñÁÉÍÓÚÑ]/g, '').trim() || 'cancion';
  const originalBtnHtml = triggerBtn ? triggerBtn.innerHTML : null;

  if (triggerBtn) {
    triggerBtn.disabled = true;
    triggerBtn.innerHTML = `<span>⏳ 320K...</span>`;
    triggerBtn.style.opacity = '0.7';
  }

  // Iniciar barrita de progreso visual inmediata
  let currentProg = 8;
  setDownloadProgress(currentProg, 'Iniciando conexión con satélite de audio...', safeName);

  dlProgressTimer = setInterval(() => {
    if (currentProg < 30) {
      currentProg += 3.5;
      setDownloadProgress(currentProg, 'Extrayendo audio estéreo oficial de alta fidelidad...', safeName);
    } else if (currentProg < 65) {
      currentProg += 2;
      setDownloadProgress(currentProg, 'Codificando a 320 kbps (Estudio Master)...', safeName);
    } else if (currentProg < 88) {
      currentProg += 1.2;
      setDownloadProgress(currentProg, 'Incrustando carátula HD 1000px y metadatos oficiales...', safeName);
    } else if (currentProg < 96) {
      currentProg += 0.4;
      setDownloadProgress(currentProg, 'Transfiriendo archivo MP3 completo a tu dispositivo...', safeName);
    }
  }, 450);

  showToast(`⚡ Generando MP3 320 kbps: ${displayTitle}... Observa la barra de progreso.`);

  try {
    const albumName = extraMeta.album || (state.currentTrack ? state.currentTrack.album : '') || title;
    const albumArtistName = extraMeta.albumArtist || artist;
    const publisherName = extraMeta.publisher || extraMeta.label || '';
    const composerName = extraMeta.composer || '';
    const isrcCode = extraMeta.isrc || '';
    const releaseYear = extraMeta.year || (state.currentTrack ? state.currentTrack.releaseDate : '') || new Date().getFullYear();
    const exactReleaseDate = extraMeta.releaseDate || (state.currentTrack ? state.currentTrack.releaseDate : '') || '';
    const trackNumber = extraMeta.track || '';
    const totalTracksCount = extraMeta.totalTracks || '';
    const diskNumber = extraMeta.disk || '1';
    const musicGenre = extraMeta.genre || '';
    const coverTarget = extraMeta.coverUrl || (state.currentTrack ? state.currentTrack.cover : '');
    const targetVideoId = videoId || (state.currentTrack && state.currentTrack.title === title ? state.currentTrack.videoId : '') || '';

    // URL de descarga directa y nativa de nuestro servidor con metadatos completos estilo Apple Music
    const downloadApiUrl = `/api/download-mp3?q=${encodeURIComponent(artist + ' ' + title)}`
      + `&videoId=${encodeURIComponent(targetVideoId)}`
      + `&title=${encodeURIComponent(title || '')}`
      + `&artist=${encodeURIComponent(artist || '')}`
      + `&albumArtist=${encodeURIComponent(albumArtistName || '')}`
      + `&album=${encodeURIComponent(albumName || '')}`
      + `&publisher=${encodeURIComponent(publisherName || '')}`
      + `&composer=${encodeURIComponent(composerName || '')}`
      + `&isrc=${encodeURIComponent(isrcCode || '')}`
      + `&year=${encodeURIComponent(String(releaseYear) || '')}`
      + `&releaseDate=${encodeURIComponent(String(exactReleaseDate) || '')}`
      + `&track=${encodeURIComponent(String(trackNumber) || '')}`
      + `&totalTracks=${encodeURIComponent(String(totalTracksCount) || '')}`
      + `&disk=${encodeURIComponent(String(diskNumber) || '')}`
      + `&genre=${encodeURIComponent(musicGenre || '')}`
      + `&cover=${encodeURIComponent(coverTarget || '')}`
      + `&filename=${encodeURIComponent(safeName)}`;

    // Petición asíncrona directa para asegurar descarga limpia en la misma página
    const res = await fetch(downloadApiUrl);
    if (!res.ok) {
      let msg = 'Error en el servidor al generar el archivo';
      try {
        const errJson = await res.json();
        if (errJson.error) msg = errJson.error;
      } catch (_) {}
      throw new Error(msg);
    }

    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `${safeName}.mp3`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    setTimeout(() => URL.revokeObjectURL(blobUrl), 15000);

    hideDownloadProgress();
    showToast(`✅ ¡Descarga completada con éxito: ${safeName}.mp3!`);
  } catch (err) {
    if (dlProgressTimer) {
      clearInterval(dlProgressTimer);
      dlProgressTimer = null;
    }
    const topBar = document.getElementById('topProgressBar');
    const widget = document.getElementById('dlFloatingWidget');
    if (topBar) topBar.classList.remove('active');
    if (widget) widget.classList.add('hidden');

    console.error('[downloadMp3_320]', err);
    showToast('❌ Error al descargar MP3: ' + err.message);
  } finally {
    isDownloadingMp3 = false;
    if (triggerBtn && originalBtnHtml !== null) {
      triggerBtn.disabled = false;
      triggerBtn.innerHTML = originalBtnHtml;
      triggerBtn.style.opacity = '1';
    }
  }
}

function togglePlayPause() {
  if (state.playbackSource === 'full') {
    if (!ytPlayer || typeof ytPlayer.getPlayerState !== 'function') return;
    const ytState = ytPlayer.getPlayerState();
    if (ytState === 1) { // está reproduciendo
      ytPlayer.pauseVideo();
      setPlayingState(false);
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
    } else {
      ytPlayer.playVideo();
      setPlayingState(true);
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
      if (state.currentTrack) updateMediaSession(state.currentTrack);
    }
  } else {
    if (!state.audio.src) return;
    if (state.audio.paused) {
      state.audio.play();
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
      if (state.currentTrack) updateMediaSession(state.currentTrack);
    } else {
      state.audio.pause();
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
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
    updateMediaSessionPosition(target, dur);
  } else {
    if (!state.audio.duration) return;
    state.audio.currentTime = Math.max(0, Math.min(state.audio.duration, state.audio.currentTime + seconds));
    updateMediaSessionPosition(state.audio.currentTime, state.audio.duration);
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
  if ((state.playbackSource === 'full' || state.playbackSource === 'full_yt') && ytPlayer && typeof ytPlayer.setPlaybackRate === 'function') {
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
    updateMediaSessionPosition(current, total);
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

// ========================================================
// CARGADOR HOME // TOP 10 COLOMBIA & LANZAMIENTOS (SPOTIFY / APPLE STYLE)
// ========================================================
async function loadHomeContent() {
  const topRankingList = document.getElementById('topRankingList');
  const homeTrendingGrid = document.getElementById('homeTrendingGrid');
  if (!topRankingList) return;

  try {
    let tracks = [];
    let albums = [];

    // 1. Probar backend Render
    try {
      const res = await fetch('/api/top-colombia');
      const data = await res.json();
      if (data && data.success && Array.isArray(data.tracks) && data.tracks.length > 0) {
        tracks = data.tracks;
        albums = data.albums || [];
      }
    } catch (e) {
      console.warn('Backend top-colombia no respondió, intentando JSONP:', e.message);
    }

    // 2. Fallback JSONP directo con playlist oficial Deezer Top Colombia (1116188451)
    if (tracks.length === 0) {
      const dzData = await fetchDeezerJsonp('/playlist/1116188451');
      if (dzData && dzData.tracks && Array.isArray(dzData.tracks.data)) {
        tracks = dzData.tracks.data.slice(0, 10).map((t, idx) => ({
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
        }));
      }
    }

    // Renderizar Ranking Top 10
    topRankingList.innerHTML = '';
    if (tracks.length === 0) {
      topRankingList.innerHTML = '<p style="padding: 2.5rem; color: var(--text-dim); text-align: center; font-family: var(--font-mono);">Conectando con el satélite de audio... Vuelve a intentarlo en unos instantes.</p>';
    } else {
      tracks.forEach((track, index) => {
        const row = document.createElement('div');
        row.className = `ranking-row ${index === 0 ? 'rank-first' : ''}`;
        
        const rankNumStr = track.rank < 10 ? `0${track.rank}` : `${track.rank}`;
        const durationFormatted = formatTime(track.duration);

        row.innerHTML = `
          <div class="ranking-num">
            ${index === 0 ? '👑 01' : rankNumStr}
          </div>

          <div class="ranking-track-cell">
            <div class="ranking-thumb-wrap">
              <img src="${track.coverXl || 'https://via.placeholder.com/80/1a0933/ff2a85?text=VI'}" alt="${track.title}" class="ranking-thumb-img" loading="lazy">
              <div class="ranking-thumb-play">▶</div>
            </div>
            <div class="ranking-track-meta">
              <span class="ranking-track-title" title="${track.title}">${track.title}</span>
              <span class="ranking-track-artist artist-clickable" data-artist="${track.artist}" title="Ver discografía y perfil de ${track.artist}">${track.artist}</span>
            </div>
          </div>

          <div class="ranking-album-cell">
            <a href="javascript:void(0)" class="ranking-album-link" title="${track.album}">${track.album}</a>
          </div>

          <div class="ranking-time-cell">
            ${durationFormatted}
          </div>

          <div class="ranking-actions-cell">
            <button class="btn-rank-action btn-rank-play" title="Escuchar preview">
              ▶ <span>PREVIEW</span>
            </button>
            <button class="btn-rank-action btn-rank-full" title="Escuchar canción completa">
              🎧 <span>COMPLETA</span>
            </button>
            <button class="btn-rank-action btn-dl-vip" title="Descargar MP3 320 kbps (VIP)">
              📥 <span>MP3 320</span>
            </button>
          </div>
        `;

        const playPreview = () => {
          loadTrack({
            title: track.title,
            artist: track.artist,
            cover: track.coverXl,
            audioUrl: track.preview,
            album: track.album,
            duration: track.duration,
            label: 'Top Colombia Official'
          });
        };

        row.querySelector('.ranking-thumb-wrap').addEventListener('click', (e) => {
          e.stopPropagation();
          playPreview();
        });

        row.querySelector('.btn-rank-play').addEventListener('click', (e) => {
          e.stopPropagation();
          playPreview();
        });

        row.querySelector('.btn-rank-full').addEventListener('click', (e) => {
          e.stopPropagation();
          playFullSong(track.artist, track.title, track.coverXl, track.album);
        });

        row.querySelector('.btn-dl-vip').addEventListener('click', (e) => {
          e.stopPropagation();
          downloadMp3_320(track.artist, track.title, track.preview, null, {
            album: track.album,
            coverUrl: track.coverXl
          }, e.currentTarget);
        });

        const artistLink = row.querySelector('.ranking-track-artist');
        if (artistLink) {
          artistLink.addEventListener('click', (e) => {
            e.stopPropagation();
            openArtistProfile(track.artist);
          });
        }

        const albumLink = row.querySelector('.ranking-album-link');
        if (albumLink && track.albumId) {
          albumLink.addEventListener('click', (e) => {
            e.stopPropagation();
            openAlbumDetail(track.albumId);
          });
        }

        topRankingList.appendChild(row);
      });
    }

    // Renderizar Álbumes destacados de Colombia
    if (homeTrendingGrid) {
      if (!albums || albums.length === 0) {
        const [dzBlessd, dzFeid, dzKarol] = await Promise.all([
          fetchDeezerJsonp('/search/album?q=Blessd+SUPERSTAR&limit=2'),
          fetchDeezerJsonp('/search/album?q=Feid+FERXXO&limit=2'),
          fetchDeezerJsonp('/search/album?q=Karol+G&limit=2')
        ]);
        const combo = [
          ...(dzBlessd?.data || []),
          ...(dzFeid?.data || []),
          ...(dzKarol?.data || [])
        ];
        albums = combo.map(a => ({
          id: `deezer_${a.id}`,
          deezerId: a.id,
          title: a.title,
          artist: a.artist ? a.artist.name : 'Artista',
          coverXl: a.cover_xl || a.cover_big || a.cover_medium,
          nbTracks: a.nb_tracks || '—'
        }));
      }

      homeTrendingGrid.innerHTML = '';
      albums.slice(0, 6).forEach(album => {
        const card = document.createElement('div');
        card.className = 'album-card';
        card.innerHTML = `
          <div class="album-cover-wrapper" title="Clic para ver discografía">
            <img src="${album.coverXl || 'https://via.placeholder.com/300/1a0933/ff2a85?text=VI'}" alt="${album.title}" class="album-cover-img" loading="lazy">
            <div class="cover-flac-badge">1000PX HD</div>
            <div class="album-hover-overlay">
              <span class="btn-open-album-hint">VER DISCOGRAFÍA</span>
            </div>
          </div>
          <div class="album-info">
            <h4 class="album-title" title="${album.title}">${album.title}</h4>
            <p class="album-artist artist-clickable" data-artist="${album.artist}" title="Ver discografía y perfil de ${album.artist}">${album.artist}</p>
            <div class="album-meta">
              <span class="album-tracks-count">${album.nbTracks} canciones</span>
              <span class="album-type-badge">ÁLBUM</span>
            </div>
          </div>
        `;
        card.addEventListener('click', (e) => {
          if (e.target.closest('.artist-clickable')) return;
          openAlbumDetail(album.id);
        });

        const albArtistLink = card.querySelector('.album-artist');
        if (albArtistLink) {
          albArtistLink.addEventListener('click', (e) => {
            e.stopPropagation();
            openArtistProfile(album.artist);
          });
        }

        homeTrendingGrid.appendChild(card);
      });
    }

  } catch (err) {
    console.error('Error cargando Home Content:', err);
  }
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
