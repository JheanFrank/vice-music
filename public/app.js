// ========================================================
// VICE MUSIC // GTA VI EDITION (FULL ALBUMS & FLAC)
// ========================================================

const state = {
  currentMode: 'home', // 'home' | 'albums' | 'tracks' | 'playlist'
  currentTrack: null,
  currentAlbum: null,
  isPlaying: false,
  playbackSource: 'preview', // 'preview' | 'full' | 'full_stream'
  currentSpeed: 1, // 1 | 1.25 | 1.5 | 2
  audioA: null,
  audioB: null,
  activeAudio: null,
  fadeAudio: null,
  crossfadeEnabled: true,
  crossfadeSec: 10,
  isCrossfading: false,
  isPreloadingNext: false,
  nextQueuedTrack: null,
  results: [],
  rankingTracks: [],
  queue: [],
  history: [],
  smartDjEnabled: true,
  userPlaylist: [],
  activeCoverflowIndex: 0,
  isShuffle: false,
  playedShuffleIds: [],
  authMode: 'login', // 'login' | 'register'
  selectedTracks: new Map() // key -> track object
};

const rawAudioA = document.getElementById('audioElementA') || document.getElementById('audioElement');
const rawAudioB = document.getElementById('audioElementB');
state.audioA = rawAudioA;
state.audioB = rawAudioB;
state.activeAudio = rawAudioA;
state.fadeAudio = rawAudioB;

Object.defineProperty(state, 'audio', {
  get() { return state.activeAudio || state.audioA; },
  set(el) { state.activeAudio = el; },
  configurable: true
});

// Helper de Analítica PostHog
function trackAnalyticsEvent(eventName, properties = {}) {
  try {
    if (window.posthog && typeof window.posthog.capture === 'function') {
      const authUser = typeof getAuthUser === 'function' ? getAuthUser() : null;
      window.posthog.capture(eventName, {
        ...properties,
        timestamp: new Date().toISOString(),
        username: authUser ? authUser.user : 'guest',
        app_version: '8.3.0'
      });
    }
  } catch (_) {}
}

// ========================================================
// SISTEMA DE MULTI-SELECCIÓN DE CANCIONES Y COLA SECUENCIAL (v7.9)
// ========================================================
const downloadQueue = [];
let isProcessingDownloadQueue = false;
let activeDownloadTrack = null;

function getTrackKey(track) {
  if (!track) return '';
  const title = (track.title || '').toLowerCase().trim();
  const artist = (track.artist || '').toLowerCase().trim();
  return `${title}___${artist}`.replace(/[\s\W]+/g, '_');
}

function toggleTrackSelection(track, isSelected, element) {
  if (!track || !track.title) return;
  const key = getTrackKey(track);
  if (isSelected) {
    state.selectedTracks.set(key, track);
    if (element) element.classList.add('is-selected');
  } else {
    state.selectedTracks.delete(key);
    if (element) element.classList.remove('is-selected');
  }
  updateBatchActionBar();
}

function updateBatchActionBar() {
  const bar = document.getElementById('batchActionBar');
  const countText = document.getElementById('batchCountText');
  if (!bar) return;

  const count = state.selectedTracks.size;
  if (count === 0) {
    bar.classList.add('hidden');
  } else {
    bar.classList.remove('hidden');
    if (countText) {
      countText.textContent = `${count} ${count === 1 ? 'canción' : 'canciones'}`;
    }
  }
}

function clearAllSelections() {
  state.selectedTracks.clear();
  document.querySelectorAll('.track-select-cb').forEach(cb => {
    cb.checked = false;
  });
  document.querySelectorAll('.is-selected').forEach(el => {
    el.classList.remove('is-selected');
  });
  updateBatchActionBar();
}

function selectAllVisibleTracks() {
  const visibleCheckboxes = Array.from(document.querySelectorAll('.track-select-cb')).filter(cb => {
    return cb.offsetParent !== null;
  });
  if (visibleCheckboxes.length === 0) return;

  const allChecked = visibleCheckboxes.every(cb => cb.checked);
  if (allChecked) {
    clearAllSelections();
    showToast('Selección limpiada.');
  } else {
    visibleCheckboxes.forEach(cb => {
      if (!cb.checked) {
        cb.checked = true;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    showToast(`🎯 ${visibleCheckboxes.length} canciones visibles seleccionadas.`);
  }
}

// AÑADIR EN LOTE A LA LISTA DE REPRODUCCIÓN ACTUAL (COLA)
function batchAddToQueue(atStart = true) {
  const tracks = Array.from(state.selectedTracks.values());
  if (tracks.length === 0) {
    showToast('⚠️ No hay canciones seleccionadas.');
    return;
  }

  if (!state.queue) state.queue = [];

  const formattedTracks = tracks.map(t => ({
    title: t.title,
    artist: t.artist || 'Artista Desconocido',
    cover: t.cover || t.coverXl || 'https://via.placeholder.com/300/1a0933/ff2a85?text=VI',
    preview: t.preview || t.audioUrl || '',
    audioUrl: t.audioUrl || t.preview || '',
    album: t.album || 'Vice Music Single',
    duration: t.duration || 0,
    videoId: t.videoId || t.video_id || ''
  }));

  if (atStart) {
    state.queue.unshift(...formattedTracks);
  } else {
    state.queue.push(...formattedTracks);
  }

  updateQueueBadge();
  if (typeof renderQueueItems === 'function') {
    renderQueueItems();
  }

  const posText = atStart ? 'al principio' : 'al final';
  showToast(`🎶 ¡${formattedTracks.length} canciones agregadas ${posText} de la lista de reproducción actual!`);
  showTopRightToast('Lista de Reproducción', `${formattedTracks.length} canciones agregadas ${posText} de la cola.`, 'playlist');
  clearAllSelections();
}

// AÑADIR EN LOTE A LA PLAYLIST GUARDADA
async function batchAddToPlaylist(atStart = true) {
  const tracks = Array.from(state.selectedTracks.values());
  if (tracks.length === 0) {
    showToast('⚠️ No hay canciones seleccionadas.');
    return;
  }

  const user = getAuthUser();
  if (!user) {
    openLoginModal('Inicia sesión con tu cuenta VIP para guardar canciones en tu Playlist.', () => {
      batchAddToPlaylist(atStart);
    });
    showToast('🔒 Inicia sesión para guardar canciones en tu playlist.');
    return;
  }
  const username = user.user;

  const formattedTracks = tracks.map(t => ({
    title: t.title,
    artist: t.artist || 'Artista Desconocido',
    cover: t.cover || t.coverXl || 'https://via.placeholder.com/300/1a0933/ff2a85?text=VI',
    preview: t.preview || t.audioUrl || '',
    album: t.album || 'Vice Music Single',
    duration: t.duration || 0,
    video_id: t.videoId || t.video_id || ''
  }));

  if (!state.userPlaylist) state.userPlaylist = [];
  const existingKeys = new Set(state.userPlaylist.map(p => `${p.title.toLowerCase().trim()}___${(p.artist || '').toLowerCase().trim()}`));
  const newTracks = formattedTracks.filter(t => !existingKeys.has(`${t.title.toLowerCase().trim()}___${(t.artist || '').toLowerCase().trim()}`));

  if (newTracks.length === 0) {
    showToast('ℹ️ Todas las canciones seleccionadas ya están en tu playlist.');
    clearAllSelections();
    return;
  }

  if (atStart) {
    state.userPlaylist.unshift(...newTracks);
    state.activeCoverflowIndex = 0;
  } else {
    state.userPlaylist.push(...newTracks);
  }

  try {
    localStorage.setItem(`vice_playlist_${username}`, JSON.stringify(state.userPlaylist));
  } catch (_) {}

  try {
    await fetch('/api/playlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user: username,
        tracks: newTracks,
        position: atStart ? 'start' : 'end'
      })
    });
  } catch (err) {
    console.warn('Advertencia al guardar playlist en servidor:', err.message);
  }

  updatePlaylistBadge();
  renderCoverflow();
  renderPlaylistTracklist();

  const posText = atStart ? 'al principio' : 'al final';
  showToast(`💖 ¡${newTracks.length} canciones añadidas ${posText} de tu Playlist!`);
  showTopRightToast('Playlist Actualizada', `${newTracks.length} canciones agregadas ${posText}.`, 'heart');
  clearAllSelections();
}

function batchDownloadSelected() {
  const tracks = Array.from(state.selectedTracks.values());
  if (tracks.length === 0) {
    showToast('⚠️ No hay canciones seleccionadas para descargar.');
    return;
  }

  showToast(`📥 Añadiendo ${tracks.length} canciones a la cola de descarga secuencial...`);
  tracks.forEach(t => enqueueDownload(t));
  clearAllSelections();
}

function enqueueDownload(track) {
  if (!track || !track.title) return;
  if (!isUserLoggedIn()) {
    openLoginModal(`Inicia sesión como VIP para descargar "${track.artist} - ${track.title}" en MP3 320 kbps.`, () => {
      enqueueDownload(track);
    });
    return;
  }

  const authUser = getAuthUser();
  const username = authUser ? authUser.user : null;
  if (username) {
    fetch(`/api/subscription-status?user=${encodeURIComponent(username)}`)
      .then(r => r.json())
      .then(sub => {
        if (!sub || !sub.active) {
          openVipModal();
          showToast('👑 Membresía VIP inactiva ($10.000 COP/mes). Renuévala para descargar.');
          return;
        }
        proceedEnqueueDownload(track);
      })
      .catch(() => {
        proceedEnqueueDownload(track);
      });
    return;
  }

  proceedEnqueueDownload(track);
}

function proceedEnqueueDownload(track) {
  const key = getTrackKey(track);
  const alreadyInQueue = downloadQueue.some(t => getTrackKey(t) === key);
  if (alreadyInQueue || (activeDownloadTrack && getTrackKey(activeDownloadTrack) === key)) {
    showToast(`ℹ️ "${track.title}" ya está en la cola de descarga.`);
    return;
  }

  downloadQueue.push(track);
  trackAnalyticsEvent('download_enqueued', { title: track.title, artist: track.artist });

  if (isProcessingDownloadQueue) {
    showToast(`⏳ "${track.title}" agregada a la lista de espera (Posición #${downloadQueue.length}).`);
    // Actualizar la insignia del widget existente si ya está en pantalla
    const badge = document.getElementById('dlWidgetQueueBadge');
    if (badge) {
      badge.textContent = `+${downloadQueue.length} en espera`;
      badge.classList.remove('hidden');
    }
  } else {
    processDownloadQueue();
  }
}

async function processDownloadQueue() {
  if (isProcessingDownloadQueue) return;
  if (downloadQueue.length === 0) {
    hideDownloadProgress();
    return;
  }

  isProcessingDownloadQueue = true;

  while (downloadQueue.length > 0) {
    activeDownloadTrack = downloadQueue.shift();
    const trackDisplayName = `${activeDownloadTrack.artist} - ${activeDownloadTrack.title}`;
    
    // Iniciar progreso sin ocultar el widget
    setDownloadProgress(8, 'Iniciando conexión con satélite de audio...', trackDisplayName);

    try {
      await executeSingleMp3Download(activeDownloadTrack);
    } catch (err) {
      console.error('Error al descargar de la cola:', err);
      showToast(`❌ Error al descargar "${activeDownloadTrack.title}": ${err.message}`);
    }

    activeDownloadTrack = null;

    if (downloadQueue.length > 0) {
      showToast(`⚡ Preparando siguiente canción (${downloadQueue.length} restantes en cola)...`);
      setDownloadProgress(5, 'Conectando con la siguiente canción...', `${downloadQueue[0].artist} - ${downloadQueue[0].title}`);
      // Pausa de 1.8 segundos entre descargas para que el navegador procese el guardado del archivo
      await new Promise(r => setTimeout(r, 1800));
    }
  }

  isProcessingDownloadQueue = false;
  hideDownloadProgress();
  showTopRightToast('🎉 Descargas Completadas', 'Todas las canciones seleccionadas se han descargado con éxito.', 'success');
}

function setupBatchActionBarHandlers() {
  const btnSelectAll = document.getElementById('btnBatchSelectAll');
  const btnClear = document.getElementById('btnBatchClear');
  const btnPlStart = document.getElementById('btnBatchPlStart');
  const btnPlEnd = document.getElementById('btnBatchPlEnd');
  const btnDownload = document.getElementById('btnBatchDownload');

  if (btnSelectAll) btnSelectAll.addEventListener('click', selectAllVisibleTracks);
  if (btnClear) btnClear.addEventListener('click', clearAllSelections);
  if (btnPlStart) btnPlStart.addEventListener('click', () => batchAddToQueue(true));
  if (btnPlEnd) btnPlEnd.addEventListener('click', () => batchAddToQueue(false));
  if (btnDownload) btnDownload.addEventListener('click', batchDownloadSelected);
}

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
const btnOpenAppleMusic = document.getElementById('btnOpenAppleMusic');
const playerCoverWrapper = document.getElementById('playerCoverWrapper');

const vCtx = visualizerCanvas ? visualizerCanvas.getContext('2d') : null;

// ========================================================
// APPLE MUSIC MODAL & DYNAMIC COVER / LYRICS DOM
// ========================================================
const appleMusicModal = document.getElementById('appleMusicModal');
const btnMinimizeAm = document.getElementById('btnMinimizeAm');
const amAmbientBg = document.getElementById('amAmbientBg');
const btnAmTabCover = document.getElementById('btnAmTabCover');
const btnAmTabLyrics = document.getElementById('btnAmTabLyrics');
const amCoverSection = document.getElementById('amCoverSection');
const amLyricsSection = document.getElementById('amLyricsSection');
const amCoverStage = document.querySelector('.am-cover-stage');
const amCoverCard = document.getElementById('amCoverCard');
const amCoverImg = document.getElementById('amCoverImg');
const amMotionVideo = document.getElementById('amMotionVideo');
const amCoverGlow = document.getElementById('amCoverGlow');
let hlsMotion = null;
const amTrackTitle = document.getElementById('amTrackTitle');
const amTrackArtist = document.getElementById('amTrackArtist');
const amTrackAlbum = document.getElementById('amTrackAlbum');
const amLyricsBadge = document.getElementById('amLyricsBadge');
const amLyricsContainer = document.getElementById('amLyricsContainer');
const amProgressTrack = document.getElementById('amProgressTrack');
const amProgressFill = document.getElementById('amProgressFill');
const amProgressThumb = document.getElementById('amProgressThumb');
const amTimeCurrent = document.getElementById('amTimeCurrent');
const amTimeTotal = document.getElementById('amTimeTotal');
const amBtnSpeed = document.getElementById('amBtnSpeed');
const amBtnBackward = document.getElementById('amBtnBackward');
const amBtnPlayPause = document.getElementById('amBtnPlayPause');
const amIconPlay = document.getElementById('amIconPlay');
const amIconPause = document.getElementById('amIconPause');
const amBtnForward = document.getElementById('amBtnForward');
const amBtnDownload = document.getElementById('amBtnDownload');
const amBtnMore = document.getElementById('amBtnMore');
const amMoreMenu = document.getElementById('amMoreMenu');
const amMenuBackdrop = document.getElementById('amMenuBackdrop');
const amMenuCover = document.getElementById('amMenuCover');
const amMenuTitle = document.getElementById('amMenuTitle');
const amMenuArtist = document.getElementById('amMenuArtist');
const amMenuBtnQueue = document.getElementById('amMenuBtnQueue');
const amMenuBtnDownload = document.getElementById('amMenuBtnDownload');
const amMenuBtnDownloadFlac = document.getElementById('amMenuBtnDownloadFlac');
const amMenuBtnCrossfade = document.getElementById('amMenuBtnCrossfade') || document.getElementById('amMenuBtnDj');
const amMenuBtnDj = amMenuBtnCrossfade;
const amMenuCrossfadeTag = document.getElementById('amMenuCrossfadeTag') || document.getElementById('amMenuDjTag');
const amMenuDjTag = amMenuCrossfadeTag;
const amMenuBtnArtist = document.getElementById('amMenuBtnArtist');
const amMenuBtnAlbum = document.getElementById('amMenuBtnAlbum');
const amMenuBtnFull = document.getElementById('amMenuBtnFull');
const amMenuBtnShare = document.getElementById('amMenuBtnShare');
const amCrossfadeBadge = document.getElementById('amCrossfadeBadge') || document.getElementById('amDjBadge');
const amDjBadge = amCrossfadeBadge;
const btnBottomCrossfade = document.getElementById('btnBottomCrossfade') || document.getElementById('btnBottomDj');
const btnBottomDj = btnBottomCrossfade;
const btnPlayerMoreLeft = document.getElementById('btnPlayerMoreLeft');

const appleMusicState = {
  isOpen: false,
  activeTab: 'cover', // 'cover' | 'lyrics'
  trackKey: null,
  lyrics: [], // [ { time: number, text: string, el: HTMLElement } ]
  activeLyricIndex: -1,
  isFetchingLyrics: false
};

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
      host: 'https://www.youtube-nocookie.com',
      playerVars: {
        autoplay: 1,
        controls: 0,
        disablekb: 1,
        fs: 0,
        modestbranding: 1,
        rel: 0,
        playsinline: 1,
        origin: window.location.origin
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
          console.warn('[YouTube Error Code]', err.data);
          // Si el video tiene restricción de incrustación (código 101/150) o error, probar video alternativo
          if (state.currentTrack && Array.isArray(state.currentTrack.alternativeVideoIds) && state.currentTrack.alternativeVideoIds.length > 0) {
            const nextVideoId = state.currentTrack.alternativeVideoIds.shift();
            console.log('[YouTube Fallback] Probando stream alternativo:', nextVideoId);
            showToast('🔄 Cambiando a stream oficial alternativo...');
            state.currentTrack.videoId = nextVideoId;
            try {
              if (ytPlayer && typeof ytPlayer.loadVideoById === 'function') {
                ytPlayer.loadVideoById(nextVideoId);
                ytPlayer.playVideo();
                return;
              }
            } catch (fbErr) {
              console.warn('Error cambiando a stream alternativo:', fbErr);
            }
          }
          // Si falla YouTube iframe (ej: código 101/150 por restricciones de incrustación), reproducir el audio completo nativo vía servidor
          if (state.currentTrack && state.currentTrack.videoId && state.audio) {
            console.log('[Native Audio Fallback] Transfiriendo a flujo de audio nativo del servidor:', state.currentTrack.videoId);
            showToast('🎧 Reproduciendo en alta fidelidad...');
            state.playbackSource = 'full_stream';
            state.audio.src = `/api/stream-live?v=${state.currentTrack.videoId}`;
            state.audio.playbackRate = state.currentSpeed;
            state.audio.play().then(() => {
              setPlayingState(true);
              updateMediaSession(state.currentTrack);
            }).catch(() => {
              const fallbackUrl = state.currentTrack?.preview || state.currentTrack?.audioUrl;
              if (fallbackUrl) {
                state.playbackSource = 'preview';
                state.audio.src = fallbackUrl;
                state.audio.play().catch(() => {});
              }
            });
            return;
          }
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
    // Avanzar automáticamente a la siguiente canción (playlist, cola o álbum)
    setTimeout(() => playNextTrack(), 400);
  }
}

function startYtProgress() {
  stopYtProgress();
  ytProgressInterval = setInterval(() => {
    if (!ytPlayer || typeof ytPlayer.getCurrentTime !== 'function') return;
    const rawCur = ytPlayer.getCurrentTime();
    let rawDur = ytPlayer.getDuration();
    if (!Number.isFinite(rawDur) || rawDur <= 0) {
      rawDur = (state.currentTrack && state.currentTrack.duration) || 0;
    }
    const cur = (Number.isFinite(rawCur) && rawCur > 0) ? rawCur : 0;
    const dur = (Number.isFinite(rawDur) && rawDur > 0) ? rawDur : 0;

    currentTimeLabel.innerText = formatTime(cur);
    totalTimeLabel.innerText = dur > 0 ? formatTime(dur) : '00:00';
    if (dur > 0) {
      const pct = Math.min(100, Math.max(0, (cur / dur) * 100));
      progressFill.style.width = `${pct}%`;
      progressThumb.style.left = `${pct}%`;
      updateMediaSessionPosition(cur, dur);
    }

    updateAppleMusicProgress(cur, dur);
    checkAndTriggerCrossfade();

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
    if (session && session.user) {
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
  refreshVipHeaderUI();
}

// ========================================================
// SISTEMA DE MEMBRESÍA VIP STRIPE & GESTIÓN DE FACTURACIÓN
// ========================================================
function openVipModal() {
  const modal = document.getElementById('vipSubscriptionModal');
  if (modal) {
    modal.classList.remove('hidden');
    const auth = getAuthUser();
    trackAnalyticsEvent('vip_modal_opened', { user: auth ? auth.user : 'guest' });
  }
}

function closeVipModal() {
  const modal = document.getElementById('vipSubscriptionModal');
  if (modal) {
    modal.classList.add('hidden');
  }
}

async function refreshVipHeaderUI() {
  const user = getAuthUser();
  const vipBtn = document.getElementById('btnOpenVip');
  if (!vipBtn) return;

  if (!user || !user.user) {
    vipBtn.innerHTML = '<span class="vip-crown">👑</span><span class="vip-btn-label">VIP PASS</span>';
    vipBtn.classList.remove('vip-active');
    vipBtn.title = 'Membresía VIP Vice Music - $10.000 COP/mes';
    return;
  }

  try {
    const res = await fetch(`/api/subscription-status?user=${encodeURIComponent(user.user)}`);
    const data = await res.json();
    if (data && data.active) {
      vipBtn.innerHTML = '<span class="vip-crown">👑</span><span class="vip-btn-label">VIP ACTIVO</span>';
      vipBtn.classList.add('vip-active');
      vipBtn.title = `Membresía VIP Activa hasta: ${data.expiresAt ? data.expiresAt.substring(0, 10) : 'Ilimitada'}`;
    } else {
      vipBtn.innerHTML = '<span class="vip-crown">👑</span><span class="vip-btn-label">RENOVAR VIP</span>';
      vipBtn.classList.remove('vip-active');
      vipBtn.title = 'Membresía VIP Vencida - Haz clic para renovar por $10.000 COP/mes';
    }
  } catch (_) {}
}

async function handleStripeSubscribe() {
  const user = getAuthUser();
  if (!user || !user.user) {
    closeVipModal();
    openLoginModal('Inicia sesión o regístrate para activar tu Membresía VIP ($10.000 COP/mes).', () => {
      openVipModal();
    });
    return;
  }

  const btn = document.getElementById('btnStripeSubscribe');
  const originalHtml = btn ? btn.innerHTML : null;
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<div class="login-spinner" style="margin: 0 auto;"></div><span>Conectando con Stripe Checkout...</span>';
  }

  trackAnalyticsEvent('stripe_checkout_initiated', { username: user.user });

  try {
    const res = await fetch('/api/stripe/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: user.user,
        email: `${user.user}@vicemusic.vip`
      })
    });
    const data = await res.json();
    if (data.checkoutUrl) {
      window.location.href = data.checkoutUrl;
      return;
    } else if (data.demoActivation) {
      closeVipModal();
      showToast('👑 ' + data.message);
      showTopRightToast('Membresía VIP Activada', 'Pase mensual activo ($10.000 COP). Descargas habilitadas.', 'success');
      refreshVipHeaderUI();
    } else {
      showToast('Error conectando con Stripe: ' + (data.error || 'Intenta de nuevo'));
    }
  } catch (err) {
    showToast('Error de conexión con Stripe: ' + err.message);
  } finally {
    if (btn && originalHtml) {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
  }
}

function openLoginModal(subtitle = null, onLoginSuccess = null) {
  pendingPostAuthAction = (typeof onLoginSuccess === 'function') ? onLoginSuccess : null;
  const modal = document.getElementById('loginModal');
  const subtitleEl = document.getElementById('loginModalSubtitle');
  const alertEl = document.getElementById('loginAlert');
  const userInput = document.getElementById('loginUsername');
  const pwdInput = document.getElementById('loginPassword');
  const accessCodeInput = document.getElementById('loginAccessCode');

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
  if (accessCodeInput) accessCodeInput.value = '';

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
  const accessCodeInput = document.getElementById('loginAccessCode');
  const alertEl = document.getElementById('loginAlert');
  const btnSubmit = document.getElementById('btnLoginSubmit');
  const btnText = document.getElementById('loginBtnText');
  const spinner = document.getElementById('loginBtnSpinner');

  const username = (userInput ? userInput.value : '').trim();
  const password = (pwdInput ? pwdInput.value : '').trim();
  const accessCode = (accessCodeInput ? accessCodeInput.value : '').trim();
  const isReg = state.authMode === 'register';

  if (!username || !password) {
    if (alertEl) {
      alertEl.textContent = 'Por favor ingresa usuario y contraseña.';
      alertEl.classList.remove('hidden');
    }
    return;
  }

  if (isReg && !accessCode) {
    if (alertEl) {
      alertEl.textContent = 'Por favor ingresa el código de acceso para registrarte.';
      alertEl.classList.remove('hidden');
    }
    return;
  }

  if (btnSubmit) btnSubmit.disabled = true;
  if (btnText) btnText.textContent = 'VERIFICANDO...';
  if (spinner) spinner.classList.remove('hidden');
  if (alertEl) alertEl.classList.add('hidden');

  try {
    const targetEndpoint = isReg ? '/api/register' : '/api/login';
    let data = null;
    try {
      const payload = isReg ? { username, password, accessCode } : { username, password };
      const res = await fetch(targetEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      data = await res.json();
    } catch (netErr) {
      // Fallback si la petición de red falla momentáneamente
      if (!isReg && username === 'admin' && password === 'admin') {
        data = { success: true, user: 'admin', role: 'VIP Admin' };
      } else {
        data = { success: false, error: 'Error de conexión con el servidor.' };
      }
    }

    if (data && data.success) {
      const session = {
        user: data.user || username,
        role: data.role || (isReg ? 'VIP Member' : 'VIP Admin'),
        token: data.token || 'vice_vip_admin_token_2026',
        timestamp: Date.now()
      };
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
      updateAuthUI();
      closeLoginModal();
      showToast(isReg ? `🎉 ¡Cuenta creada con éxito! Bienvenido, VIP ${session.user}.` : `👑 ¡Sesión iniciada con éxito! Bienvenido, VIP ${session.user}.`);

      loadUserPlaylist();

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
        alertEl.textContent = (data && data.error) || (isReg ? 'No se pudo crear la cuenta.' : 'Usuario o contraseña incorrectos.');
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
    if (btnText) btnText.textContent = state.authMode === 'register' ? 'REGISTRARME GRATIS' : 'INGRESAR AL SISTEMA';
    if (spinner) spinner.classList.add('hidden');
  }
}

function handleLogout() {
  localStorage.removeItem(AUTH_STORAGE_KEY);
  updateAuthUI();
  loadUserPlaylist();
  showToast('🔒 Sesión cerrada. Se requerirá login para descargar.');
}

// ========================================================
// INICIALIZACIÓN
// ========================================================
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  updateAuthUI();
  updateClockIndicator();
  setInterval(updateClockIndicator, 30000);
  startVisualizer();
  loadHomeContent();
  switchViewMode('home');

  // Sincronizar etiqueta de versión dinámica sin caché
  fetch('/api/version?t=' + Date.now()).then(r => r.json()).then(data => {
    if (data && data.version) {
      const badge = document.getElementById('versionBadge');
      if (badge) badge.textContent = `v${data.version}`;
    }
  }).catch(() => {});
});

function setupEventListeners() {
  if (tabHome) tabHome.addEventListener('click', () => switchViewMode('home'));
  const tabPlaylist = document.getElementById('tabPlaylist');
  if (tabPlaylist) tabPlaylist.addEventListener('click', () => switchViewMode('playlist'));
  tabAlbums.addEventListener('click', () => switchViewMode('albums'));
  tabTracks.addEventListener('click', () => switchViewMode('tracks'));

  setupPlaylistControls();
  setupDownloadConfirmHandlers();
  setupQueueHandlers();
  setupBatchActionBarHandlers();

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
    } else if (state.currentMode === 'playlist') {
      const playlistSection = document.getElementById('playlistSection');
      if (playlistSection) playlistSection.classList.remove('hidden');
    } else {
      if (catalogSection) catalogSection.classList.remove('hidden');
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

  // Clic en el nombre del artista en la barra fija (manejado individualmente por pastillas .artist-clickable-pill)

  // Botón Escuchar Canción Completa en la barra fija
  if (btnPlayFullSong) {
    btnPlayFullSong.addEventListener('click', () => {
      if (state.currentTrack) {
        playFullSong(state.currentTrack.artist, state.currentTrack.title, state.currentTrack.cover, state.currentTrack.album, state.currentTrack.duration, state.currentTrack.preview);
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
        confirmDownloadSong(state.currentTrack);
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
        confirmDownloadSong(state.currentTrack);
      } else {
        showToast('Selecciona primero una canción para descargar en MP3.');
      }
    });
  }
  const btnPlayFullSongMobile = document.getElementById('btnPlayFullSongMobile');
  if (btnPlayFullSongMobile) {
    btnPlayFullSongMobile.addEventListener('click', () => {
      if (state.currentTrack) {
        playFullSong(state.currentTrack.artist, state.currentTrack.title, state.currentTrack.cover, state.currentTrack.album, state.currentTrack.duration, state.currentTrack.preview);
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
    playPreviousTrack();
  });

  btnForward.addEventListener('click', () => {
    playNextTrack();
  });

  if (btnBottomCrossfade) {
    btnBottomCrossfade.addEventListener('click', () => {
      toggleCrossfade();
    });
  }

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
      // Cancelar crossfade en progreso si el usuario salta manualmente en la barra
      if (state.isCrossfading && crossfadeInterval) {
        clearInterval(crossfadeInterval);
        crossfadeInterval = null;
        state.isCrossfading = false;
        if (state.fadeAudio) {
          state.fadeAudio.pause();
          state.fadeAudio.currentTime = 0;
        }
        if (state.activeAudio) state.activeAudio.volume = 1;
      }
      state.audio.currentTime = pos * state.audio.duration;
      updateMediaSessionPosition(state.audio.currentTime, state.audio.duration);
    }
  });

  // Dual Audio Engine: Vincular eventos a ambos elementos A y B para crossfade ininterrumpido
  setupAudioElementListeners(state.audioA);
  setupAudioElementListeners(state.audioB);

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

  const btnToggleAccessCode = document.getElementById('btnToggleAccessCode');
  if (btnToggleAccessCode) {
    btnToggleAccessCode.addEventListener('click', () => {
      const codeInput = document.getElementById('loginAccessCode');
      if (!codeInput) return;
      if (codeInput.type === 'password') {
        codeInput.type = 'text';
        btnToggleAccessCode.textContent = '🙈';
      } else {
        codeInput.type = 'password';
        btnToggleAccessCode.textContent = '👁️';
      }
    });
  }

  // Eventos VIP Pass & Stripe Checkout ($10.000 COP)
  const btnOpenVip = document.getElementById('btnOpenVip');
  if (btnOpenVip) btnOpenVip.addEventListener('click', openVipModal);

  const btnCloseVipModal = document.getElementById('btnCloseVipModal');
  if (btnCloseVipModal) btnCloseVipModal.addEventListener('click', closeVipModal);

  const vipModalBackdrop = document.getElementById('vipModalBackdrop');
  if (vipModalBackdrop) vipModalBackdrop.addEventListener('click', closeVipModal);

  const btnStripeSubscribe = document.getElementById('btnStripeSubscribe');
  if (btnStripeSubscribe) btnStripeSubscribe.addEventListener('click', handleStripeSubscribe);

  // ========================================================
  // EVENTOS REPRODUCTOR APPLE MUSIC (FULLSCREEN / MODAL)
  // ========================================================
  if (btnOpenAppleMusic) {
    btnOpenAppleMusic.addEventListener('click', openAppleMusicModal);
  }
  if (playerCoverWrapper) {
    playerCoverWrapper.addEventListener('click', openAppleMusicModal);
  }
  const playerTrackEl = document.querySelector('.player-track');
  if (playerTrackEl) {
    playerTrackEl.addEventListener('click', (e) => {
      if (e.target.closest('#playerArtist')) return; // No interceptar clic en artista
      openAppleMusicModal();
    });
  }

  if (btnMinimizeAm) {
    btnMinimizeAm.addEventListener('click', closeAppleMusicModal);
  }
  if (btnAmTabCover) {
    btnAmTabCover.addEventListener('click', () => switchAppleMusicTab('cover'));
  }
  if (btnAmTabLyrics) {
    btnAmTabLyrics.addEventListener('click', () => switchAppleMusicTab('lyrics'));
  }
  if (amBtnPlayPause) {
    amBtnPlayPause.addEventListener('click', togglePlayPause);
  }
  if (amBtnBackward) {
    amBtnBackward.addEventListener('click', () => playPreviousTrack());
  }
  if (amBtnForward) {
    amBtnForward.addEventListener('click', () => playNextTrack());
  }
  if (amBtnSpeed) {
    amBtnSpeed.addEventListener('click', () => {
      cyclePlaybackSpeed();
      if (amBtnSpeed) amBtnSpeed.innerText = `${state.currentSpeed}x`;
    });
  }
  if (amBtnMore) {
    amBtnMore.addEventListener('click', (e) => {
      e.stopPropagation();
      openMoreMenu(amBtnMore);
    });
  }
  if (btnPlayerMoreLeft) {
    btnPlayerMoreLeft.addEventListener('click', (e) => {
      e.stopPropagation();
      if (state.currentTrack) {
        openTrackContextMenu(state.currentTrack, e.currentTarget);
      } else {
        showToast('Selecciona primero una pista de audio.');
      }
    });
  }
  if (amMenuBackdrop) {
    amMenuBackdrop.addEventListener('click', closeMoreMenu);
  }
  const amMenuBtnPlayNext = document.getElementById('amMenuBtnPlayNext');
  if (amMenuBtnPlayNext) {
    amMenuBtnPlayNext.addEventListener('click', () => {
      closeMoreMenu();
      const t = state.contextTrack || state.currentTrack;
      if (!t) return;
      if (!state.queue) state.queue = [];
      state.queue.unshift({
        artist: t.artist,
        title: t.title,
        cover: t.cover,
        album: t.album
      });
      updateQueueBadge();
      showTopRightToast('Puesta a continuación', t.title, 'playlist');
    });
  }

  if (amMenuBtnQueue) {
    amMenuBtnQueue.addEventListener('click', () => {
      closeMoreMenu();
      const t = state.contextTrack || state.currentTrack;
      if (!t) return;
      if (!state.queue) state.queue = [];
      state.queue.push({
        artist: t.artist,
        title: t.title,
        cover: t.cover,
        album: t.album
      });
      updateQueueBadge();
      showTopRightToast('Añadida a la cola', t.title, 'playlist');
    });
  }
  if (amMenuBtnDownload) {
    amMenuBtnDownload.addEventListener('click', () => {
      closeMoreMenu();
      const t = state.contextTrack || state.currentTrack;
      if (t) {
        confirmDownloadSong(t);
      } else {
        showToast('Selecciona primero una canción para descargar en MP3 320.');
      }
    });
  }
  if (amMenuBtnDownloadFlac) {
    amMenuBtnDownloadFlac.addEventListener('click', () => {
      closeMoreMenu();
      const t = state.contextTrack || state.currentTrack;
      if (!t) return;
      if (!isUserLoggedIn()) {
        openLoginModal(`Inicia sesión como VIP para descargar FLAC de "${t.title}".`, () => {
          showToast(`⚡ Abriendo enlace FLAC para: ${t.title}`);
          const url = t.lucidaUrl || `https://lucida.to/?url=${encodeURIComponent(t.title + ' ' + t.artist)}`;
          window.open(url, '_blank');
        });
        return;
      }
      showToast(`⚡ Abriendo enlace FLAC para: ${t.title}`);
      const url = t.lucidaUrl || `https://lucida.to/?url=${encodeURIComponent(t.title + ' ' + t.artist)}`;
      window.open(url, '_blank');
    });
  }
  if (amMenuBtnDj) {
    amMenuBtnDj.addEventListener('click', () => {
      toggleSmartDj();
    });
  }
  if (amDjBadge) {
    amDjBadge.addEventListener('click', () => {
      toggleSmartDj();
    });
  }
  if (amMenuBtnArtist) {
    amMenuBtnArtist.addEventListener('click', () => {
      closeMoreMenu();
      const t = state.contextTrack || state.currentTrack;
      if (t && t.artist) {
        closeAppleMusicModal();
        openArtistProfile(t.artist);
      }
    });
  }
  if (amMenuBtnAlbum) {
    amMenuBtnAlbum.addEventListener('click', async () => {
      closeMoreMenu();
      closeAppleMusicModal();
      const t = state.contextTrack || state.currentTrack;
      if (!t) return;

      // 1. Si la pista ya tiene albumId directo
      if (t.albumId && t.albumId !== 'null' && t.albumId !== 'undefined') {
        openAlbumDetail(t.albumId);
        return;
      }

      const primaryArtist = cleanArtistName((t.artist || '').split(/\s*(?:&|&amp;|,|[xX]|ft\.?|feat\.?|con)\s*/i)[0]);
      const cleanTitle = (t.title || '').replace(/\s*[\(\[].*?[\)\]]/gi, '').trim();
      const cleanAlbum = (t.album && !/^(?:Álbum|Album|Álbum Desconocido|Álbum Oficial)$/i.test(t.album.trim())) ? t.album.trim() : '';

      showToast(`🔍 Localizando álbum oficial...`);

      // 2. Intentar buscar por canción para obtener el ID de su álbum oficial
      try {
        const trkSearch = await fetchDeezerJsonp(`/search?q=${encodeURIComponent(primaryArtist + ' ' + cleanTitle)}&limit=1`);
        if (trkSearch && trkSearch.data && trkSearch.data.length > 0 && trkSearch.data[0].album && trkSearch.data[0].album.id) {
          openAlbumDetail(`deezer_${trkSearch.data[0].album.id}`);
          return;
        }
      } catch (_) {}

      // 3. Si tiene nombre de álbum, buscarlo en Deezer
      if (cleanAlbum) {
        try {
          const albSearch = await fetchDeezerJsonp(`/search/album?q=${encodeURIComponent(primaryArtist + ' ' + cleanAlbum)}&limit=1`);
          if (albSearch && albSearch.data && albSearch.data.length > 0 && albSearch.data[0].id) {
            openAlbumDetail(`deezer_${albSearch.data[0].id}`);
            return;
          }
        } catch (_) {}
      }

      // 4. Si no hay álbum separado o falló, ir al perfil del artista para ver su discografía completa
      if (primaryArtist || t.artist) {
        showToast(`📀 Abriendo discografía de ${primaryArtist || t.artist}...`);
        openArtistProfile(primaryArtist || t.artist);
      } else {
        showToast(`📀 No se encontró el álbum de esta canción`);
      }
    });
  }
  if (amMenuBtnFull) {
    amMenuBtnFull.addEventListener('click', () => {
      closeMoreMenu();
      const t = state.contextTrack || state.currentTrack;
      if (t) {
        playFullSong(t.artist, t.title, t.cover, t.album, t.duration, t.preview);
      }
    });
  }
  if (amMenuBtnShare) {
    amMenuBtnShare.addEventListener('click', () => {
      closeMoreMenu();
      const t = state.contextTrack || state.currentTrack;
      if (t) {
        const textToShare = `Escucha "${t.title}" de ${t.artist} en Vice Music: ${window.location.href}`;
        if (navigator.clipboard) {
          navigator.clipboard.writeText(textToShare).then(() => {
            showToast('🔗 Información copiada al portapapeles');
          }).catch(() => {
            showToast(`🎵 Compartir: ${t.title} - ${t.artist}`);
          });
        } else {
          showToast(`🎵 Compartir: ${t.title} - ${t.artist}`);
        }
      }
    });
  }
  const amMenuBtnAddPlaylist = document.getElementById('amMenuBtnAddPlaylist');
  if (amMenuBtnAddPlaylist) {
    amMenuBtnAddPlaylist.addEventListener('click', () => {
      closeMoreMenu();
      const t = state.contextTrack || state.currentTrack;
      if (t) {
        addToUserPlaylist(t);
      } else {
        showToast('Selecciona una pista primero para añadir a tu playlist.');
      }
    });
  }
  // Clic en Artista en el modal Apple Music (manejado individualmente por pastillas .artist-clickable-pill)
  if (amProgressTrack) {
    amProgressTrack.addEventListener('click', (e) => {
      const rect = amProgressTrack.getBoundingClientRect();
      const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));

      if ((state.playbackSource === 'full' || state.playbackSource === 'full_yt') && ytPlayer && typeof ytPlayer.getDuration === 'function') {
        const dur = ytPlayer.getDuration();
        if (dur > 0) {
          ytPlayer.seekTo(pos * dur, true);
          updateMediaSessionPosition(pos * dur, dur);
        }
      } else if (state.audio && state.audio.duration) {
        state.audio.currentTime = pos * state.audio.duration;
        updateMediaSessionPosition(state.audio.currentTime, state.audio.duration);
      }
    });
  }

  // Carátula flotante estática y limpia (sin distorsión 3D tilt)
  if (amCoverStage && amCoverCard) {
    amCoverCard.style.transform = '';
  }

  // Cerrar modales con tecla Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (appleMusicState.isOpen) {
        closeAppleMusicModal();
      } else {
        closeLoginModal();
      }
    }
  });
}

function switchViewMode(mode) {
  state.currentMode = mode;
  albumDetailView.classList.add('hidden');
  const playlistSection = document.getElementById('playlistSection');
  const tabPlaylist = document.getElementById('tabPlaylist');

  if (mode === 'home') {
    if (tabHome) tabHome.classList.add('active');
    if (tabAlbums) tabAlbums.classList.remove('active');
    if (tabTracks) tabTracks.classList.remove('active');
    if (tabPlaylist) tabPlaylist.classList.remove('active');
    if (homeSection) homeSection.classList.remove('hidden');
    if (catalogSection) catalogSection.classList.add('hidden');
    if (playlistSection) playlistSection.classList.add('hidden');
    searchHeaderTitle.innerText = 'BUSCA CUALQUIER ARTISTA O CANCIÓN';
    searchHeaderSub.innerHTML = 'Escribe cualquier artista o canción para explorar discografías completas y sencillos en alta calidad.';
    searchInput.placeholder = 'Busca cualquier artista o canción...';
    return;
  }

  if (mode === 'playlist') {
    if (tabPlaylist) tabPlaylist.classList.add('active');
    if (tabHome) tabHome.classList.remove('active');
    if (tabAlbums) tabAlbums.classList.remove('active');
    if (tabTracks) tabTracks.classList.remove('active');
    if (homeSection) homeSection.classList.add('hidden');
    if (catalogSection) catalogSection.classList.add('hidden');
    if (playlistSection) playlistSection.classList.remove('hidden');
    searchHeaderTitle.innerText = 'TU COLECCIÓN PRIVADA EN 3D';
    searchHeaderSub.innerHTML = 'Disfruta de tus canciones guardadas en el carrusel Coverflow 3D interactivo.';
    loadUserPlaylist();
    return;
  }

  if (homeSection) homeSection.classList.add('hidden');
  if (playlistSection) playlistSection.classList.add('hidden');
  if (tabPlaylist) tabPlaylist.classList.remove('active');
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

  const artistDetailView = document.getElementById('artistDetailView');
  if (artistDetailView) artistDetailView.classList.add('hidden');
  if (homeSection) homeSection.classList.add('hidden');
  if (albumDetailView) albumDetailView.classList.add('hidden');
  if (playlistSection) playlistSection.classList.add('hidden');
  catalogSection.classList.remove('hidden');
  window.scrollTo({ top: catalogSection.offsetTop - 80, behavior: 'smooth' });

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
        a.artist = getFullArtistCredits(a.artist, a.title);
        const cleanTitle = a.title.toLowerCase().replace(/[\(\[].*?[\)\]]/g, '').replace(/-\s*single/gi, '').trim();

        const existingIdx = combined.findIndex(ex => {
          const exClean = ex.title.toLowerCase().replace(/[\(\[].*?[\)\]]/g, '').replace(/-\s*single/gi, '').trim();
          if (exClean !== cleanTitle) return false;
          const exA = (ex.artist || '').toLowerCase();
          const aA = (a.artist || '').toLowerCase();
          const primaryEx = exA.split(/\s*(?:&|&amp;|,|[xX]|ft\.?|feat\.?|con)\s*/i)[0].trim();
          const primaryA = aA.split(/\s*(?:&|&amp;|,|[xX]|ft\.?|feat\.?|con)\s*/i)[0].trim();
          return exA.includes(primaryA) || aA.includes(primaryEx);
        });

        if (existingIdx !== -1) {
          const existing = combined[existingIdx];
          const aHasCollab = a.artist.includes('&') || a.artist.includes('x') || a.artist.includes('feat') || a.artist.includes(',');
          const exHasCollab = existing.artist.includes('&') || existing.artist.includes('x') || existing.artist.includes('feat') || existing.artist.includes(',');
          if (aHasCollab && !exHasCollab) {
            existing.artist = a.artist;
          }
          return;
        }

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

      // Mapa de artistas enriquecidos con colaboraciones completas (indexado por título + artista principal)
      const collabMap = new Map();
      (backendData.data || []).forEach(t => {
        const normT = (t.title || '').toLowerCase().replace(/[\(\[].*?[\)\]]/g, '').trim();
        const primaryA = (t.artist || '').toLowerCase().split(/\s*(?:&|&amp;|,|[xX]|ft\.?|feat\.?|con)\s*/i)[0].trim();
        const key = `${normT}:::${primaryA}`;
        if (t.artist && (t.artist.includes('&') || t.artist.includes('x') || t.artist.includes('X') || t.artist.includes('feat') || t.artist.includes('ft') || t.artist.includes(','))) {
          if (!collabMap.has(key)) collabMap.set(key, t.artist);
        }
      });

      const combinedTracks = [];

      function addTrack(t) {
        if (!t || !t.title || !t.artist) return;
        t.artist = getFullArtistCredits(t.artist, t.title);
        const normT = (t.title || '').toLowerCase().replace(/[\(\[].*?[\)\]]/g, '').trim();
        const primaryT = (t.artist || '').toLowerCase().split(/\s*(?:&|&amp;|,|[xX]|ft\.?|feat\.?|con)\s*/i)[0].trim();
        
        // Solo son la misma canción si coinciden en título Y en artista principal
        const existingIdx = combinedTracks.findIndex(existing => {
          const eNorm = (existing.title || '').toLowerCase().replace(/[\(\[].*?[\)\]]/g, '').trim();
          if (eNorm !== normT) return false;
          const ePrimary = (existing.artist || '').toLowerCase().split(/\s*(?:&|&amp;|,|[xX]|ft\.?|feat\.?|con)\s*/i)[0].trim();
          const eFull = (existing.artist || '').toLowerCase();
          const tFull = (t.artist || '').toLowerCase();
          return eFull.includes(primaryT) || tFull.includes(ePrimary) || (existing.id === t.id);
        });

        if (existingIdx !== -1) {
          const existing = combinedTracks[existingIdx];
          const newHasCollab = t.artist.includes('&') || t.artist.includes('x') || t.artist.includes('feat') || t.artist.includes(',');
          const oldHasCollab = existing.artist.includes('&') || existing.artist.includes('x') || existing.artist.includes('feat') || existing.artist.includes(',');
          if (newHasCollab && !oldHasCollab) {
            existing.artist = t.artist;
          }
          return;
        }

        combinedTracks.push(t);
      }

      // 1° Agregar pistas del backend (que ya vienen enriquecidas con todos los colaboradores)
      (backendData.data || []).forEach(t => addTrack(t));

      // 2° Agregar pistas de Deezer JSONP con enriquecimiento de colaboradores
      if (dzTrackData && Array.isArray(dzTrackData.data)) {
        dzTrackData.data.forEach(t => {
          const normT = (t.title || '').toLowerCase().replace(/[\(\[].*?[\)\]]/g, '').trim();
          let artistName = t.artist ? t.artist.name : 'Artista';
          const primaryA = artistName.toLowerCase().split(/\s*(?:&|&amp;|,|[xX]|ft\.?|feat\.?|con)\s*/i)[0].trim();
          const key = `${normT}:::${primaryA}`;
          if (collabMap.has(key)) {
            artistName = collabMap.get(key);
          }
          artistName = getFullArtistCredits(artistName, t.title);

          addTrack({
            id: `deezer_${t.id}`,
            title: t.title,
            artist: artistName,
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
        <p class="album-artist">${formatArtistPills(album.artist)}</p>
        <div class="btn-open-album">VER ÁLBUM COMPLETO ➔</div>
      </div>
    `;

    card.addEventListener('click', (e) => {
      if (e.target.closest('.artist-clickable-pill') || e.target.closest('.artist-clickable')) return;
      openAlbumDetail(album.id);
    });

    resultsGrid.appendChild(card);
  });
}

// Abrir Vista Detallada del Álbum con TODAS sus canciones y DESCARGA COMPLETA
async function openAlbumDetail(albumId) {
  state.previousMode = state.currentMode || 'album_detail';
  const artistDetailView = document.getElementById('artistDetailView');
  if (artistDetailView) artistDetailView.classList.add('hidden');
  if (homeSection) homeSection.classList.add('hidden');
  if (catalogSection) catalogSection.classList.add('hidden');
  const playlistSection = document.getElementById('playlistSection');
  if (playlistSection) playlistSection.classList.add('hidden');
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
    const cleanId = String(albumId).startsWith('deezer_') ? String(albumId).replace('deezer_', '') : albumId;

    // Si es de Deezer o numérico, obtener directo por JSONP (más rápido y sin bloqueos)
    if (String(albumId).startsWith('deezer_') || /^\d+$/.test(String(albumId))) {
      const dzData = await fetchDeezerJsonp(`/album/${cleanId}`);
      if (dzData && !dzData.error) {
        let albumArtistName = dzData.artist ? dzData.artist.name : 'Artista';
        if (dzData.contributors && Array.isArray(dzData.contributors) && dzData.contributors.length > 0) {
          const names = dzData.contributors.map(c => c.name).filter(Boolean);
          if (names.length > 0) albumArtistName = names.join(' x ');
        }

        album = {
          id: `deezer_${dzData.id}`,
          deezerId: dzData.id,
          title: dzData.title || 'Álbum',
          artist: albumArtistName,
          coverXl: dzData.cover_xl || dzData.cover_big || dzData.cover_medium,
          releaseDate: dzData.release_date || 'Oficial',
          label: dzData.label || 'Discográfica',
          nbTracks: dzData.nb_tracks || (dzData.tracks?.data?.length || 0),
          link: dzData.link || `https://www.deezer.com/album/${dzData.id}`,
          lucidaAlbumZipUrl: `https://lucida.to/?url=${encodeURIComponent(dzData.link || `https://www.deezer.com/album/${dzData.id}`)}`,
          tracks: (dzData.tracks?.data || []).map((t, idx) => {
            let trackArtist = t.artist ? t.artist.name : albumArtistName;
            if (dzData.contributors && dzData.contributors.length > 1) {
              trackArtist = albumArtistName;
            }
            trackArtist = getFullArtistCredits(trackArtist, t.title);
            return {
              position: t.track_position || idx + 1,
              id: `deezer_${t.id}`,
              title: t.title,
              artist: trackArtist,
              duration: t.duration || 0,
              preview: t.preview || null,
              link: t.link || `https://www.deezer.com/track/${t.id}`,
              lucidaUrl: `https://lucida.to/?url=${encodeURIComponent(t.link || `https://www.deezer.com/track/${t.id}`)}`
            };
          })
        };
      }
    }

    // Si no fue de Deezer o falló, consultar al backend
    if (!album) {
      try {
        const res = await fetch(`/api/album/${albumId}`);
        album = await res.json();
      } catch (_) {}
    }

    if (!album || album.error || !album.tracks || !Array.isArray(album.tracks) || album.tracks.length === 0) {
      albumHeroContent.innerHTML = `
        <div style="text-align: center; width: 100%; padding: 3rem 1rem;">
          <h3 style="color: var(--vice-pink); font-family: var(--font-display); margin-bottom: 0.8rem;">ÁLBUM O SENCILLO INDIVIDUAL</h3>
          <p style="color: var(--text-dim); font-size: 0.9rem; margin-bottom: 1.5rem;">Esta pista forma parte de un lanzamiento individual o su discografía está disponible en el perfil del artista.</p>
          <button class="vice-btn-primary" id="btnAlbumFallbackArtist" style="margin: 0 auto; display: inline-flex;">
            💿 EXPLORAR DISCOGRAFÍA DEL ARTISTA
          </button>
        </div>
      `;
      const btnFallback = document.getElementById('btnAlbumFallbackArtist');
      if (btnFallback) {
        btnFallback.addEventListener('click', () => {
          const t = state.contextTrack || state.currentTrack;
          if (t && t.artist) {
            openArtistProfile(t.artist);
          } else {
            switchViewMode('albums');
          }
        });
      }
      return;
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
        <p class="album-hero-artist">Por <strong>${formatArtistPills(album.artist)}</strong></p>
        <div class="album-hero-details">
          <span>📅 Lanzamiento: ${album.releaseDate}</span>
          <span>💿 ${album.nbTracks} Canciones</span>
          <span>🏷️ ${album.label || 'Oficial'}</span>
        </div>
        <div class="album-hero-actions">
          <!-- BOTÓN PRINCIPAL: DESCARGAR ÁLBUM COMPLETO EN FLAC -->
          <button class="vice-btn-primary btn-download-full-album" style="background: linear-gradient(135deg, #00f0ff, #ff2a85); font-size: 0.95rem; padding: 0.9rem 1.8rem;">
            <span>📦 DESCARGAR ÁLBUM COMPLETO (FLAC .ZIP)</span>
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
      const fullRowArtist = getFullArtistCredits(track.artist || album.artist, track.title);
      const trackObj = {
        title: track.title,
        artist: fullRowArtist,
        album: album.title,
        cover: album.coverXl,
        preview: track.preview,
        duration: track.duration,
        videoId: track.videoId || ''
      };
      const trackKey = getTrackKey(trackObj);
      const isSelected = state.selectedTracks.has(trackKey);
      trackRow.className = `album-track-item ${isSelected ? 'is-selected' : ''}`;

      const trackNum = (track.position || index + 1).toString().padStart(2, '0');
      const durationMin = formatTime(track.duration);

      trackRow.innerHTML = `
        <div class="track-number">
          <label class="custom-track-checkbox row-track-checkbox" title="Seleccionar canción">
            <input type="checkbox" class="track-select-cb" data-track-key="${trackKey}" ${isSelected ? 'checked' : ''}>
            <span class="cb-checkmark"></span>
          </label>
          <span>${trackNum}</span>
        </div>
        <div class="track-main-info">
          <h4 title="${track.title}">${track.title}</h4>
          <p>${formatArtistPills(fullRowArtist)}</p>
        </div>
        <div class="track-duration">${durationMin}</div>
        <div class="track-actions">
          <button class="btn-rank-action btn-album-preview" title="Escuchar preview">
            ▶ <span>PREVIEW</span>
          </button>
          <button class="btn-rank-action btn-album-full" title="Escuchar Canción Completa">
            🎧 <span>COMPLETA</span>
          </button>
          <button class="btn-track-more" title="Más opciones (Descargar MP3, FLAC, Cola)">
            <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
              <circle cx="5" cy="12" r="2.2"></circle>
              <circle cx="12" cy="12" r="2.2"></circle>
              <circle cx="19" cy="12" r="2.2"></circle>
            </svg>
          </button>
        </div>
      `;

      // Escuchar muestra de 30s
      trackRow.querySelector('.btn-album-preview').addEventListener('click', () => {
        if (!track.preview) {
          showToast('⚠️ Muestra de 30s no disponible. Reproduciendo canción completa oficial...');
          playFullSong(fullRowArtist, track.title, album.coverXl, album.title, track.duration, track.preview);
          return;
        }
        loadTrack({
          title: track.title,
          artist: fullRowArtist,
          cover: album.coverXl,
          album: album.title,
          audioUrl: track.preview
        });
      });

      // Escuchar Canción Completa (Audio Oficial en segundo plano)
      trackRow.querySelector('.btn-album-full').addEventListener('click', () => {
        playFullSong(fullRowArtist, track.title, album.coverXl, album.title, track.duration, track.preview);
      });

      // Menú de 3 puntos: Descargas MP3/FLAC, añadir a cola, etc.
      trackRow.querySelector('.btn-track-more').addEventListener('click', (e) => {
        e.stopPropagation();
        openTrackContextMenu({
          title: track.title,
          artist: track.artist || album.artist,
          album: album.title,
          albumId: album.id,
          cover: album.coverXl,
          preview: track.preview,
          audioUrl: track.preview || track.audioUrl,
          lucidaUrl: track.lucidaUrl,
          releaseDate: album.releaseDate,
          position: track.position || (index + 1),
          totalTracks: album.tracks ? album.tracks.length : null,
          label: album.label
        }, e.currentTarget);
      });

      const cb = trackRow.querySelector('.track-select-cb');
      if (cb) {
        cb.addEventListener('click', e => e.stopPropagation());
        cb.addEventListener('change', e => {
          e.stopPropagation();
          toggleTrackSelection(trackObj, cb.checked, trackRow);
        });
      }

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
    const trackKey = getTrackKey(track);
    const isSelected = state.selectedTracks.has(trackKey);
    card.className = `album-card track-card-modern ${isSelected ? 'is-selected' : ''}`;

    card.innerHTML = `
      <label class="custom-track-checkbox card-track-checkbox" title="Seleccionar canción">
        <input type="checkbox" class="track-select-cb" data-track-key="${trackKey}" ${isSelected ? 'checked' : ''}>
        <span class="cb-checkmark"></span>
      </label>

      <div class="album-cover-wrapper" title="Clic para escuchar canción">
        <img class="album-cover" src="${track.coverXl}" alt="${track.title}" loading="lazy" onerror="this.src='https://via.placeholder.com/400/1a0933/ff2a85?text=VICE'">
        <div class="cover-overlay-hint">
          <span>🎧 ESCUCHAR</span>
        </div>
        ${(track.album && track.albumId) ? `
          <button class="btn-card-album-link" data-album-id="${track.albumId}" title="Ver álbum completo: ${escapeHtml(track.album)}">
            💿 Ver Álbum
          </button>
        ` : (track.album ? `
          <span class="album-badge-tracks" style="background: rgba(0, 240, 255, 0.2); border: 1px solid var(--vice-cyan); color: var(--vice-cyan);">
            💿 ${track.album}
          </span>
        ` : '')}
      </div>

      <div class="album-info">
        <h3 class="album-title" title="${track.title}" style="cursor: pointer;">${track.title}</h3>
        <p class="album-artist">${formatArtistPills(track.artist)}</p>
        
        <div class="track-card-actions-single">
          <button class="btn-card-action btn-card-preview btn-single-play" title="Escuchar preview (30s)">
            ▶ <span>PREVIEW</span>
          </button>
          <button class="btn-card-action btn-card-full btn-single-full" title="Escuchar canción completa">
            🎧 <span>COMPLETA</span>
          </button>
          <button class="btn-track-more btn-single-more" title="Más opciones (Descargar MP3 320, FLAC, Cola, Álbum)">
            <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
              <circle cx="5" cy="12" r="2.2"></circle>
              <circle cx="12" cy="12" r="2.2"></circle>
              <circle cx="19" cy="12" r="2.2"></circle>
            </svg>
          </button>
        </div>
      </div>
    `;

    // Checkbox de multi-selección
    const cb = card.querySelector('.track-select-cb');
    if (cb) {
      cb.addEventListener('click', (e) => e.stopPropagation());
      cb.addEventListener('change', (e) => {
        e.stopPropagation();
        toggleTrackSelection(track, cb.checked, card);
      });
    }

    // Clic en la carátula: REPRODUCE LA CANCIÓN INDIVIDUAL
    card.querySelector('.album-cover-wrapper').addEventListener('click', (e) => {
      const albumBtn = e.target.closest('.btn-card-album-link');
      if (albumBtn && track.albumId) {
        e.stopPropagation();
        openAlbumDetail(track.albumId);
        return;
      }
      e.stopPropagation();
      playFullSong(track.artist, track.title, track.coverXl, track.album, track.duration, track.preview);
    });

    const albumBadgeBtn = card.querySelector('.btn-card-album-link');
    if (albumBadgeBtn && track.albumId) {
      albumBadgeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openAlbumDetail(track.albumId);
      });
    }

    card.querySelector('.album-title').addEventListener('click', (e) => {
      e.stopPropagation();
      playFullSong(track.artist, track.title, track.coverXl, track.album, track.duration, track.preview);
    });

    card.querySelector('.btn-single-play').addEventListener('click', (e) => {
      e.stopPropagation();
      loadTrack({
        title: track.title,
        artist: track.artist,
        cover: track.coverXl,
        audioUrl: track.preview,
        duration: track.duration,
        album: track.album
      });
    });

    card.querySelector('.btn-single-full').addEventListener('click', (e) => {
      e.stopPropagation();
      playFullSong(track.artist, track.title, track.coverXl, track.album, track.duration, track.preview);
    });

    const moreBtn = card.querySelector('.btn-single-more');
    if (moreBtn) {
      moreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openTrackContextMenu({
          title: track.title,
          artist: track.artist,
          album: track.album,
          albumId: track.albumId,
          cover: track.coverXl,
          preview: track.preview,
          audioUrl: track.preview || track.audioUrl,
          lucidaUrl: track.lucidaUrl,
          releaseDate: track.releaseDate,
          label: track.genre || 'Vice Music'
        }, e.currentTarget);
      });
    }

    resultsGrid.appendChild(card);
  });
}

// ========================================================
// SISTEMA DE PERFIL DE ARTISTA (SPOTIFY / APPLE MUSIC STYLE)
function normalizeStr(str) {
  return (str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function parseDurationSec(raw) {
  if (!raw) return 0;
  if (typeof raw === 'number') return raw;
  const str = String(raw).trim();
  if (str.includes(':')) {
    const parts = str.split(':').map(Number);
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return parseInt(str, 10) || 0;
}

function cleanArtistName(raw) {
  let name = (raw || '').replace(/^[\(\[\{\s\.,:;\-–—]+|[\)\]\}\s\.,:;\-–—]+$/g, '').trim();
  name = name.replace(/^(?:ft\.?|feat\.?|con|y|and|&|x)\s+/i, '').trim();
  name = name.replace(/\s*(?:&|&amp;|,|[xX]|ft\.?|feat\.?|con)$/i, '').trim();
  return name.replace(/^[\(\[\{\s\.,:;\-–—]+|[\)\]\}\s\.,:;\-–—]+$/g, '').trim();
}

function getFullArtistCredits(artist, title) {
  let fullArtist = (artist || '').trim();
  if (!title) return fullArtist;

  const featMatch = title.match(/[\(\[]\s*(?:feat\.?|ft\.?|con)\s+([^\)\]]+)[\)\]]/i);
  if (featMatch && featMatch[1]) {
    const existingTokens = fullArtist
      .split(/\s*(?:&|&amp;|,|\/|\\|[xX]|ft\.?|feat\.?|con)\s*/i)
      .map(t => normalizeStr(cleanArtistName(t)))
      .filter(Boolean);

    const featTokens = featMatch[1]
      .split(/\s*(?:&|&amp;|,|\/|\\|[xX]|ft\.?|feat\.?|con)\s*/i)
      .map(t => cleanArtistName(t))
      .filter(Boolean);

    const newArtists = featTokens.filter(fa => {
      const normFa = normalizeStr(fa);
      if (!normFa || normFa.length < 2) return false;
      return !existingTokens.some(ex => ex === normFa || ex.includes(normFa) || normFa.includes(ex));
    });

    if (newArtists.length > 0) {
      fullArtist = `${fullArtist} ft. ${newArtists.join(', ')}`;
    }
  }
  return fullArtist;
}

function formatArtistPills(artistString) {
  if (!artistString) return '';
  const rawParts = artistString.split(/\s*(?:&amp;|&|,|\/|\\|[xX]|\bft\.?|\bfeat\.?|\bcon\b)\s*/i);
  const seen = new Set();
  const validPills = [];

  for (let i = 0; i < rawParts.length; i++) {
    const name = cleanArtistName(rawParts[i]);
    if (!name || name.length < 2 || /^(?:&|&amp;|,|[xX]|ft\.?|feat\.?|con|y|and)$/i.test(name)) continue;
    const norm = normalizeStr(name);
    if (!seen.has(norm)) {
      seen.add(norm);
      validPills.push(name);
    }
  }

  if (validPills.length === 0) return escapeHtml(artistString);

  return validPills.map((name, idx) => {
    const pill = `<span class="artist-clickable-pill" data-artist="${escapeHtml(name)}" title="Ver perfil de ${escapeHtml(name)}">${escapeHtml(name)}</span>`;
    if (idx === 0) return pill;
    return `<span class="artist-separator">x</span> ${pill}`;
  }).join(' ');
}

// Global delegate para clicks en pastillas de artistas individuales
document.addEventListener('click', (e) => {
  const pill = e.target.closest('.artist-clickable-pill');
  if (pill) {
    e.stopPropagation();
    e.preventDefault();
    const artist = pill.getAttribute('data-artist');
    if (artist) openArtistProfile(artist);
  }
});

// ========================================================
async function openArtistProfile(artistName) {
  if (!artistName) return;
  const cleanName = artistName.split(/\s*(?:x|X|&|ft\.?|feat\.?|con|,)\s*/i)[0].trim() || artistName.trim();

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
              <span class="ranking-track-artist">${formatArtistPills(track.artist ? (track.artist.name || track.artist) : artistName)}</span>
            </div>
          </div>
          <div class="ranking-album-cell">
            <span class="ranking-album-link" title="${albumTitle}">${albumTitle}</span>
          </div>
          <div class="ranking-time-cell">${durationFormatted}</div>
          <div class="ranking-actions-cell">
            <button class="btn-rank-action btn-rank-play" title="Escuchar preview">▶ <span>PREVIEW</span></button>
            <button class="btn-rank-action btn-rank-full" title="Escuchar completa">🎧 <span>COMPLETA</span></button>
            <button class="btn-track-more" title="Más opciones (Descargar MP3, FLAC, Cola)">
              <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                <circle cx="5" cy="12" r="2.2"></circle>
                <circle cx="12" cy="12" r="2.2"></circle>
                <circle cx="19" cy="12" r="2.2"></circle>
              </svg>
            </button>
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
          playFullSong(track.artist ? track.artist.name : artistName, track.title, cover, albumTitle, track.duration, track.preview);
        });
        row.querySelector('.btn-track-more').addEventListener('click', (e) => {
          e.stopPropagation();
          openTrackContextMenu({
            title: track.title,
            artist: track.artist ? track.artist.name : artistName,
            cover: cover,
            album: albumTitle,
            preview: track.preview,
            audioUrl: track.preview,
            lucidaUrl: track.lucidaUrl
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
    const fullTrackArtist = getFullArtistCredits(track.artist ? (track.artist.name || track.artist) : artistName, track.title);

    card.innerHTML = `
      <div class="album-cover-wrapper" title="Clic para escuchar o ver álbum">
        <img class="album-cover" src="${cover}" alt="${track.title}" loading="lazy">
        <div class="cover-overlay-hint"><span>${albumId ? '💿 VER ÁLBUM' : '▶ ESCUCHAR'}</span></div>
      </div>
      <div class="album-info">
        <h3 class="album-title" title="${track.title}">${track.title}</h3>
        <p class="album-artist">${formatArtistPills(fullTrackArtist)}</p>
        <div class="track-card-actions-single">
          <button class="btn-card-action btn-card-preview btn-single-play" title="Escuchar preview">
            ▶ <span>PREVIEW</span>
          </button>
          <button class="btn-card-action btn-card-full btn-single-full" title="Escuchar completa">
            🎧 <span>COMPLETA</span>
          </button>
          <button class="btn-track-more btn-single-more" title="Más opciones (Descargar MP3 320, FLAC, Cola, Álbum)">
            <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
              <circle cx="5" cy="12" r="2.2"></circle>
              <circle cx="12" cy="12" r="2.2"></circle>
              <circle cx="19" cy="12" r="2.2"></circle>
            </svg>
          </button>
        </div>
      </div>
    `;

    card.querySelector('.album-cover-wrapper').addEventListener('click', (e) => {
      e.stopPropagation();
      if (albumId) openAlbumDetail(albumId);
      else loadTrack({ id: track.id ? `deezer_${track.id}` : null, deezerId: track.id, title: track.title, artist: fullTrackArtist, cover, audioUrl: track.preview, album: albumTitle });
    });

    card.querySelector('.btn-single-play').addEventListener('click', (e) => {
      e.stopPropagation();
      loadTrack({ id: track.id ? `deezer_${track.id}` : null, deezerId: track.id, title: track.title, artist: fullTrackArtist, cover, audioUrl: track.preview, album: albumTitle });
    });

    card.querySelector('.btn-single-full').addEventListener('click', (e) => {
      e.stopPropagation();
      state.currentTrack = { id: track.id ? `deezer_${track.id}` : null, deezerId: track.id, title: track.title, artist: fullTrackArtist };
      playFullSong(fullTrackArtist, track.title, cover, albumTitle, track.duration, track.preview);
    });

    const moreBtn = card.querySelector('.btn-single-more');
    if (moreBtn) {
      moreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openTrackContextMenu({
          title: track.title,
          artist: fullTrackArtist,
          album: albumTitle,
          albumId: albumId,
          cover: cover,
          preview: track.preview,
          audioUrl: track.preview,
          lucidaUrl: track.lucidaUrl
        }, e.currentTarget);
      });
    }

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
      playPreviousTrack();
    }],
    ['nexttrack', () => {
      playNextTrack();
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
let currentPlayRequestId = 0;

function loadTrack(track) {
  if (!track) return;

  currentPlayRequestId++;

  // Detener YouTube si estaba sonando para evitar duplicidad de audio
  if (ytPlayer && typeof ytPlayer.stopVideo === 'function') {
    try { ytPlayer.stopVideo(); } catch (_) {}
    stopYtProgress();
  }

  let fullArtist = getFullArtistCredits(track.artist, track.title);
  if (state.currentAlbum && state.currentAlbum.artist) {
    const albArt = state.currentAlbum.artist;
    if ((albArt.includes('x') || albArt.includes('&') || albArt.includes('feat') || albArt.includes(',')) && 
        !fullArtist.includes('x') && !fullArtist.includes('&') && !fullArtist.includes('feat') && !fullArtist.includes(',')) {
      fullArtist = albArt;
    }
  }
  track.artist = fullArtist;

  // Si la pista solo tiene 1 artista y proviene de Deezer, verificar colaboradores de la canción en segundo plano
  if (!fullArtist.includes('&') && !fullArtist.includes('x') && !fullArtist.includes('X') && !fullArtist.includes('feat') && !fullArtist.includes(',')) {
    const trkId = (track.id && track.id.startsWith('deezer_'))
      ? track.id.replace('deezer_', '')
      : (track.deezerId || null);

    if (trkId) {
      fetchDeezerJsonp(`/track/${trkId}`).then(dzTrk => {
        if (dzTrk && dzTrk.contributors && Array.isArray(dzTrk.contributors) && dzTrk.contributors.length > 1) {
          const names = dzTrk.contributors.map(c => c.name).filter(Boolean);
          if (names.length > 1) {
            const enriched = names.join(' x ');
            if (state.currentTrack && state.currentTrack.title === track.title) {
              state.currentTrack.artist = enriched;
              playerArtist.innerHTML = formatArtistPills(enriched);
              if (amTrackArtist) amTrackArtist.innerHTML = formatArtistPills(enriched);
              updateMediaSession(state.currentTrack);
              document.querySelectorAll('.album-card, .album-track-item, .ranking-row').forEach(card => {
                const titleEl = card.querySelector('.album-title, h4, .ranking-track-title');
                if (titleEl && titleEl.innerText.trim().toLowerCase() === track.title.trim().toLowerCase()) {
                  const artEl = card.querySelector('.album-artist, .track-main-info p, .ranking-track-artist');
                  if (artEl) artEl.innerHTML = formatArtistPills(enriched);
                }
              });
            }
          }
        }
      }).catch(() => {});
    } else {
      const albId = track.albumId || (state.currentAlbum && state.currentAlbum.id);
      if (albId && albId.startsWith('deezer_')) {
        const dzId = albId.replace('deezer_', '');
        fetchDeezerJsonp(`/album/${dzId}`).then(dzAlb => {
          if (dzAlb && dzAlb.contributors && dzAlb.contributors.length > 1) {
            const names = dzAlb.contributors.map(c => c.name).filter(Boolean);
            if (names.length > 1) {
              const enriched = names.join(' x ');
              if (state.currentTrack && state.currentTrack.title === track.title) {
                state.currentTrack.artist = enriched;
                playerArtist.innerHTML = formatArtistPills(enriched);
                if (amTrackArtist) amTrackArtist.innerHTML = formatArtistPills(enriched);
                updateMediaSession(state.currentTrack);
                document.querySelectorAll('.album-card, .album-track-item, .ranking-row').forEach(card => {
                  const titleEl = card.querySelector('.album-title, h4, .ranking-track-title');
                  if (titleEl && titleEl.innerText.trim().toLowerCase() === track.title.trim().toLowerCase()) {
                    const artEl = card.querySelector('.album-artist, .track-main-info p, .ranking-track-artist');
                    if (artEl) artEl.innerHTML = formatArtistPills(enriched);
                  }
                });
              }
            }
          }
        }).catch(() => {});
      }
    }
  }

  state.playbackSource = 'preview';
  state.currentTrack = track;
  playerTitle.innerText = track.title;
  playerArtist.innerHTML = formatArtistPills(track.artist || 'Artista');
  playerCover.src = track.cover || 'https://via.placeholder.com/80/1a0933/ff2a85?text=VI';

  if (playerModeBadge) {
    playerModeBadge.innerText = 'PREVIEW 30S';
    playerModeBadge.className = 'spec-pill';
  }

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
  updateAppleMusicTrackInfo(track);

  if (track.audioUrl) {
    state.audio.loop = false;
    state.audio.volume = 1;
    state.audio.src = track.audioUrl;
    state.audio.playbackRate = state.currentSpeed;
    state.audio.play().then(() => {
      setPlayingState(true);
      updateMediaSession(track);
    }).catch(() => setPlayingState(false));
  }
}

function primeAudioPlayback() {
  if (state.audio) {
    if (!state.audio.src) {
      state.audio.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
    }
    try {
      const p = state.audio.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (_) {}
  }
}

// PRE-CARGAR LA SIGUIENTE CANCIÓN PARA TRANSICIÓN FLUIDA CON PANTALLA APAGADA
function prefetchNextTrack() {
  try {
    let nextTrack = null;
    if (state.queue && state.queue.length > 0) {
      nextTrack = state.queue[0];
    } else if (state.currentMode === 'playlist' && state.userPlaylist && state.userPlaylist.length > 0) {
      const curIdx = state.activeCoverflowIndex;
      if (curIdx + 1 < state.userPlaylist.length) {
        nextTrack = state.userPlaylist[curIdx + 1];
      }
    } else if (state.currentAlbum && Array.isArray(state.currentAlbum.tracks)) {
      const curTitle = state.currentTrack ? state.currentTrack.title.trim().toLowerCase() : '';
      const curIdx = state.currentAlbum.tracks.findIndex(t => t.title && t.title.trim().toLowerCase() === curTitle);
      if (curIdx !== -1 && curIdx + 1 < state.currentAlbum.tracks.length) {
        nextTrack = state.currentAlbum.tracks[curIdx + 1];
      }
    }

    if (nextTrack && !nextTrack.videoId && !nextTrack._prefetching) {
      nextTrack._prefetching = true;
      const durParam = nextTrack.duration || 0;
      fetch(`/api/fullaudio?q=${encodeURIComponent((nextTrack.artist || '') + ' ' + (nextTrack.title || ''))}&artist=${encodeURIComponent(nextTrack.artist || '')}&title=${encodeURIComponent(nextTrack.title || '')}&duration=${encodeURIComponent(durParam)}`)
        .then(r => r.json())
        .then(d => {
          if (d && d.videoId) {
            nextTrack.videoId = d.videoId;
            if (d.resolvedArtist) nextTrack._resolvedArtist = d.resolvedArtist;
          }
        })
        .catch(() => {})
        .finally(() => { nextTrack._prefetching = false; });
    }
  } catch (_) {}
}

// REPRODUCIR CANCIÓN 100% COMPLETA (RESPUESTA INSTANTÁNEA + METADATOS LIMPIOS HD)
async function playFullSong(artist, title, cover = null, album = null, duration = 0, preview = null, videoId = null) {
  const thisRequestId = ++currentPlayRequestId;
  primeAudioPlayback();

  // Pausar audio anterior y detener timers inmediatamente para evitar saltos en la barra de progreso
  stopYtProgress();
  if (ytPlayer && typeof ytPlayer.pauseVideo === 'function') {
    try { ytPlayer.pauseVideo(); } catch (_) {}
  }
  if (state.audio) {
    try {
      state.audio.pause();
      state.audio.currentTime = 0;
      state.audio.loop = false;
    } catch (_) {}
  }

  let fullArtist = getFullArtistCredits(artist, title);
  if (state.currentAlbum && state.currentAlbum.artist) {
    const albArt = state.currentAlbum.artist;
    if ((albArt.includes('x') || albArt.includes('&') || albArt.includes('feat') || albArt.includes(',')) && 
        !fullArtist.includes('x') && !fullArtist.includes('&') && !fullArtist.includes('feat') && !fullArtist.includes(',')) {
      fullArtist = albArt;
    }
  }

  // Si no se pasó videoId directamente, buscar si la pista ya lo tiene en la playlist guardada
  let resolvedVid = videoId;
  if (!resolvedVid && state.userPlaylist && Array.isArray(state.userPlaylist)) {
    const normTitle = (title || '').trim().toLowerCase();
    const plMatch = state.userPlaylist.find(t => t.title && t.title.trim().toLowerCase() === normTitle);
    if (plMatch && (plMatch.videoId || plMatch.video_id)) {
      resolvedVid = plMatch.videoId || plMatch.video_id;
    }
  }
  if (!resolvedVid && state.currentTrack && state.currentTrack.title === title && state.currentTrack.videoId) {
    resolvedVid = state.currentTrack.videoId;
  }

  state.playbackSource = 'full';
  const trackObj = {
    title,
    artist: fullArtist,
    cover: cover || (state.currentTrack && state.currentTrack.cover) || (state.currentAlbum && state.currentAlbum.coverXl),
    album: album || (state.currentAlbum && state.currentAlbum.title) || title,
    albumId: (state.currentTrack && state.currentTrack.albumId) || (state.currentAlbum && state.currentAlbum.id) || null,
    duration: parseDurationSec(duration || (state.currentTrack && state.currentTrack.duration) || 0),
    preview: preview || (state.currentTrack && state.currentTrack.preview) || '',
    videoId: resolvedVid || null
  };

  if (!state.history) state.history = [];
  if (state.history.length === 0 || state.history[state.history.length - 1].title !== title) {
    state.history.push({ artist: fullArtist, title, cover: trackObj.cover, album: trackObj.album, duration: trackObj.duration });
    if (state.history.length > 50) state.history.shift();
  }

  state.currentTrack = trackObj;

  playerTitle.innerText = title;
  playerArtist.innerHTML = formatArtistPills(fullArtist || 'Artista');
  if (trackObj.cover) {
    playerCover.src = trackObj.cover;
  }
  if (playerModeBadge) {
    playerModeBadge.innerText = '🎧 CANCIÓN COMPLETA';
    playerModeBadge.className = 'spec-pill gold';
  }

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
  const knownDur = trackObj.duration || 0;
  totalTimeLabel.innerText = knownDur > 0 ? formatTime(knownDur) : '00:00';
  progressFill.style.width = '0%';
  progressThumb.style.left = '0%';

  updateMediaSession(trackObj);
  updateAppleMusicTrackInfo(trackObj);
  showToast('🎧 Sintonizando canción completa: ' + title + '...');

  // 1. REPRODUCCIÓN INSTANTÁNEA (<200ms) DIRECTA DESDE CDN (Sin intermediarios ni retardos)
  if (trackObj.videoId) {
    state.playbackSource = 'full';
    initYtPlayer();
    if (ytPlayer && typeof ytPlayer.loadVideoById === 'function') {
      try {
        ytPlayer.loadVideoById(trackObj.videoId);
        ytPlayer.playVideo();
        if (typeof ytPlayer.setPlaybackRate === 'function') {
          ytPlayer.setPlaybackRate(state.currentSpeed);
        }
        setPlayingState(true);
        startYtProgress();
        updateMediaSession(trackObj);
        setTimeout(prefetchNextTrack, 2500);
        return;
      } catch (ytErr) {
        console.warn('[YT Instant Load]', ytErr);
      }
    }
  }

  // Si la pista tiene audio directo (Deezer preview o stream directo) reproducir sin espera
  if (trackObj.preview || trackObj.audioUrl) {
    state.playbackSource = 'preview';
    state.audio.loop = false;
    state.audio.volume = 1;
    state.audio.src = trackObj.preview || trackObj.audioUrl;
    state.audio.playbackRate = state.currentSpeed;
    state.audio.play().then(() => {
      setPlayingState(true);
      updateMediaSession(trackObj);
      setTimeout(prefetchNextTrack, 2500);
    }).catch(() => {});
    return;
  }

  try {
    const durParam = trackObj.duration || 0;
    const res = await fetch(`/api/fullaudio?q=${encodeURIComponent(artist + ' ' + title)}&artist=${encodeURIComponent(artist || '')}&title=${encodeURIComponent(title || '')}&duration=${encodeURIComponent(durParam)}`);
    const data = await res.json();

    if (thisRequestId !== currentPlayRequestId) {
      console.log('[playFullSong] Solicitud antigua cancelada por una acción posterior');
      return;
    }

    if (data.resolvedArtist && (data.resolvedArtist.includes('&') || data.resolvedArtist.includes('x') || data.resolvedArtist.includes('X') || data.resolvedArtist.includes('feat') || data.resolvedArtist.includes(','))) {
      const cleanResolved = data.resolvedArtist.trim();
      if (normalizeStr(cleanResolved) !== normalizeStr(state.currentTrack.artist)) {
        state.currentTrack.artist = cleanResolved;
        playerArtist.innerHTML = formatArtistPills(cleanResolved);
        if (amTrackArtist) amTrackArtist.innerHTML = formatArtistPills(cleanResolved);
        updateMediaSession(state.currentTrack);
      }
    }

    if (data.videoId) {
      state.currentTrack.videoId = data.videoId;
      state.currentTrack.alternativeVideoIds = Array.isArray(data.alternatives) ? [...data.alternatives] : [];

      state.playbackSource = 'full';
      initYtPlayer();
      if (ytPlayer && typeof ytPlayer.loadVideoById === 'function') {
        try {
          ytPlayer.loadVideoById(data.videoId);
          ytPlayer.playVideo();
          setPlayingState(true);
          startYtProgress();
          updateMediaSession(trackObj);
          showToast(`🎧 Reproduciendo: ${title}`);
          setTimeout(prefetchNextTrack, 2500);
          return;
        } catch (ytErr) {
          console.warn('[YT load error]', ytErr);
        }
      }

      const fallbackUrl = trackObj.preview || (state.currentTrack && state.currentTrack.preview) || trackObj.audioUrl;
      if (fallbackUrl) {
        state.playbackSource = 'preview';
        state.audio.src = fallbackUrl;
        state.audio.playbackRate = state.currentSpeed;
        state.audio.play().then(() => {
          setPlayingState(true);
          updateMediaSession(trackObj);
        }).catch(() => {});
        return;
      }
    } else {
      const fallbackUrl = trackObj.preview || (state.currentTrack && state.currentTrack.preview) || (state.currentTrack && state.currentTrack.audioUrl);
      if (fallbackUrl) {
        state.playbackSource = 'preview';
        state.audio.src = fallbackUrl;
        state.audio.playbackRate = state.currentSpeed;
        state.audio.play().then(() => {
          setPlayingState(true);
          updateMediaSession(trackObj);
        }).catch(() => {});
      } else {
        showToast('❌ No se encontró el stream oficial para esta canción.');
      }
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
let dlHideTimeout = null;

function setDownloadProgress(percent, stepText, trackName) {
  if (dlHideTimeout) {
    clearTimeout(dlHideTimeout);
    dlHideTimeout = null;
  }
  const topBar = document.getElementById('topProgressBar');
  const topFill = document.getElementById('topProgressFill');
  const widget = document.getElementById('dlFloatingWidget');
  const widgetTrack = document.getElementById('dlWidgetTrack');
  const widgetPercent = document.getElementById('dlWidgetPercent');
  const widgetFill = document.getElementById('dlWidgetBarFill');
  const widgetStep = document.getElementById('dlWidgetStep');
  const queueBadge = document.getElementById('dlWidgetQueueBadge');

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
    if (queueBadge) {
      if (downloadQueue && downloadQueue.length > 0) {
        queueBadge.textContent = `+${downloadQueue.length} en espera`;
        queueBadge.classList.remove('hidden');
      } else {
        queueBadge.classList.add('hidden');
      }
    }
  }
}

function hideDownloadProgress() {
  if (dlProgressTimer) {
    clearInterval(dlProgressTimer);
    dlProgressTimer = null;
  }
  if (dlHideTimeout) {
    clearTimeout(dlHideTimeout);
    dlHideTimeout = null;
  }
  const topBar = document.getElementById('topProgressBar');
  const topFill = document.getElementById('topProgressFill');
  const widget = document.getElementById('dlFloatingWidget');

  if (topFill) topFill.style.width = '100%';
  if (widget) {
    const widgetPercent = document.getElementById('dlWidgetPercent');
    const widgetFill = document.getElementById('dlWidgetBarFill');
    const widgetStep = document.getElementById('dlWidgetStep');
    const queueBadge = document.getElementById('dlWidgetQueueBadge');
    if (widgetPercent) widgetPercent.innerText = '100%';
    if (widgetFill) widgetFill.style.width = '100%';
    if (widgetStep) widgetStep.innerText = '¡Descarga completada!';
    if (queueBadge) queueBadge.classList.add('hidden');
  }

  dlHideTimeout = setTimeout(() => {
    if (downloadQueue.length === 0 && !activeDownloadTrack) {
      if (topBar) topBar.classList.remove('active');
      if (widget) widget.classList.add('hidden');
      if (topFill) topFill.style.width = '0%';
    }
  }, 2200);
}

// ========================================================
// DESCARGAR AUDIO 320 KBPS CON METADATOS OFICIALES Y CARÁTULA HD 1000PX
// (100% EN LA MISMA PÁGINA, CON BARRA DE PROGRESO EN VIVO Y CONTROL ANTI-SPAM)
// ========================================================
async function executeSingleMp3Download(track) {
  if (!track || !track.title) return;
  const artist = track.artist || 'Desconocido';
  const title = track.title || 'Canción';
  const audioUrl = track.audioUrl || track.preview || null;
  const videoId = track.videoId || track.video_id || null;
  const extraMeta = track.extraMeta || {
    album: track.album,
    coverUrl: track.cover || track.coverXl,
    year: track.releaseDate || track.year
  };
  const triggerBtn = track.triggerBtn || null;
  const safeName = `${artist} - ${title}`.replace(/[^\w\s\-\.áéíóúñÁÉÍÓÚÑ]/g, '').trim() || 'cancion';
  const originalBtnHtml = triggerBtn ? triggerBtn.innerHTML : null;

  if (triggerBtn) {
    triggerBtn.disabled = true;
    triggerBtn.innerHTML = `<span>⏳ 320K...</span>`;
    triggerBtn.style.opacity = '0.7';
  }

  setDownloadProgress(10, 'Iniciando conexión con satélite de audio...', safeName);
  showToast(`⚡ Generando MP3 320 kbps: ${title}... Observa la barra de progreso.`);

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
    const coverTarget = extraMeta.coverUrl || track.cover || (state.currentTrack ? state.currentTrack.cover : '');
    const targetVideoId = videoId || (state.currentTrack && state.currentTrack.title === title ? state.currentTrack.videoId : '') || '';

    const trackDuration = track.duration || (extraMeta && extraMeta.duration) || (state.currentTrack && state.currentTrack.title === title ? state.currentTrack.duration : 0) || 0;

    const downloadApiUrl = `/api/download-mp3?q=${encodeURIComponent(artist + ' ' + title)}`
      + `&videoId=${encodeURIComponent(targetVideoId)}`
      + `&title=${encodeURIComponent(title || '')}`
      + `&artist=${encodeURIComponent(artist || '')}`
      + `&duration=${encodeURIComponent(String(trackDuration))}`
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

    setDownloadProgress(25, 'Extrayendo audio estéreo oficial y codificando a 320 kbps...', safeName);

    const response = await fetch(downloadApiUrl);
    if (!response.ok) {
      let errText = 'Error en el servidor (' + response.status + ')';
      try {
        const errJson = await response.json();
        if (errJson && errJson.error) errText = errJson.error;
      } catch (_) {}
      throw new Error(errText);
    }

    setDownloadProgress(45, 'Transfiriendo archivo MP3 con carátula HD...', safeName);

    const reader = response.body.getReader();
    const chunks = [];
    let receivedBytes = 0;
    const contentLength = +(response.headers.get('Content-Length') || 0);

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      receivedBytes += value.length;
      const mb = (receivedBytes / 1048576).toFixed(1);
      let pct = 45;
      if (contentLength > 0) {
        pct = Math.min(98, 45 + Math.round((receivedBytes / contentLength) * 50));
      } else {
        pct = Math.min(96, 45 + Math.round(receivedBytes / 120000));
      }
      setDownloadProgress(pct, `Descargando audio oficial (${mb} MB)...`, safeName);
    }

    setDownloadProgress(99, 'Guardando archivo en tu dispositivo...', safeName);

    const blob = new Blob(chunks, { type: 'audio/mpeg' });
    const blobUrl = URL.createObjectURL(blob);
    const downloadAnchor = document.createElement('a');
    downloadAnchor.style.display = 'none';
    downloadAnchor.href = blobUrl;
    downloadAnchor.download = `${safeName}.mp3`;
    document.body.appendChild(downloadAnchor);
    try {
      downloadAnchor.click();
    } catch (_) {
      const clickEvt = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
      downloadAnchor.dispatchEvent(clickEvt);
    }

    setTimeout(() => {
      try {
        URL.revokeObjectURL(blobUrl);
        if (document.body.contains(downloadAnchor)) document.body.removeChild(downloadAnchor);
      } catch (_) {}
    }, 45000);

    setDownloadProgress(100, '¡Archivo descargado!', safeName);
    showToast(`✅ MP3 descargado: ${safeName}.mp3`);

    // Pausa para que el navegador complete la escritura del archivo
    await new Promise(r => setTimeout(r, 2200));
  } catch (err) {
    if (dlProgressTimer) {
      clearInterval(dlProgressTimer);
      dlProgressTimer = null;
    }
    // Si quedan canciones en cola, no ocultar el widget para mantener la experiencia fluida
    if (downloadQueue.length === 0) {
      const topBar = document.getElementById('topProgressBar');
      const widget = document.getElementById('dlFloatingWidget');
      if (topBar) topBar.classList.remove('active');
      if (widget) widget.classList.add('hidden');
    }

    console.error('[executeSingleMp3Download]', err);
    showToast('❌ Error al descargar MP3: ' + err.message);
    throw err;
  } finally {
    if (triggerBtn && originalBtnHtml !== null) {
      triggerBtn.disabled = false;
      triggerBtn.innerHTML = originalBtnHtml;
      triggerBtn.style.opacity = '1';
    }
  }
}

async function downloadMp3_320(artist, title, audioUrl = null, videoId = null, extraMeta = {}, triggerBtn = null) {
  const track = {
    title,
    artist,
    audioUrl,
    preview: audioUrl,
    duration: (extraMeta && extraMeta.duration) || (extraMeta && extraMeta.time) || 0,
    videoId: videoId || (extraMeta && extraMeta.videoId),
    video_id: videoId || (extraMeta && extraMeta.videoId),
    album: extraMeta && extraMeta.album,
    cover: (extraMeta && (extraMeta.coverUrl || extraMeta.cover)) || '',
    releaseDate: extraMeta && (extraMeta.year || extraMeta.releaseDate),
    extraMeta,
    triggerBtn
  };
  enqueueDownload(track);
}

let togglePlayThrottle = 0;

function togglePlayPause() {
  const now = Date.now();
  if (now - togglePlayThrottle < 300) return;
  togglePlayThrottle = now;

  if (state.playbackSource === 'full') {
    // Asegurar que state.audio esté silenciado y detenido
    if (state.audio) {
      try { state.audio.pause(); } catch (_) {}
    }
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
    // Asegurar que ytPlayer esté detenido
    if (ytPlayer && typeof ytPlayer.pauseVideo === 'function') {
      try { ytPlayer.pauseVideo(); } catch (_) {}
    }
    if (!state.audio.src) return;
    if (state.audio.paused) {
      state.audio.play().then(() => {
        setPlayingState(true);
        if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
        if (state.currentTrack) updateMediaSession(state.currentTrack);
      }).catch(() => setPlayingState(false));
    } else {
      state.audio.pause();
      setPlayingState(false);
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

// SALTAR A LA SIGUIENTE CANCIÓN (ÁLBUM, COLA, RANKING O ALEATORIA)
function playNextTrack() {
  // 1. Si hay canciones en la cola (secuencia programada de playlist o añadidas por el usuario)
  if (state.queue && state.queue.length > 0) {
    const nextItem = state.queue.shift();
    updateQueueBadge();
    renderQueueItems();

    // Sincronizar índice en Coverflow si la pista pertenece a la playlist
    const plIdx = (state.userPlaylist || []).findIndex(t => 
      (t.id && nextItem.id && t.id === nextItem.id) ||
      (t.title && nextItem.title && t.title.trim().toLowerCase() === nextItem.title.trim().toLowerCase())
    );
    if (plIdx !== -1) {
      state.activeCoverflowIndex = plIdx;
      renderCoverflow();
      renderPlaylistTracklist();
    }

    showToast(`⏭️ Siguiente: ${nextItem.title}`);
    playPlaylistTrack(nextItem);
    return;
  }

  // 1.5 Si se está en Playlist Personal 3D: avanzar continuamente a la siguiente canción de la lista
  const curTitle = state.currentTrack ? state.currentTrack.title.trim().toLowerCase() : '';
  const isFromPlaylist = state.currentMode === 'playlist' || (state.userPlaylist && state.userPlaylist.length > 0 && state.userPlaylist.some(t => t.title && t.title.trim().toLowerCase() === curTitle));
  if ((isFromPlaylist || state.isShuffle) && state.userPlaylist && state.userPlaylist.length > 0) {
    const N = state.userPlaylist.length;
    let nextIdx;
    if (state.isShuffle) {
      if (!Array.isArray(state.playedShuffleIds)) state.playedShuffleIds = [];
      const unplayed = state.userPlaylist.filter(t => !state.playedShuffleIds.includes(t.id || t.title));
      if (unplayed.length > 0) {
        const randTrack = unplayed[Math.floor(Math.random() * unplayed.length)];
        nextIdx = state.userPlaylist.findIndex(t => (t.id && randTrack.id && t.id === randTrack.id) || (t.title === randTrack.title));
      } else {
        state.playedShuffleIds = [];
        nextIdx = Math.floor(Math.random() * N);
      }
    } else {
      let curIdx = state.userPlaylist.findIndex(t => 
        (t.id && state.currentTrack && t.id === state.currentTrack.id) ||
        (t.title && state.currentTrack && t.title.trim().toLowerCase() === curTitle)
      );
      if (curIdx === -1) curIdx = state.activeCoverflowIndex || 0;
      nextIdx = (curIdx + 1) % N; // Ciclo continuo sin fin: pasa a la siguiente y al terminar vuelve a la primera
    }
    state.activeCoverflowIndex = nextIdx;
    renderCoverflow();
    renderPlaylistTracklist();
    const nextTrack = state.userPlaylist[nextIdx];
    showToast(`⏭️ Siguiente: ${nextTrack.title}`);
    playPlaylistTrack(nextTrack);
    return;
  }

  // 2. Si se está reproduciendo dentro de un álbum oficial
  if (state.currentAlbum && Array.isArray(state.currentAlbum.tracks) && state.currentAlbum.tracks.length > 0) {
    const curTitle = state.currentTrack ? state.currentTrack.title.trim().toLowerCase() : '';
    const curIdx = state.currentAlbum.tracks.findIndex(t => t.title && t.title.trim().toLowerCase() === curTitle);
    if (curIdx !== -1 && curIdx + 1 < state.currentAlbum.tracks.length) {
      const nextTrack = state.currentAlbum.tracks[curIdx + 1];
      showToast(`⏭️ Siguiente en álbum: ${nextTrack.title}`);
      playFullSong(nextTrack.artist || state.currentAlbum.artist, nextTrack.title, state.currentAlbum.coverXl, state.currentAlbum.title, nextTrack.duration, nextTrack.preview, nextTrack.videoId);
      return;
    }
  }

  // 3. Si se está reproduciendo del Top 10 Colombia
  if (state.rankingTracks && state.rankingTracks.length > 0) {
    const curTitle = state.currentTrack ? state.currentTrack.title.trim().toLowerCase() : '';
    const curIdx = state.rankingTracks.findIndex(t => t.title && t.title.trim().toLowerCase() === curTitle);
    if (curIdx !== -1 && curIdx + 1 < state.rankingTracks.length) {
      const nextTrack = state.rankingTracks[curIdx + 1];
      showToast(`⏭️ Siguiente éxito: ${nextTrack.title}`);
      playFullSong(nextTrack.artist, nextTrack.title, nextTrack.coverXl || nextTrack.cover, nextTrack.album, nextTrack.duration, nextTrack.preview, nextTrack.videoId);
      return;
    }
  }

  // 4. Si se está en resultados de catálogo de pistas
  if (state.results && state.results.length > 0 && state.currentMode === 'tracks') {
    const curTitle = state.currentTrack ? state.currentTrack.title.trim().toLowerCase() : '';
    const curIdx = state.results.findIndex(t => t.title && t.title.trim().toLowerCase() === curTitle);
    if (curIdx !== -1 && curIdx + 1 < state.results.length) {
      const nextTrack = state.results[curIdx + 1];
      showToast(`⏭️ Siguiente canción: ${nextTrack.title}`);
      playFullSong(nextTrack.artist ? (nextTrack.artist.name || nextTrack.artist) : 'Artista', nextTrack.title, nextTrack.coverXl || nextTrack.cover, nextTrack.albumTitle, nextTrack.duration, nextTrack.preview, nextTrack.videoId);
      return;
    }
  }

  // 5. Fallback aleatorio inteligente: elegir una canción del catálogo o ranking
  const pool = (state.rankingTracks && state.rankingTracks.length > 0) 
    ? state.rankingTracks 
    : (state.results && state.results.length > 0 ? state.results : []);

  if (pool.length > 0) {
    const randomTrack = pool[Math.floor(Math.random() * pool.length)];
    const artist = randomTrack.artist ? (randomTrack.artist.name || randomTrack.artist) : 'Artista';
    const title = randomTrack.title;
    const cover = randomTrack.coverXl || randomTrack.cover;
    const album = randomTrack.album || randomTrack.albumTitle || 'Éxito';
    showToast(`🔀 Siguiente aleatoria: ${title} - ${artist}`);
    playFullSong(artist, title, cover, album);
    return;
  }

  showToast('⏭️ No hay más canciones en la lista.');
}

// RETROCEDER CANCIÓN (REINICIAR O IR A ANTERIOR)
function playPreviousTrack() {
  const cur = (state.playbackSource === 'full' && ytPlayer && typeof ytPlayer.getCurrentTime === 'function')
    ? (ytPlayer.getCurrentTime() || 0)
    : (state.audio ? state.audio.currentTime || 0 : 0);

  // Si la pista lleva más de 3 segundos, reiniciar al principio como en Spotify / Apple Music
  if (cur > 3) {
    if (state.playbackSource === 'full' && ytPlayer && typeof ytPlayer.seekTo === 'function') {
      ytPlayer.seekTo(0, true);
    } else if (state.audio) {
      state.audio.currentTime = 0;
    }
    showToast('⏮️ Reiniciando pista desde el inicio');
    return;
  }

  // 1. Revisar historial
  if (state.history && state.history.length > 1) {
    state.history.pop(); // Pop canción actual
    const prevTrack = state.history.pop();
    if (prevTrack) {
      showToast(`⏮️ Canción anterior: ${prevTrack.title}`);
      playFullSong(prevTrack.artist, prevTrack.title, prevTrack.cover, prevTrack.album, prevTrack.duration, prevTrack.preview);
      return;
    }
  }

  // 1.5 Si se está en Playlist Personal 3D o Shuffle
  const curTitle = state.currentTrack ? state.currentTrack.title.trim().toLowerCase() : '';
  const isFromPlaylist = state.currentMode === 'playlist' || (state.userPlaylist && state.userPlaylist.length > 0 && state.userPlaylist.some(t => t.title && t.title.trim().toLowerCase() === curTitle));
  if ((isFromPlaylist || state.isShuffle) && state.userPlaylist && state.userPlaylist.length > 0) {
    let prevIdx;
    if (state.isShuffle && Array.isArray(state.playedShuffleIds) && state.playedShuffleIds.length > 1) {
      state.playedShuffleIds.pop(); // Remove current
      const prevId = state.playedShuffleIds[state.playedShuffleIds.length - 1];
      prevIdx = state.userPlaylist.findIndex(t => (t.id || t.title) === prevId);
      if (prevIdx === -1) prevIdx = Math.max(0, state.activeCoverflowIndex - 1);
    } else {
      let curIdx = state.userPlaylist.findIndex(t => 
        (t.id && state.currentTrack && t.id === state.currentTrack.id) ||
        (t.title && state.currentTrack && t.title.trim().toLowerCase() === curTitle)
      );
      if (curIdx === -1) curIdx = state.activeCoverflowIndex || 0;
      prevIdx = Math.max(0, curIdx - 1);
    }
    state.activeCoverflowIndex = prevIdx;
    renderCoverflow();
    renderPlaylistTracklist();
    const prevTrack = state.userPlaylist[prevIdx];
    playPlaylistTrack(prevTrack);
    return;
  }

  // 2. Si estamos dentro de un álbum
  if (state.currentAlbum && Array.isArray(state.currentAlbum.tracks) && state.currentAlbum.tracks.length > 0) {
    const curTitle = state.currentTrack ? state.currentTrack.title.trim().toLowerCase() : '';
    const curIdx = state.currentAlbum.tracks.findIndex(t => t.title && t.title.trim().toLowerCase() === curTitle);
    if (curIdx > 0) {
      const prevTrack = state.currentAlbum.tracks[curIdx - 1];
      showToast(`⏮️ Pista anterior: ${prevTrack.title}`);
      playFullSong(prevTrack.artist || state.currentAlbum.artist, prevTrack.title, state.currentAlbum.coverXl, state.currentAlbum.title, prevTrack.duration, prevTrack.preview);
      return;
    }
  }

  // 3. Si estamos en Top 10
  if (state.rankingTracks && state.rankingTracks.length > 0) {
    const curTitle = state.currentTrack ? state.currentTrack.title.trim().toLowerCase() : '';
    const curIdx = state.rankingTracks.findIndex(t => t.title && t.title.trim().toLowerCase() === curTitle);
    if (curIdx > 0) {
      const prevTrack = state.rankingTracks[curIdx - 1];
      showToast(`⏮️ Éxito anterior: ${prevTrack.title}`);
      playFullSong(prevTrack.artist, prevTrack.title, prevTrack.coverXl || prevTrack.cover, prevTrack.album, prevTrack.duration, prevTrack.preview);
      return;
    }
  }

  // Fallback: reiniciar pista
  if (state.playbackSource === 'full' && ytPlayer && typeof ytPlayer.seekTo === 'function') {
    ytPlayer.seekTo(0, true);
  } else if (state.audio) {
    state.audio.currentTime = 0;
  }
}

// MENÚ CONTEXTUAL FLOTANTE ESTILO SPOTIFY (3 PUNTOS)
function openTrackContextMenu(trackData, triggerEl = null) {
  if (!trackData) return;
  state.contextTrack = trackData;
  if (!amMoreMenu) return;
  updateSmartDjUI();

  // Bloquear scroll de fondo para que el menú permanezca completamente quieto
  document.body.style.overflow = 'hidden';

  const panel = document.getElementById('amMenuPanel');
  if (panel) {
    if (window.innerWidth <= 768) {
      // En móvil: fijar centrado en pantalla para que no se mueva ni se desplace al deslizar
      panel.style.position = 'fixed';
      panel.style.left = '50%';
      panel.style.top = '50%';
      panel.style.bottom = 'auto';
      panel.style.right = 'auto';
      panel.style.transform = 'translate(-50%, -50%)';
      panel.style.width = 'calc(100% - 36px)';
      panel.style.maxWidth = '320px';
      panel.style.maxHeight = '80vh';
      panel.style.overflowY = 'auto';
      panel.style.overscrollBehavior = 'contain';
    } else if (triggerEl) {
      const rect = triggerEl.getBoundingClientRect();
      const menuWidth = 250;

      let left = rect.right - menuWidth;
      if (left < 10) left = 10;
      if (left + menuWidth > window.innerWidth - 10) {
        left = window.innerWidth - menuWidth - 10;
      }
      panel.style.position = 'fixed';
      panel.style.left = `${Math.max(10, left)}px`;
      panel.style.right = 'auto';
      panel.style.transform = 'none';

      const spaceBelow = window.innerHeight - rect.bottom - 15;
      const spaceAbove = rect.top - 15;

      if (spaceBelow < 220 && spaceAbove > spaceBelow) {
        panel.style.top = 'auto';
        panel.style.bottom = `${Math.max(10, window.innerHeight - rect.top + 8)}px`;
        panel.style.maxHeight = `${Math.min(spaceAbove, window.innerHeight - 30)}px`;
      } else {
        panel.style.top = `${Math.max(10, rect.bottom + 8)}px`;
        panel.style.bottom = 'auto';
        panel.style.maxHeight = `${Math.min(spaceBelow, window.innerHeight - 30)}px`;
      }
      panel.style.overflowY = 'auto';
      panel.style.overscrollBehavior = 'contain';
    } else {
      panel.style.position = 'fixed';
      panel.style.bottom = '95px';
      panel.style.right = '25px';
      panel.style.left = 'auto';
      panel.style.top = 'auto';
      panel.style.maxHeight = 'calc(100vh - 120px)';
      panel.style.overflowY = 'auto';
      panel.style.overscrollBehavior = 'contain';
      panel.style.transform = 'none';
    }
  }

  amMoreMenu.classList.remove('hidden');
}

function openMoreMenu(triggerEl = null) {
  openTrackContextMenu(state.currentTrack, triggerEl);
}

function closeMoreMenu() {
  document.body.style.overflow = '';
  if (amMoreMenu) amMoreMenu.classList.add('hidden');
}

// ========================================================
// MOTOR DUAL AUDIO & CROSSFADE DE 10 SEGUNDOS (v8.3.0)
// ========================================================
let crossfadeInterval = null;

function toggleCrossfade() {
  state.crossfadeEnabled = !state.crossfadeEnabled;
  state.smartDjEnabled = state.crossfadeEnabled;
  updateCrossfadeUI();
  if (state.crossfadeEnabled) {
    showToast('🎚️ Crossfade 10s Activado: Transición continua e ininterrumpida entre canciones.');
    showTopRightToast('Crossfade 10s', 'Mezcla ultra-suave sin cortes (ideal para pantalla apagada)', 'dj');
  } else {
    showToast('⏹️ Crossfade Desactivado: Reproducción estándar.');
    showTopRightToast('Crossfade Desactivado', 'Corte directo al terminar cada pista', 'info');
  }
  trackAnalyticsEvent('crossfade_toggled', { enabled: state.crossfadeEnabled });
}

function toggleSmartDj() {
  toggleCrossfade();
}

function updateCrossfadeUI() {
  const badge = document.getElementById('amCrossfadeBadge') || amDjBadge;
  const btnBottom = document.getElementById('btnBottomCrossfade') || btnBottomDj;
  const tag = document.getElementById('amMenuCrossfadeTag') || amMenuDjTag;

  if (badge) {
    badge.style.display = state.crossfadeEnabled ? 'inline-flex' : 'none';
  }
  if (btnBottom) {
    if (state.crossfadeEnabled) btnBottom.classList.add('active');
    else btnBottom.classList.remove('active');
  }
  if (tag) {
    tag.innerText = state.crossfadeEnabled ? 'ON' : 'OFF';
    tag.style.background = state.crossfadeEnabled ? 'linear-gradient(135deg, #00f0ff, #00a8ff)' : 'rgba(255,255,255,0.2)';
    tag.style.color = state.crossfadeEnabled ? '#000' : '#fff';
  }
}

function updateSmartDjUI() {
  updateCrossfadeUI();
}

// Configurar los listeners en cada elemento de audio del Dual Engine
function setupAudioElementListeners(audioEl) {
  if (!audioEl) return;

  audioEl.addEventListener('timeupdate', () => {
    if (audioEl !== state.activeAudio) return; // Solo el audio activo actualiza barra y progreso
    if (state.playbackSource === 'preview' || state.playbackSource === 'full_stream') {
      updateProgress();
      checkAndTriggerCrossfade();
    }
  });

  audioEl.addEventListener('ended', () => {
    if (audioEl !== state.activeAudio) return;
    if (state.playbackSource === 'preview' || state.playbackSource === 'full_stream') {
      if (state.isCrossfading) {
        completeCrossfade();
      } else {
        playNextTrack();
      }
    }
  });

  audioEl.addEventListener('play', () => {
    if (audioEl !== state.activeAudio) return;
    if (state.playbackSource === 'preview' || state.playbackSource === 'full_stream') {
      setPlayingState(true);
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
      if (state.currentTrack) updateMediaSession(state.currentTrack);
    }
  });

  audioEl.addEventListener('pause', () => {
    if (audioEl !== state.activeAudio) return;
    if (!state.isCrossfading) {
      if (state.playbackSource === 'preview' || state.playbackSource === 'full_stream') {
        setPlayingState(false);
        if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
      }
    }
  });

  audioEl.addEventListener('error', () => {
    if (audioEl !== state.activeAudio) return;
    if (state.playbackSource === 'full_stream' && state.currentTrack && state.currentTrack.videoId) {
      console.warn('[Stream Live Error] Reintentando vía YouTube...');
      state.playbackSource = 'full';
      if (ytPlayer && typeof ytPlayer.loadVideoById === 'function') {
        ytPlayer.loadVideoById(state.currentTrack.videoId);
        ytPlayer.playVideo();
        setPlayingState(true);
        startYtProgress();
      }
    }
  });
}

function getUpcomingTrack() {
  if (state.queue && state.queue.length > 0) {
    return state.queue[0];
  }
  if (state.currentMode === 'playlist' && state.userPlaylist && state.userPlaylist.length > 0) {
    const curIdx = state.activeCoverflowIndex;
    const nextIdx = (curIdx + 1) % state.userPlaylist.length;
    return state.userPlaylist[nextIdx];
  }
  if (state.currentAlbum && Array.isArray(state.currentAlbum.tracks)) {
    const curTitle = state.currentTrack ? state.currentTrack.title.trim().toLowerCase() : '';
    const curIdx = state.currentAlbum.tracks.findIndex(t => t.title && t.title.trim().toLowerCase() === curTitle);
    if (curIdx !== -1 && curIdx + 1 < state.currentAlbum.tracks.length) {
      return state.currentAlbum.tracks[curIdx + 1];
    }
  }
  return null;
}

async function resolveTrackStreamUrl(track) {
  if (!track) return null;
  if (track.preview || track.audioUrl) {
    return track.preview || track.audioUrl;
  }
  if (track.videoId) {
    return `/api/stream-live?v=${track.videoId}`;
  }
  try {
    const durParam = track.duration || 0;
    const res = await fetch(`/api/fullaudio?q=${encodeURIComponent((track.artist || '') + ' ' + (track.title || ''))}&artist=${encodeURIComponent(track.artist || '')}&title=${encodeURIComponent(track.title || '')}&duration=${encodeURIComponent(durParam)}`);
    const data = await res.json();
    if (data && data.videoId) {
      track.videoId = data.videoId;
      if (data.resolvedArtist) track._resolvedArtist = data.resolvedArtist;
      return `/api/stream-live?v=${data.videoId}`;
    }
  } catch (_) {}
  return track.preview || track.audioUrl || null;
}

function checkAndTriggerCrossfade() {
  if (!state.crossfadeEnabled) return;

  let dur = 0;
  let cur = 0;

  if ((state.playbackSource === 'full' || state.playbackSource === 'full_yt') && ytPlayer && typeof ytPlayer.getDuration === 'function') {
    dur = ytPlayer.getDuration() || 0;
    cur = ytPlayer.getCurrentTime() || 0;
  } else if (state.activeAudio && state.activeAudio.duration) {
    dur = state.activeAudio.duration;
    cur = state.activeAudio.currentTime;
  }

  if (!dur || dur <= 16) return; // Temas muy cortos se reproducen directo
  const remaining = dur - cur;

  // 1. Pre-carga en el segundo reproductor a los 15 segundos restantes
  if (remaining <= 15 && !state.isPreloadingNext && !state.nextQueuedTrack) {
    const upcoming = getUpcomingTrack();
    if (upcoming) {
      state.isPreloadingNext = true;
      resolveTrackStreamUrl(upcoming).then(src => {
        if (src && state.fadeAudio) {
          state.fadeAudio.src = src;
          state.fadeAudio.volume = 0;
          state.fadeAudio.playbackRate = state.currentSpeed;
          state.fadeAudio.load();
          state.nextQueuedTrack = upcoming;
          console.log('[Dual Audio Engine] Pista preparada para crossfade 10s:', upcoming.title);
        }
      }).catch(() => {
        state.isPreloadingNext = false;
      });
    }
  }

  // 2. Disparar Crossfade de 10 segundos continuos a los 10 segundos restantes
  if (remaining <= 10 && remaining > 0.6 && !state.isCrossfading && state.nextQueuedTrack && state.fadeAudio && state.fadeAudio.src) {
    start10sCrossfade();
  }
}

function start10sCrossfade() {
  if (state.isCrossfading) return;
  state.isCrossfading = true;
  const nextTrack = state.nextQueuedTrack;
  console.log('[Dual Audio Engine] Iniciando Crossfade de 10s continuo hacia:', nextTrack ? nextTrack.title : 'Siguiente tema');

  trackAnalyticsEvent('crossfade_started', {
    from: state.currentTrack ? state.currentTrack.title : '',
    to: nextTrack ? nextTrack.title : '',
    duration: 10
  });

  const isYt = (state.playbackSource === 'full' || state.playbackSource === 'full_yt') && ytPlayer && typeof ytPlayer.setVolume === 'function';

  state.fadeAudio.volume = 0;
  state.fadeAudio.play().then(() => {
    let step = 0;
    const totalSteps = 100; // 100 pasos * 100ms = 10.000 ms (10s)
    if (crossfadeInterval) clearInterval(crossfadeInterval);

    crossfadeInterval = setInterval(() => {
      step++;
      const progress = step / totalSteps; // 0.00 -> 1.00

      // Bajar volumen de la actual (sea YouTube o Audio HTML5)
      if (isYt) {
        try { ytPlayer.setVolume(Math.round(Math.max(0, 100 * (1 - progress)))); } catch (_) {}
      } else if (state.activeAudio) {
        state.activeAudio.volume = Math.max(0, 1 - progress);
      }

      // Subir volumen de la nueva
      if (state.fadeAudio) {
        state.fadeAudio.volume = Math.min(1, progress);
      }

      if (step >= totalSteps) {
        clearInterval(crossfadeInterval);
        crossfadeInterval = null;
        completeCrossfade();
      }
    }, 100);
  }).catch(err => {
    console.warn('[Dual Audio Crossfade play error]', err);
    state.isCrossfading = false;
  });
}

function completeCrossfade() {
  if (crossfadeInterval) {
    clearInterval(crossfadeInterval);
    crossfadeInterval = null;
  }

  // Detener la que terminó
  if (ytPlayer && typeof ytPlayer.pauseVideo === 'function') {
    try {
      ytPlayer.pauseVideo();
      ytPlayer.setVolume(100);
    } catch (_) {}
    stopYtProgress();
  }

  if (state.activeAudio) {
    try {
      state.activeAudio.pause();
      state.activeAudio.currentTime = 0;
      state.activeAudio.volume = 1;
    } catch (_) {}
  }

  // Swap de instancias A y B para que la que subió de volumen ahora sea la principal
  const temp = state.activeAudio;
  state.activeAudio = state.fadeAudio;
  state.fadeAudio = temp;
  state.activeAudio.volume = 1;
  state.playbackSource = 'full_stream';

  const newTrack = state.nextQueuedTrack;

  state.isCrossfading = false;
  state.isPreloadingNext = false;
  state.nextQueuedTrack = null;

  if (newTrack) {
    state.currentTrack = newTrack;
    if (playerTitle) playerTitle.innerText = newTrack.title || 'Canción';
    if (playerArtist) playerArtist.innerHTML = formatArtistPills(newTrack.artist || 'Artista');
    if (newTrack.cover && playerCover) playerCover.src = newTrack.cover;
    updateMediaSession(newTrack);
    updateAppleMusicTrackInfo(newTrack);

    // Actualizar cola
    if (state.queue && state.queue.length > 0 && state.queue[0] === newTrack) {
      state.queue.shift();
      updateQueueBadge();
      renderQueueItems();
    }
    // Sincronizar Coverflow si estamos en playlist
    if (state.currentMode === 'playlist' && state.userPlaylist) {
      const idx = state.userPlaylist.findIndex(t => t.title === newTrack.title && t.artist === newTrack.artist);
      if (idx !== -1) {
        state.activeCoverflowIndex = idx;
        if (typeof updateCoverflowClasses === 'function') updateCoverflowClasses();
      }
    }
    trackAnalyticsEvent('song_played', {
      title: newTrack.title,
      artist: newTrack.artist,
      source: 'crossfade_10s'
    });
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
  if (typeof updateDockPlayState === 'function') {
    updateDockPlayState(playing);
  }
  if (playing) {
    iconPlay.classList.add('hidden');
    iconPause.classList.remove('hidden');
    if (waveIndicator) waveIndicator.classList.add('playing');
    if (amIconPlay) amIconPlay.classList.add('hidden');
    if (amIconPause) amIconPause.classList.remove('hidden');
    if (amCoverCard) amCoverCard.classList.add('playing');
    if (amCoverGlow) amCoverGlow.classList.add('playing');
    if (amCoverImg) amCoverImg.classList.add('auto-moving');
    if (amMotionVideo) {
      amMotionVideo.classList.add('auto-moving');
      if (!amMotionVideo.classList.contains('hidden')) {
        amMotionVideo.play().catch(() => {});
      }
    }
  } else {
    iconPlay.classList.remove('hidden');
    iconPause.classList.add('hidden');
    if (waveIndicator) waveIndicator.classList.remove('playing');
    if (amIconPlay) amIconPlay.classList.remove('hidden');
    if (amIconPause) amIconPause.classList.add('hidden');
    if (amCoverCard) amCoverCard.classList.remove('playing');
    if (amCoverGlow) amCoverGlow.classList.remove('playing');
    if (amCoverImg) amCoverImg.classList.remove('auto-moving');
    if (amMotionVideo) {
      amMotionVideo.classList.remove('auto-moving');
      amMotionVideo.pause();
    }
  }
}

function updateProgress() {
  const current = (Number.isFinite(state.audio.currentTime) && state.audio.currentTime > 0) ? state.audio.currentTime : 0;
  let total = (Number.isFinite(state.audio.duration) && state.audio.duration > 0) ? state.audio.duration : 0;
  if (!total && state.currentTrack && state.currentTrack.duration) {
    total = state.currentTrack.duration;
  }

  currentTimeLabel.innerText = formatTime(current);
  totalTimeLabel.innerText = total > 0 ? formatTime(total) : '00:00';

  if (total > 0) {
    const percent = Math.min(100, Math.max(0, (current / total) * 100));
    progressFill.style.width = `${percent}%`;
    progressThumb.style.left = `${percent}%`;
    updateMediaSessionPosition(current, total);
  }

  updateAppleMusicProgress(current, total);
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || isNaN(seconds) || seconds <= 0) return '00:00';
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

// TOAST NOTIFICACIÓN ESQUINA SUPERIOR DERECHA
let trtTimeout = null;
function showTopRightToast(title, subtitle = '', iconType = 'success') {
  const toast = document.getElementById('topRightToast');
  const tTitle = document.getElementById('trtTitle');
  const tSub = document.getElementById('trtSubtitle');
  const tIcon = document.getElementById('trtIcon');
  const tIconWrap = document.getElementById('trtIconWrap');
  if (!toast) return;

  if (trtTimeout) {
    clearTimeout(trtTimeout);
    trtTimeout = null;
  }

  if (tTitle) tTitle.textContent = title;
  if (tSub) tSub.textContent = subtitle || '';

  let iconChar = '✓';
  let iconColor = 'var(--vice-cyan)';
  let borderColor = 'rgba(0, 240, 255, 0.45)';

  if (iconType === 'heart' || iconType === 'playlist') {
    iconChar = '❤️';
    iconColor = 'var(--vice-pink)';
    borderColor = 'rgba(255, 42, 133, 0.55)';
  } else if (iconType === 'shuffle') {
    iconChar = '🔀';
    iconColor = 'var(--vice-cyan)';
    borderColor = 'rgba(0, 240, 255, 0.6)';
  } else if (iconType === 'delete') {
    iconChar = '🗑️';
    iconColor = 'var(--vice-pink)';
    borderColor = 'rgba(255, 42, 133, 0.6)';
  } else if (iconType === 'dj') {
    iconChar = '🎛️';
    iconColor = '#ffb800';
    borderColor = 'rgba(255, 184, 0, 0.55)';
  } else if (iconType === 'info') {
    iconChar = 'ℹ️';
    iconColor = '#9d4edd';
    borderColor = 'rgba(157, 78, 221, 0.55)';
  }

  if (tIcon) tIcon.textContent = iconChar;
  if (tIconWrap) {
    tIconWrap.style.color = iconColor;
    tIconWrap.style.borderColor = iconColor;
  }
  toast.style.borderColor = borderColor;

  toast.classList.remove('hidden', 'trt-exit');

  trtTimeout = setTimeout(() => {
    toast.classList.add('trt-exit');
    setTimeout(() => {
      toast.classList.add('hidden');
      toast.classList.remove('trt-exit');
    }, 320);
  }, 3200);
}

// MODAL DE CONFIRMACIÓN DE ELIMINACIÓN DE PLAYLIST
let pendingTrackToDelete = null;

function showDeleteConfirmModal(track) {
  if (!track) return;
  pendingTrackToDelete = track;
  const modal = document.getElementById('deleteConfirmModal');
  const desc = document.getElementById('deleteModalDesc');
  if (desc) {
    desc.innerHTML = `¿Estás seguro de que deseas eliminar "<strong>${escapeHtml(track.title)}</strong>" de tu Playlist 3D?`;
  }
  if (modal) modal.classList.remove('hidden');
}

function hideDeleteConfirmModal() {
  pendingTrackToDelete = null;
  const modal = document.getElementById('deleteConfirmModal');
  if (modal) modal.classList.add('hidden');
}

function setupDeleteConfirmHandlers() {
  const backdrop = document.getElementById('deleteModalBackdrop');
  const btnCancel = document.getElementById('btnCancelDelete');
  const btnConfirm = document.getElementById('btnConfirmDelete');

  if (btnCancel) {
    btnCancel.onclick = hideDeleteConfirmModal;
  }
  if (backdrop) {
    backdrop.onclick = hideDeleteConfirmModal;
  }
  if (btnConfirm) {
    btnConfirm.onclick = () => {
      if (pendingTrackToDelete) {
        const track = pendingTrackToDelete;
        hideDeleteConfirmModal();
        removeFromUserPlaylist(track);
      } else {
        hideDeleteConfirmModal();
      }
    };
  }
}

// DETENER CUALQUIER REPRODUCCIÓN EN CURSO
function stopCurrentPlayback() {
  try {
    if (state.audio) {
      state.audio.pause();
      state.audio.currentTime = 0;
    }
  } catch (e) {}
  try {
    if (ytPlayer && typeof ytPlayer.stopVideo === 'function') {
      ytPlayer.stopVideo();
    } else if (ytPlayer && typeof ytPlayer.pauseVideo === 'function') {
      ytPlayer.pauseVideo();
    }
  } catch (e) {}
  stopYtProgress();
  setPlayingState(false);
  updateDockPlayState(false);
}

// MODAL DE CONFIRMACIÓN DE DESCARGA MP3
let pendingTrackToDownload = null;

function confirmDownloadSong(track) {
  if (!track || !track.title) {
    showTopRightToast('Descarga no disponible', 'No hay canción seleccionada', 'info');
    return;
  }
  pendingTrackToDownload = track;
  const modal = document.getElementById('downloadConfirmModal');
  const desc = document.getElementById('downloadModalDesc');
  if (desc) {
    desc.innerHTML = `¿Deseas descargar "<strong>${escapeHtml(track.title)}</strong>" (${escapeHtml(track.artist || 'Artista')}) en máxima calidad <strong>MP3 320 kbps</strong> oficial?`;
  }
  if (modal) modal.classList.remove('hidden');
}

function hideDownloadConfirmModal() {
  pendingTrackToDownload = null;
  const modal = document.getElementById('downloadConfirmModal');
  if (modal) modal.classList.add('hidden');
}

function setupDownloadConfirmHandlers() {
  const backdrop = document.getElementById('downloadModalBackdrop');
  const btnCancel = document.getElementById('btnCancelDownload');
  const btnConfirm = document.getElementById('btnConfirmDownload');

  if (btnCancel) btnCancel.onclick = hideDownloadConfirmModal;
  if (backdrop) backdrop.onclick = hideDownloadConfirmModal;
  if (btnConfirm) {
    btnConfirm.onclick = () => {
      if (pendingTrackToDownload) {
        const t = pendingTrackToDownload;
        hideDownloadConfirmModal();
        downloadMp3_320(t.artist, t.title, t.audioUrl || t.preview, t.videoId || t.video_id, {
          album: t.album,
          coverUrl: t.cover,
          year: t.releaseDate
        });
      } else {
        hideDownloadConfirmModal();
      }
    };
  }
}

// GESTOR DE COLA DE REPRODUCCIÓN (QUEUE MANAGER)
function updateQueueBadge() {
  const count = (state.queue && state.queue.length) || 0;
  const dockBadge = document.getElementById('dockQueueBadge');
  const playerBadge = document.getElementById('playerQueueBadge');
  const menuBadge = document.getElementById('amMenuQueueTag');
  const modalBadge = document.getElementById('queueBadgeCount');

  if (dockBadge) {
    dockBadge.textContent = count;
    dockBadge.classList.toggle('hidden', count === 0);
  }
  if (playerBadge) {
    playerBadge.textContent = count;
    playerBadge.classList.toggle('hidden', count === 0);
  }
  if (menuBadge) menuBadge.textContent = count;
  if (modalBadge) modalBadge.textContent = count;
}

function openQueueModal() {
  renderQueueItems();
  const modal = document.getElementById('queueModal');
  if (modal) modal.classList.remove('hidden');
}

function closeQueueModal() {
  const modal = document.getElementById('queueModal');
  if (modal) modal.classList.add('hidden');
}

function renderQueueItems() {
  const container = document.getElementById('queueListContainer');
  if (!container) return;
  updateQueueBadge();

  if (!state.queue || state.queue.length === 0) {
    container.innerHTML = `
      <div class="queue-empty-box">
        <div class="queue-empty-icon">📑</div>
        <div class="queue-empty-title">Tu cola de reproducción está vacía</div>
        <div class="queue-empty-desc">Usa el menú de 3 puntos (···) en cualquier canción y selecciona "Añadir a la cola" para programar qué escuchar a continuación.</div>
      </div>
    `;
    return;
  }

  let html = '';
  state.queue.forEach((item, idx) => {
    const cover = item.cover || 'https://via.placeholder.com/60/1a0933/ff2a85?text=VI';
    html += `
      <div class="queue-item" data-index="${idx}">
        <div class="queue-item-idx">${idx + 1}</div>
        <img src="${escapeHtml(cover)}" class="queue-item-cover" alt="Cover" />
        <div class="queue-item-meta">
          <div class="queue-item-title">${escapeHtml(item.title)}</div>
          <div class="queue-item-artist">${escapeHtml(item.artist || 'Artista')}</div>
        </div>
        <div class="queue-item-actions">
          ${idx > 0 ? `<button class="btn-q-act btn-q-up" title="Subir prioridad (escuchar antes)" data-index="${idx}">▲</button>` : ''}
          ${idx < state.queue.length - 1 ? `<button class="btn-q-act btn-q-down" title="Bajar prioridad" data-index="${idx}">▼</button>` : ''}
          <button class="btn-q-act btn-q-play" title="Reproducir ahora" data-index="${idx}">▶</button>
          <button class="btn-q-act btn-q-del" title="Quitar de la cola" data-index="${idx}">✕</button>
        </div>
      </div>
    `;
  });
  container.innerHTML = html;

  container.querySelectorAll('.btn-q-up').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const i = parseInt(btn.getAttribute('data-index'), 10);
      if (i > 0) {
        const temp = state.queue[i];
        state.queue[i] = state.queue[i - 1];
        state.queue[i - 1] = temp;
        renderQueueItems();
      }
    });
  });

  container.querySelectorAll('.btn-q-down').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const i = parseInt(btn.getAttribute('data-index'), 10);
      if (i < state.queue.length - 1) {
        const temp = state.queue[i];
        state.queue[i] = state.queue[i + 1];
        state.queue[i + 1] = temp;
        renderQueueItems();
      }
    });
  });

  container.querySelectorAll('.btn-q-play').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const i = parseInt(btn.getAttribute('data-index'), 10);
      const track = state.queue.splice(i, 1)[0];
      closeQueueModal();
      playFullSong(track.artist, track.title, track.cover, track.album, track.duration, track.preview);
      updateQueueBadge();
    });
  });

  container.querySelectorAll('.btn-q-del').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const i = parseInt(btn.getAttribute('data-index'), 10);
      const removed = state.queue.splice(i, 1)[0];
      renderQueueItems();
      showTopRightToast('Eliminado de la cola', removed.title, 'info');
    });
  });
}

function setupQueueHandlers() {
  const btnDockQueue = document.getElementById('btnDockQueue');
  const btnPlayerQueue = document.getElementById('btnPlayerQueue');
  const btnCloseQueue = document.getElementById('btnCloseQueueModal');
  const backdropQueue = document.getElementById('queueModalBackdrop');
  const btnClearQueue = document.getElementById('btnClearQueue');
  const btnMenuViewQueue = document.getElementById('amMenuBtnViewQueue');

  if (btnDockQueue) btnDockQueue.addEventListener('click', openQueueModal);
  if (btnPlayerQueue) btnPlayerQueue.addEventListener('click', openQueueModal);
  if (btnMenuViewQueue) {
    btnMenuViewQueue.addEventListener('click', () => {
      closeMoreMenu();
      openQueueModal();
    });
  }
  if (btnCloseQueue) btnCloseQueue.addEventListener('click', closeQueueModal);
  if (backdropQueue) backdropQueue.addEventListener('click', closeQueueModal);
  if (btnClearQueue) {
    btnClearQueue.addEventListener('click', () => {
      if (!state.queue || state.queue.length === 0) {
        showToast('ℹ️ La cola de reproducción ya está vacía');
        return;
      }
      if (confirm('¿Estás seguro de que deseas vaciar toda la cola de reproducción?')) {
        state.queue = [];
        renderQueueItems();
        showTopRightToast('Cola vaciada', 'Se eliminaron las canciones en espera', 'info');
      }
    });
  }
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
    let artists = [];

    // 1. Probar backend Render
    try {
      const res = await fetch('/api/top-colombia');
      const data = await res.json();
      if (data && data.success && Array.isArray(data.tracks) && data.tracks.length > 0) {
        tracks = data.tracks;
        artists = data.artists || [];
        albums = data.albums || [];
      }
    } catch (e) {
      console.warn('Backend top-colombia no respondió, intentando JSONP:', e.message);
    }

    // Asegurar que nunca se filtren artistas globales en Colombia
    if (artists && artists.some(a => /drake|linkin park|taylor swift|noah kahan/i.test(a.name || ''))) {
      artists = [];
    }

    // Intentar obtener artistas de Colombia directamente vía JSONP desde el navegador
    if (!artists || artists.length === 0) {
      try {
        const artChart = await fetchDeezerJsonp('/chart/73/artists');
        if (artChart && Array.isArray(artChart.data) && artChart.data.length > 0) {
          artists = artChart.data.slice(0, 10).map((a, idx) => ({
            rank: idx + 1,
            id: a.id,
            name: a.name,
            picture: a.picture_xl || a.picture_big || a.picture_medium,
            link: a.link,
            type: 'artist'
          }));
        }
      } catch (_) {}
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

    // Guardar tracks en state para navegación siguiente/anterior
    state.rankingTracks = tracks;

    // Renderizar Ranking Top 10
    topRankingList.innerHTML = '';
    if (tracks.length === 0) {
      topRankingList.innerHTML = '<p style="padding: 2.5rem; color: var(--text-dim); text-align: center; font-family: var(--font-mono);">Conectando con el satélite de audio... Vuelve a intentarlo en unos instantes.</p>';
    } else {
      tracks.forEach((track, index) => {
        const trackObj = {
          title: track.title,
          artist: track.artist,
          album: track.album,
          albumId: track.albumId,
          cover: track.coverXl,
          preview: track.preview,
          duration: track.duration,
          videoId: track.videoId || ''
        };
        const trackKey = getTrackKey(trackObj);
        const isSelected = state.selectedTracks.has(trackKey);

        const row = document.createElement('div');
        row.className = `ranking-row ${index === 0 ? 'rank-first' : ''} ${isSelected ? 'is-selected' : ''}`;
        
        const rankNumStr = track.rank < 10 ? `0${track.rank}` : `${track.rank}`;
        const durationFormatted = formatTime(track.duration);

        row.innerHTML = `
          <div class="ranking-num">
            <label class="custom-track-checkbox row-track-checkbox" title="Seleccionar canción">
              <input type="checkbox" class="track-select-cb" data-track-key="${trackKey}" ${isSelected ? 'checked' : ''}>
              <span class="cb-checkmark"></span>
            </label>
            <span>${index === 0 ? '👑 01' : rankNumStr}</span>
          </div>

          <div class="ranking-track-cell">
            <div class="ranking-thumb-wrap">
              <img src="${track.coverXl || 'https://via.placeholder.com/80/1a0933/ff2a85?text=VI'}" alt="${track.title}" class="ranking-thumb-img" loading="lazy">
              <div class="ranking-thumb-play">▶</div>
            </div>
            <div class="ranking-track-meta">
              <span class="ranking-track-title" title="${track.title}">${track.title}</span>
              <span class="ranking-track-artist">${formatArtistPills(track.artist)}</span>
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
            <button class="btn-track-more" title="Más opciones (Descargar MP3, FLAC, Cola)">
              <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                <circle cx="5" cy="12" r="2.2"></circle>
                <circle cx="12" cy="12" r="2.2"></circle>
                <circle cx="19" cy="12" r="2.2"></circle>
              </svg>
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
          playFullSong(track.artist, track.title, track.coverXl, track.album, track.duration, track.preview);
        });

        row.querySelector('.btn-track-more').addEventListener('click', (e) => {
          e.stopPropagation();
          openTrackContextMenu({
            title: track.title,
            artist: track.artist,
            cover: track.coverXl,
            album: track.album,
            albumId: track.albumId,
            preview: track.preview,
            audioUrl: track.preview,
            duration: track.duration,
            lucidaUrl: track.lucidaUrl
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

        const cb = row.querySelector('.track-select-cb');
        if (cb) {
          cb.addEventListener('click', e => e.stopPropagation());
          cb.addEventListener('change', e => {
            e.stopPropagation();
            toggleTrackSelection(trackObj, cb.checked, row);
          });
        }

        topRankingList.appendChild(row);
      });
    }

    // Renderizar Artistas Más Escuchados a Nivel Mundial & Colombia
    const homeArtistsGrid = document.getElementById('homeArtistsGrid');
    if (homeArtistsGrid) {
      homeArtistsGrid.innerHTML = '';
      const topArtists = (artists && Array.isArray(artists) && artists.length > 0)
        ? artists
        : [
            { name: 'Ryan Castro', picture: 'https://cdn-images.dzcdn.net/images/artist/85e4705e8cab0354605581abd89c703d/500x500-000000-80-0-0.jpg', rank: 1 },
            { name: 'KAROL G', picture: 'https://cdn-images.dzcdn.net/images/artist/5b0aab23f8d2856951a92f3a9faf70e3/500x500-000000-80-0-0.jpg', rank: 2 },
            { name: 'Feid', picture: 'https://cdn-images.dzcdn.net/images/artist/e629c93e03b3c225d8d52a42bae71537/500x500-000000-80-0-0.jpg', rank: 3 },
            { name: 'Bad Bunny', picture: 'https://cdn-images.dzcdn.net/images/artist/044a3f315b041864887a8dd8709e6926/500x500-000000-80-0-0.jpg', rank: 4 },
            { name: 'Diomedes Diaz', picture: 'https://cdn-images.dzcdn.net/images/artist/fd9922415127264b9708992d5b0908a4/500x500-000000-80-0-0.jpg', rank: 5 },
            { name: 'Silvestre Dangond', picture: 'https://cdn-images.dzcdn.net/images/artist/615aa8dceb24854b2cfdbe6339067242/500x500-000000-80-0-0.jpg', rank: 6 },
            { name: 'Beele', picture: 'https://cdn-images.dzcdn.net/images/artist/517e60ed50f56034769b7e845a71e35c/500x500-000000-80-0-0.jpg', rank: 7 },
            { name: 'Shakira', picture: 'https://cdn-images.dzcdn.net/images/artist/69c569506a8ff6ab0edfecbd1adf94b0/500x500-000000-80-0-0.jpg', rank: 8 },
            { name: 'J Balvin', picture: 'https://cdn-images.dzcdn.net/images/artist/325eaa46bc25052d0e3d549d60cc8225/500x500-000000-80-0-0.jpg', rank: 9 },
            { name: 'Don Omar', picture: 'https://cdn-images.dzcdn.net/images/artist/3edb52cebe741e547363a093e26d4655/500x500-000000-80-0-0.jpg', rank: 10 }
          ];

      topArtists.forEach(art => {
        const artCard = document.createElement('div');
        artCard.className = 'artist-bubble-card';
        artCard.title = `Ver discografía completa de ${art.name}`;
        artCard.innerHTML = `
          <div class="artist-bubble-avatar-wrap">
            <img class="artist-bubble-avatar" src="${art.picture}" alt="${art.name}" loading="lazy" onerror="this.src='https://via.placeholder.com/150/1a0933/00f0ff?text=${encodeURIComponent(art.name[0])}'">
            <span class="artist-bubble-rank">#${art.rank}</span>
          </div>
          <span class="artist-bubble-name">${escapeHtml(art.name)}</span>
          <span class="artist-bubble-sub">TOP ARTIST</span>
        `;
        artCard.addEventListener('click', () => {
          openArtistProfile(art.name);
        });
        homeArtistsGrid.appendChild(artCard);
      });
    }

    // Auto-actualización periódica en vivo del Top 10 y Artistas (cada 5 minutos)
    if (!window._topChartsIntervalSet) {
      window._topChartsIntervalSet = true;
      setInterval(() => {
        if (state.currentMode === 'home') {
          console.log('[Live Charts] Refrescando charts en vivo...');
          loadHomeContent();
        }
      }, 5 * 60 * 1000);
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
            <p class="album-artist">${formatArtistPills(album.artist)}</p>
            <div class="album-meta">
              <span class="album-tracks-count">${album.nbTracks} canciones</span>
              <span class="album-type-badge">ÁLBUM</span>
            </div>
          </div>
        `;
        card.addEventListener('click', (e) => {
          if (e.target.closest('.artist-clickable-pill') || e.target.closest('.artist-clickable')) return;
          openAlbumDetail(album.id);
        });

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

// ========================================================
// CONTROLADOR APPLE MUSIC // MOVING COVER & LIVE LYRICS
// ========================================================

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function updateClockIndicator() {
  const amClockTime = document.getElementById('amClockTime');
  if (!amClockTime) return;
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  amClockTime.innerText = `${hours}:${minutes}`;
}

function openAppleMusicModal() {
  if (!appleMusicModal) return;
  if (!state.currentTrack) {
    showToast('⚠️ Reproduce primero una canción para abrir la interfaz Apple Music.');
    return;
  }

  appleMusicState.isOpen = true;
  appleMusicModal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  updateClockIndicator();

  // Sincronizar metadatos y carátula
  updateAppleMusicTrackInfo(state.currentTrack);

  // Sincronizar estado de reproducción y vinilo
  setPlayingState(state.isPlaying);

  // Sincronizar velocidad
  if (amBtnSpeed) {
    amBtnSpeed.innerText = `${state.currentSpeed || 1}x`;
  }

  // Sincronizar Smart DJ UI
  updateSmartDjUI();

  // Sincronizar progreso actual
  const cur = (state.playbackSource === 'full' && ytPlayer && typeof ytPlayer.getCurrentTime === 'function')
    ? (ytPlayer.getCurrentTime() || 0)
    : (state.audio ? state.audio.currentTime || 0 : 0);
  const dur = (state.playbackSource === 'full' && ytPlayer && typeof ytPlayer.getDuration === 'function')
    ? (ytPlayer.getDuration() || 0)
    : (state.audio ? state.audio.duration || 0 : 0);
  updateAppleMusicProgress(cur, dur);
}

function closeAppleMusicModal() {
  if (!appleMusicModal) return;
  closeMoreMenu();
  appleMusicState.isOpen = false;
  appleMusicModal.classList.add('hidden');
  document.body.style.overflow = '';
}

function switchAppleMusicTab(tab) {
  appleMusicState.activeTab = tab;
  if (tab === 'cover') {
    if (btnAmTabCover) btnAmTabCover.classList.add('active');
    if (btnAmTabLyrics) btnAmTabLyrics.classList.remove('active');
    if (amCoverSection) amCoverSection.classList.remove('hidden');
    if (amLyricsSection) amLyricsSection.classList.add('hidden');
  } else {
    if (btnAmTabLyrics) btnAmTabLyrics.classList.add('active');
    if (btnAmTabCover) btnAmTabCover.classList.remove('active');
    if (amLyricsSection) amLyricsSection.classList.remove('hidden');
    if (amCoverSection) amCoverSection.classList.add('hidden');
    
    // Si aún no se han cargado letras para la pista actual, cargarlas
    if (state.currentTrack && (!appleMusicState.lyrics || appleMusicState.lyrics.length === 0)) {
      fetchAppleMusicLyrics(state.currentTrack.artist, state.currentTrack.title);
    }
  }
}

function updateAppleMusicTrackInfo(track) {
  if (!track) return;

  if (amTrackTitle) amTrackTitle.innerText = track.title || 'Pista de Audio';
  if (amTrackArtist) amTrackArtist.innerHTML = formatArtistPills(track.artist || 'Artista');
  if (amTrackAlbum) amTrackAlbum.innerText = track.album || (state.currentAlbum ? state.currentAlbum.title : 'Álbum Oficial');

  const coverUrl = track.cover || (state.currentAlbum && state.currentAlbum.coverXl) || 'https://via.placeholder.com/500/1a0933/ff2a85?text=VI';

  if (amCoverImg) amCoverImg.src = coverUrl;
  if (amCoverGlow) {
    amCoverGlow.style.backgroundImage = `url('${coverUrl}')`;
  }
  if (amAmbientBg) {
    amAmbientBg.style.backgroundImage = `radial-gradient(circle at 50% 35%, rgba(255, 42, 133, 0.42) 0%, rgba(0, 240, 255, 0.32) 40%, rgba(10, 4, 18, 0.95) 85%), url('${coverUrl}')`;
  }

  // Si cambia la pista, resetear letras y buscar nuevas
  const trackKey = `${track.artist}::${track.title}`;
  if (appleMusicState.trackKey !== trackKey) {
    appleMusicState.trackKey = trackKey;
    appleMusicState.lyrics = [];
    appleMusicState.activeLyricIndex = -1;
    fetchAppleMusicLyrics(track.artist, track.title);
    fetchMotionArtwork(track.artist, track.album, track.title);
  }
}

async function fetchMotionArtwork(artist, album, title) {
  if (!amMotionVideo) return;

  const cleanArtist = (artist || '').split(/[,&/]/)[0].trim();
  const cleanAlbum = (album || '').replace(/\s*[\(\[](?:Explicit|Deluxe|Edition).*?[\)\]]/gi, '').trim();
  const cleanTitle = (title || '').replace(/\s*[\(\[](?:Official|Video|Audio).*?[\)\]]/gi, '').trim();

  try {
    const q = `/api/motion-artwork?artist=${encodeURIComponent(cleanArtist)}&album=${encodeURIComponent(cleanAlbum)}&title=${encodeURIComponent(cleanTitle)}`;
    const res = await fetch(q);
    const data = await res.json();

    if (data && data.hasMotion && data.videoUrl) {
      console.log('[Motion Artwork] Encontrado video oficial de Apple Music:', data.videoUrl);
      
      if (hlsMotion) {
        hlsMotion.destroy();
        hlsMotion = null;
      }

      if (window.Hls && Hls.isSupported()) {
        hlsMotion = new Hls({ enableWorker: true });
        hlsMotion.loadSource(data.videoUrl);
        hlsMotion.attachMedia(amMotionVideo);
        hlsMotion.on(Hls.Events.MANIFEST_PARSED, () => {
          if (state.isPlaying) amMotionVideo.play().catch(() => {});
        });
      } else if (amMotionVideo.canPlayType('application/vnd.apple.mpegurl')) {
        amMotionVideo.src = data.videoUrl;
        if (state.isPlaying) amMotionVideo.play().catch(() => {});
      }

      amMotionVideo.classList.remove('hidden');
      if (amCoverImg) amCoverImg.style.opacity = '0';
      return;
    }
  } catch (err) {
    console.warn('Error cargando motion artwork:', err.message);
  }

  // Fallback: Modo Carátula en Movimiento Autónomo 3D
  if (hlsMotion) {
    hlsMotion.destroy();
    hlsMotion = null;
  }
  if (amMotionVideo) {
    amMotionVideo.pause();
    amMotionVideo.removeAttribute('src');
    amMotionVideo.load();
    amMotionVideo.classList.add('hidden');
  }
  if (amCoverImg) {
    amCoverImg.style.opacity = '1';
    amCoverImg.classList.add('auto-moving');
  }
}

function updateAppleMusicProgress(current, total) {
  const safeCurrent = (Number.isFinite(current) && current > 0) ? current : 0;
  let safeTotal = (Number.isFinite(total) && total > 0) ? total : 0;
  if (!safeTotal && state.currentTrack && state.currentTrack.duration) {
    safeTotal = state.currentTrack.duration;
  }

  if (amTimeCurrent) amTimeCurrent.innerText = formatTime(safeCurrent);
  if (amTimeTotal) amTimeTotal.innerText = safeTotal > 0 ? formatTime(safeTotal) : '00:00';

  if (safeTotal > 0 && amProgressFill) {
    const percent = Math.min(100, Math.max(0, (safeCurrent / safeTotal) * 100));
    amProgressFill.style.width = `${percent}%`;
    if (amProgressThumb) amProgressThumb.style.left = `${percent}%`;
  }

  updateLyricsSync(safeCurrent);
}

function parseLrc(lrcText) {
  if (!lrcText || typeof lrcText !== 'string') return [];
  const lines = lrcText.split('\n');
  const result = [];
  const timeRegex = /\[(\d{2}):(\d{2}(?:\.\d{1,3})?)\]/g;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let match;
    const timestamps = [];
    while ((match = timeRegex.exec(trimmed)) !== null) {
      const min = parseInt(match[1], 10);
      const sec = parseFloat(match[2]);
      timestamps.push(min * 60 + sec);
    }

    const text = trimmed.replace(/\[\d{2}:\d{2}(?:\.\d{1,3})?\]/g, '').trim();
    if (timestamps.length > 0) {
      for (const t of timestamps) {
        result.push({ time: t, text: text || '♪' });
      }
    }
  }

  result.sort((a, b) => a.time - b.time);
  return result;
}

function seekToTimestamp(targetTime) {
  if ((state.playbackSource === 'full' || state.playbackSource === 'full_yt') && ytPlayer && typeof ytPlayer.seekTo === 'function') {
    ytPlayer.seekTo(targetTime, true);
    updateMediaSessionPosition(targetTime, ytPlayer.getDuration() || 0);
  } else if (state.audio) {
    state.audio.currentTime = targetTime;
    updateMediaSessionPosition(targetTime, state.audio.duration || 0);
  }
}

async function fetchAppleMusicLyrics(artist, title) {
  if (!amLyricsContainer) return;

  amLyricsContainer.innerHTML = `
    <div class="am-lyrics-loader">
      <div class="vice-spinner"><div class="inner-vi">VI</div></div>
      <p>Sincronizando letra en vivo de <strong>${escapeHtml(title)}</strong>...</p>
    </div>
  `;
  if (amLyricsBadge) {
    amLyricsBadge.innerText = 'BUSCANDO...';
    amLyricsBadge.className = 'am-lyrics-badge';
  }

  const cleanTitle = title
    .replace(/\s*[\(\[](?:Official|Video|Audio|Visualizer|Lyric|Letra|Explicit|Version|En Vivo|Live).*?[\)\]]/gi, '')
    .replace(/\s*-\s*(?:Official|Video|Visualizer).*$/gi, '')
    .replace(/\s*feat\..*$/gi, '')
    .trim();
  const cleanArtist = artist.split(/[,&/]/)[0].trim();

  let lyricsData = null;

  try {
    const getUrl = `https://lrclib.net/api/get?artist_name=${encodeURIComponent(cleanArtist)}&track_name=${encodeURIComponent(cleanTitle)}`;
    const res = await fetch(getUrl);
    if (res.ok) {
      const data = await res.json();
      if (data && (data.syncedLyrics || data.plainLyrics)) {
        lyricsData = data;
      }
    }
  } catch (err) {
    console.warn('LrcLib get error:', err.message);
  }

  if (!lyricsData) {
    try {
      const searchUrl = `https://lrclib.net/api/search?q=${encodeURIComponent(cleanArtist + ' ' + cleanTitle)}`;
      const sRes = await fetch(searchUrl);
      if (sRes.ok) {
        const arr = await sRes.json();
        if (Array.isArray(arr) && arr.length > 0) {
          lyricsData = arr.find(x => x.syncedLyrics) || arr[0];
        }
      }
    } catch (err) {
      console.warn('LrcLib search error:', err.message);
    }
  }

  renderLyrics(lyricsData, title, artist);
}

function renderLyrics(data, title, artist) {
  if (!amLyricsContainer) return;
  amLyricsContainer.innerHTML = '';
  appleMusicState.lyrics = [];
  appleMusicState.activeLyricIndex = -1;

  if (!data || (!data.syncedLyrics && !data.plainLyrics)) {
    if (amLyricsBadge) {
      amLyricsBadge.innerText = 'INSTRUMENTAL';
      amLyricsBadge.className = 'am-lyrics-badge';
    }
    amLyricsContainer.innerHTML = `
      <div class="am-lyrics-empty">
        <div style="font-size: 2.8rem; margin-bottom: 0.8rem; opacity: 0.6;">🎵</div>
        <p style="font-size: 1.15rem; font-weight: 700; color: #fff;">Letra no disponible aún</p>
        <p style="font-size: 0.85rem; color: var(--text-dim); margin-top: 0.4rem; max-width: 320px; line-height: 1.5;">
          Disfruta la melodía de <strong>${escapeHtml(title)}</strong> por <strong>${escapeHtml(artist)}</strong>.
        </p>
      </div>
    `;
    return;
  }

  if (data.syncedLyrics && data.syncedLyrics.trim().length > 0) {
    if (amLyricsBadge) {
      amLyricsBadge.innerText = 'SINCRONIZADA';
      amLyricsBadge.className = 'am-lyrics-badge live';
    }

    const parsed = parseLrc(data.syncedLyrics);
    if (parsed.length === 0) {
      renderPlainLyrics(data.plainLyrics || data.syncedLyrics);
      return;
    }

    const frag = document.createDocumentFragment();

    parsed.forEach((item) => {
      const p = document.createElement('p');
      p.className = 'am-lyric-line';
      p.setAttribute('data-time', item.time);
      p.innerText = item.text;
      p.title = `Saltar al segundo ${formatTime(item.time)}`;

      p.addEventListener('click', () => {
        seekToTimestamp(item.time);
        showToast(`⏩ Saltando a ${formatTime(item.time)}`);
      });

      frag.appendChild(p);
      appleMusicState.lyrics.push({
        time: item.time,
        text: item.text,
        el: p
      });
    });

    amLyricsContainer.appendChild(frag);

    const cur = (state.playbackSource === 'full' && ytPlayer && typeof ytPlayer.getCurrentTime === 'function')
      ? (ytPlayer.getCurrentTime() || 0)
      : (state.audio ? state.audio.currentTime || 0 : 0);
    updateLyricsSync(cur);
    return;
  }

  if (data.plainLyrics) {
    renderPlainLyrics(data.plainLyrics);
  }
}

function renderPlainLyrics(plainText) {
  if (!amLyricsContainer) return;
  if (amLyricsBadge) {
    amLyricsBadge.innerText = 'TEXTO COMPLETO';
    amLyricsBadge.className = 'am-lyrics-badge';
  }

  const lines = plainText.split('\n');
  const frag = document.createDocumentFragment();

  lines.forEach(line => {
    const p = document.createElement('p');
    p.className = 'am-lyric-line plain';
    p.innerText = line.trim() || ' ';
    frag.appendChild(p);
  });

  amLyricsContainer.appendChild(frag);
}

function updateLyricsSync(currentTime) {
  if (!appleMusicState.lyrics || appleMusicState.lyrics.length === 0) return;

  let activeIdx = -1;
  const offsetTime = currentTime + 0.25;

  for (let i = 0; i < appleMusicState.lyrics.length; i++) {
    if (offsetTime >= appleMusicState.lyrics[i].time) {
      activeIdx = i;
    } else {
      break;
    }
  }

  if (activeIdx !== appleMusicState.activeLyricIndex) {
    if (appleMusicState.activeLyricIndex >= 0 && appleMusicState.lyrics[appleMusicState.activeLyricIndex]) {
      const prevEl = appleMusicState.lyrics[appleMusicState.activeLyricIndex].el;
      if (prevEl) prevEl.classList.remove('active');
    }

    appleMusicState.activeLyricIndex = activeIdx;

    if (activeIdx >= 0 && appleMusicState.lyrics[activeIdx]) {
      const activeEl = appleMusicState.lyrics[activeIdx].el;
      if (activeEl) {
        activeEl.classList.add('active');
        activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }
}

// ========================================================
// SISTEMA DE PLAYLIST PRIVADA & 3D COVERFLOW (APPLE STYLE)
// ========================================================

function toggleAuthMode() {
  state.authMode = state.authMode === 'login' ? 'register' : 'login';
  const modalTitle = document.querySelector('#loginModal .login-modal-title');
  const modalSubtitle = document.getElementById('loginModalSubtitle');
  const btnText = document.getElementById('loginBtnText');
  const toggleBtn = document.getElementById('btnToggleAuthMode');
  const alertEl = document.getElementById('loginAlert');
  const accessCodeGroup = document.getElementById('loginAccessCodeGroup');
  const accessCodeInput = document.getElementById('loginAccessCode');
  if (alertEl) alertEl.classList.add('hidden');

  if (state.authMode === 'register') {
    if (modalTitle) modalTitle.innerHTML = '✨ CREAR CUENTA VIP GRATIS ✨';
    if (modalSubtitle) modalSubtitle.textContent = 'Crea tu usuario para sincronizar tu Playlist 3D y disfrutar descargas a 320 kbps.';
    if (btnText) btnText.textContent = 'REGISTRARME GRATIS';
    if (toggleBtn) toggleBtn.innerHTML = '¿Ya tienes cuenta? <strong style="color: var(--vice-cyan);">Inicia sesión aquí</strong>';
    if (accessCodeGroup) accessCodeGroup.classList.remove('hidden');
    if (accessCodeInput) {
      accessCodeInput.required = true;
      accessCodeInput.value = '';
    }
  } else {
    if (modalTitle) modalTitle.innerHTML = '👑 ACCESO VIP VICE MUSIC 👑';
    if (modalSubtitle) modalSubtitle.textContent = 'Accede con tu cuenta VIP para descargar MP3 a 320 kbps y discografías completas.';
    if (btnText) btnText.textContent = 'INGRESAR AL SISTEMA';
    if (toggleBtn) toggleBtn.innerHTML = '¿No tienes cuenta? <strong style="color: var(--vice-cyan);">Regístrate gratis aquí</strong>';
    if (accessCodeGroup) accessCodeGroup.classList.add('hidden');
    if (accessCodeInput) {
      accessCodeInput.required = false;
      accessCodeInput.value = '';
    }
  }
}

function startPlaylistPlayback(startIndex, isShuffle = false) {
  if (!state.userPlaylist || state.userPlaylist.length === 0) {
    showToast('Tu Playlist 3D está vacía. Añade canciones primero.');
    showTopRightToast('Playlist Vacía', 'Añade canciones primero para reproducir', 'info');
    return;
  }
  const N = state.userPlaylist.length;
  state.isShuffle = isShuffle;

  const btnDockShuffle = document.getElementById('btnDockShuffle');
  const btnPlaylistShuffle = document.getElementById('btnPlaylistShuffle');
  if (btnDockShuffle) btnDockShuffle.classList.toggle('shuffle-active', isShuffle);
  if (btnPlaylistShuffle) btnPlaylistShuffle.classList.toggle('shuffle-active', isShuffle);

  if (isShuffle) {
    // Escoger canción aleatoria de inicio
    const randIdx = Math.floor(Math.random() * N);
    const chosenTrack = state.userPlaylist[randIdx];

    // Mezclar el resto sin repeticiones en el pool de la cola
    const remainder = state.userPlaylist.filter((_, idx) => idx !== randIdx);
    for (let i = remainder.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [remainder[i], remainder[j]] = [remainder[j], remainder[i]];
    }

    state.queue = remainder.map(t => ({
      id: t.id,
      artist: t.artist,
      title: t.title,
      cover: t.cover,
      album: t.album,
      duration: t.duration,
      preview: t.preview,
      videoId: t.videoId || t.video_id
    }));

    state.activeCoverflowIndex = randIdx;
    renderCoverflow();
    renderPlaylistTracklist();
    updateQueueBadge();
    renderQueueItems();

    showTopRightToast('Modo Aleatorio Activo', `Sonando: ${chosenTrack.title}`, 'shuffle');
    playPlaylistTrack(chosenTrack);
  } else {
    // Modo Secuencial Circular:
    // Arranca en startIndex, avanza hacia abajo, y al llegar al final se devuelve a la de arriba (0)
    // hasta llegar a startIndex - 1 (todas las canciones suenan exactamente 1 vez sin repetirse)
    const chosenTrack = state.userPlaylist[startIndex];
    const newQueue = [];
    for (let step = 1; step < N; step++) {
      const idx = (startIndex + step) % N;
      const t = state.userPlaylist[idx];
      newQueue.push({
        id: t.id,
        artist: t.artist,
        title: t.title,
        cover: t.cover,
        album: t.album,
        duration: t.duration,
        preview: t.preview,
        videoId: t.videoId || t.video_id
      });
    }

    state.queue = newQueue;
    state.activeCoverflowIndex = startIndex;
    renderCoverflow();
    renderPlaylistTracklist();
    updateQueueBadge();
    renderQueueItems();

    showTopRightToast('Reproduciendo Playlist', `En orden: ${chosenTrack.title}`, 'playlist');
    playPlaylistTrack(chosenTrack);
  }
}

function toggleShuffleMode() {
  if (!state.userPlaylist || state.userPlaylist.length === 0) {
    showToast('Tu Playlist 3D está vacía. Añade canciones primero.');
    showTopRightToast('Playlist Vacía', 'Añade canciones primero para activar aleatorio', 'info');
    return;
  }
  const nextShuffle = !state.isShuffle;
  startPlaylistPlayback(state.activeCoverflowIndex || 0, nextShuffle);
}

function setupPlaylistControls() {
  setupDeleteConfirmHandlers();
  const btnCoverflowPrev = document.getElementById('btnCoverflowPrev');
  const btnCoverflowNext = document.getElementById('btnCoverflowNext');
  const btnDockPrev = document.getElementById('btnDockPrev');
  const btnDockPlay = document.getElementById('btnDockPlay');
  const btnDockNext = document.getElementById('btnDockNext');
  const btnDockShuffle = document.getElementById('btnDockShuffle');
  const btnDockRemove = document.getElementById('btnDockRemove');
  const btnDockMore = document.getElementById('btnDockMore');
  const dockTrackCenter = document.getElementById('dockTrackCenter');
  const btnToggleAuthMode = document.getElementById('btnToggleAuthMode');
  const btnPlaylistShuffle = document.getElementById('btnPlaylistShuffle');
  const btnPlaylistPlayAll = document.getElementById('btnPlaylistPlayAll');

  if (btnToggleAuthMode) {
    btnToggleAuthMode.addEventListener('click', toggleAuthMode);
  }

  if (btnDockShuffle) {
    btnDockShuffle.addEventListener('click', toggleShuffleMode);
  }
  if (btnPlaylistShuffle) {
    btnPlaylistShuffle.addEventListener('click', toggleShuffleMode);
  }

  if (btnPlaylistPlayAll) {
    btnPlaylistPlayAll.addEventListener('click', () => {
      startPlaylistPlayback(0, false);
    });
  }

  if (btnCoverflowPrev) {
    btnCoverflowPrev.addEventListener('click', () => {
      playPreviousTrack();
    });
  }

  if (btnCoverflowNext) {
    btnCoverflowNext.addEventListener('click', () => {
      playNextTrack();
    });
  }

  if (btnDockPrev) {
    btnDockPrev.addEventListener('click', () => {
      playPreviousTrack();
    });
  }

  if (btnDockNext) {
    btnDockNext.addEventListener('click', () => {
      playNextTrack();
    });
  }

  if (btnDockPlay) {
    btnDockPlay.addEventListener('click', () => {
      if (!state.userPlaylist || state.userPlaylist.length === 0) {
        showToast('Agrega canciones a tu Playlist 3D primero.');
        return;
      }
      const activeTrack = state.userPlaylist[state.activeCoverflowIndex];
      if (!activeTrack) return;

      if (state.isPlaying) {
        togglePlayPause();
      } else {
        if (!state.currentTrack || state.currentTrack.title !== activeTrack.title) {
          playPlaylistTrack(activeTrack);
        } else {
          togglePlayPause();
        }
      }
    });
  }

  if (dockTrackCenter) {
    dockTrackCenter.addEventListener('click', () => {
      if (!state.userPlaylist || state.userPlaylist.length === 0) return;
      const activeTrack = state.userPlaylist[state.activeCoverflowIndex];
      if (activeTrack) {
        playPlaylistTrack(activeTrack);
      }
    });
  }

  if (btnDockRemove) {
    btnDockRemove.addEventListener('click', () => {
      if (!state.userPlaylist || state.userPlaylist.length === 0) return;
      const activeTrack = state.userPlaylist[state.activeCoverflowIndex];
      if (activeTrack) {
        showDeleteConfirmModal(activeTrack);
      }
    });
  }

  if (btnDockMore) {
    btnDockMore.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!state.userPlaylist || state.userPlaylist.length === 0) return;
      const activeTrack = state.userPlaylist[state.activeCoverflowIndex];
      if (activeTrack) {
        state.contextTrack = activeTrack;
        openTrackContextMenu(activeTrack, btnDockMore);
      }
    });
  }

  window.addEventListener('keydown', (e) => {
    if (state.currentMode !== 'playlist') return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'ArrowLeft') {
      if (btnCoverflowPrev) btnCoverflowPrev.click();
    } else if (e.key === 'ArrowRight') {
      if (btnCoverflowNext) btnCoverflowNext.click();
    }
  });
}

function updateDockPlayState(isPlaying) {
  const dockIconPlay = document.getElementById('dockIconPlay');
  const dockIconPause = document.getElementById('dockIconPause');
  const dockWave = document.getElementById('dockWaveIndicator');

  if (dockIconPlay && dockIconPause) {
    if (isPlaying) {
      dockIconPlay.classList.add('hidden');
      dockIconPause.classList.remove('hidden');
    } else {
      dockIconPlay.classList.remove('hidden');
      dockIconPause.classList.add('hidden');
    }
  }

  if (dockWave) {
    if (isPlaying) {
      dockWave.classList.add('active');
    } else {
      dockWave.classList.remove('active');
    }
  }
}

function updatePlaylistBadge() {
  const badge = document.getElementById('playlistBadgeCount');
  if (badge) {
    const count = (state.userPlaylist || []).length;
    badge.textContent = count;
    badge.style.display = count > 0 ? 'inline-flex' : 'none';
  }
}

async function loadUserPlaylist() {
  const user = getAuthUser();
  const ownerTitle = document.getElementById('playlistOwnerTitle');
  const ownerSub = document.getElementById('playlistOwnerSub');

  if (!user) {
    if (ownerTitle) ownerTitle.textContent = 'MI PLAYLIST 3D';
    if (ownerSub) ownerSub.textContent = 'Inicia sesión con tu cuenta VIP para acceder y guardar tus canciones.';
    state.userPlaylist = [];
    updatePlaylistBadge();
    renderCoverflow();
    renderPlaylistTracklist();
    return;
  }

  const username = user.user;
  if (ownerTitle) {
    ownerTitle.textContent = `PLAYLIST 3D DE ${username.toUpperCase()}`;
  }
  if (ownerSub) {
    ownerSub.textContent = `Colección sincronizada de ${username}. Desliza en 3D para reproducir.`;
  }

  // 1. Obtener canciones guardadas localmente en este navegador para protegerlas siempre
  const savedUserKey = `vice_playlist_${username}`;
  let localTracks = [];
  try {
    const saved = localStorage.getItem(savedUserKey);
    if (saved) localTracks = JSON.parse(saved);
    if (!Array.isArray(localTracks)) localTracks = [];
  } catch (_) {}

  // 2. Consultar servidor con prevención estricta de caché
  let serverLoaded = false;
  let serverTracks = [];
  try {
    const res = await fetch(`/api/playlist?user=${encodeURIComponent(username)}&_t=${Date.now()}`, {
      cache: 'no-store'
    });
    if (res.ok) {
      const data = await res.json();
      const list = (data && data.success && (data.tracks || data.playlist)) ? (data.tracks || data.playlist) : null;
      if (Array.isArray(list)) {
        serverTracks = list;
        serverLoaded = true;
      }
    }
  } catch (err) {
    console.warn('No se pudo contactar al servidor para playlist (modo offline):', err);
  }

  // 3. REGLA DE ORO DE PERSISTENCIA INQUEBRANTABLE:
  if (serverLoaded && serverTracks.length > 0) {
    // Si el servidor tiene canciones, el servidor es la fuente autoritativa (mantiene eliminaciones sincronizadas)
    state.userPlaylist = serverTracks;
    try {
      localStorage.setItem(savedUserKey, JSON.stringify(serverTracks));
    } catch (_) {}
  } else if (localTracks.length > 0) {
    // Si el servidor está vacío (ej: nuevo despliegue o reinicio de Render), pero el usuario tenía canciones en su navegador:
    // NUNCA BORRAR las canciones del usuario. Resguardar y sincronizar al servidor de inmediato:
    state.userPlaylist = localTracks;
    fetch('/api/playlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: username, playlist: localTracks })
    }).catch(() => {});
  } else {
    // Ambos vacíos o nuevo usuario
    state.userPlaylist = serverTracks || [];
  }

  updatePlaylistBadge();

  if (state.activeCoverflowIndex >= state.userPlaylist.length) {
    state.activeCoverflowIndex = Math.max(0, state.userPlaylist.length - 1);
  }

  renderCoverflow();
  renderPlaylistTracklist();
}

function renderCoverflow() {
  const stage = document.getElementById('coverflowStage');
  const subtitleText = document.getElementById('activeSubtitleText');
  const dockCover = document.getElementById('dockCover');
  const dockTitle = document.getElementById('dockTitle');
  const dockArtist = document.getElementById('dockArtist');

  if (!stage) return;
  stage.innerHTML = '';

  const list = state.userPlaylist || [];
  if (list.length === 0) {
    stage.innerHTML = `
      <div class="coverflow-empty-msg" style="text-align:center; padding: 40px; color: #a19bb8;">
        <div style="font-size: 3.5rem; margin-bottom: 12px;">💿</div>
        <p style="font-weight: 700; color: #fff; font-size: 1.2rem;">Tu Playlist 3D está vacía</p>
        <p style="font-size: 0.95rem; color: #a19bb8; margin-top: 8px;">
          Haz clic en los 3 puntos (···) en cualquier canción para añadirla aquí a tu colección.
        </p>
      </div>
    `;
    if (subtitleText) subtitleText.innerHTML = '<span style="opacity: 0.7;">Explora música y añade temas a tu playlist 3D.</span>';
    if (dockCover) dockCover.src = 'https://via.placeholder.com/80/1a0933/ff2a85?text=VI';
    if (dockTitle) dockTitle.textContent = 'Playlist vacía';
    if (dockArtist) dockArtist.textContent = 'Vice Music';
    return;
  }

  const activeIdx = Math.max(0, Math.min(state.activeCoverflowIndex, list.length - 1));
  state.activeCoverflowIndex = activeIdx;
  const activeTrack = list[activeIdx];

  if (subtitleText && activeTrack) {
    subtitleText.innerHTML = `
      <div class="active-subtitle-title">${escapeHtml(activeTrack.title)}</div>
      <div>
        <span class="active-subtitle-artist">${escapeHtml(activeTrack.artist)}</span>
        <span class="active-subtitle-album">• ${escapeHtml(activeTrack.album || 'Álbum Oficial')}</span>
      </div>
    `;
  }

  if (dockCover && activeTrack) {
    dockCover.src = activeTrack.cover || 'https://via.placeholder.com/80/1a0933/ff2a85?text=VI';
  }
  if (dockTitle && activeTrack) {
    dockTitle.textContent = activeTrack.title;
  }
  if (dockArtist && activeTrack) {
    dockArtist.textContent = activeTrack.artist;
  }

  list.forEach((track, idx) => {
    const card = document.createElement('div');
    card.className = 'coverflow-card';

    const offset = idx - activeIdx;
    if (offset === 0) {
      card.classList.add('active');
    } else if (offset === -1) {
      card.classList.add('left-1');
    } else if (offset === -2) {
      card.classList.add('left-2');
    } else if (offset < -2) {
      card.classList.add('left-hidden');
    } else if (offset === 1) {
      card.classList.add('right-1');
    } else if (offset === 2) {
      card.classList.add('right-2');
    } else if (offset > 2) {
      card.classList.add('right-hidden');
    }

    card.innerHTML = `
      <img src="${escapeHtml(track.cover || 'https://via.placeholder.com/320/1a0933/ff2a85?text=VI')}" alt="${escapeHtml(track.title)}" loading="lazy">
      <div class="card-hover-overlay">
        <div class="card-play-circle">▶</div>
      </div>
    `;

    card.addEventListener('click', () => {
      if (idx === state.activeCoverflowIndex) {
        startPlaylistPlayback(idx, state.isShuffle);
      } else {
        state.activeCoverflowIndex = idx;
        renderCoverflow();
        renderPlaylistTracklist();
      }
    });

    stage.appendChild(card);
  });
}

function renderPlaylistTracklist() {
  const container = document.getElementById('playlistTracklist');
  const countEl = document.getElementById('playlistTotalCount');
  if (!container) return;

  const list = state.userPlaylist || [];
  if (countEl) countEl.textContent = list.length;

  if (list.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 40px; color: #a19bb8;">
        <p>No tienes canciones en tu lista todavía.</p>
      </div>
    `;
    return;
  }

  let html = '';
  list.forEach((t, i) => {
    const isActive = i === state.activeCoverflowIndex;
    const durationMin = (t.duration && t.duration > 0 && t.duration !== 180) ? formatTime(t.duration) : '--:--';
    const trackKey = getTrackKey(t);
    const isSelected = state.selectedTracks.has(trackKey);
    html += `
      <div class="playlist-row ${isActive ? 'active-row' : ''} ${isSelected ? 'is-selected' : ''}" data-index="${i}">
        <div class="pl-col-idx">
          <label class="custom-track-checkbox row-track-checkbox" title="Seleccionar canción">
            <input type="checkbox" class="track-select-cb" data-track-key="${trackKey}" ${isSelected ? 'checked' : ''}>
            <span class="cb-checkmark"></span>
          </label>
          <span>${i + 1}</span>
        </div>
        <div class="pl-col-cover">
          <img src="${escapeHtml(t.cover || 'https://via.placeholder.com/52/1a0933/ff2a85?text=VI')}" alt="${escapeHtml(t.title)}" loading="lazy">
        </div>
        <div class="pl-col-meta">
          <span class="pl-title">${escapeHtml(t.title)}</span>
          <span class="pl-artist pl-track-artist">${formatArtistPills(t.artist)}</span>
        </div>
        <div class="pl-col-album album-clickable" data-artist="${escapeHtml(t.artist)}" data-album="${escapeHtml(t.album || 'Álbum Oficial')}" title="Buscar álbum oficial">${escapeHtml(t.album || 'Álbum Oficial')}</div>
        <div class="pl-col-duration">${durationMin}</div>
        <div class="pl-col-actions">
          <button class="pl-act-btn btn-pl-play" title="Reproducir canción completa" data-index="${i}">▶</button>
          <button class="pl-act-btn btn-pl-more btn-track-more" title="Más opciones (Añadir a la cola, descargar, etc.)" data-index="${i}">
            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
              <circle cx="5" cy="12" r="2.2"></circle>
              <circle cx="12" cy="12" r="2.2"></circle>
              <circle cx="19" cy="12" r="2.2"></circle>
            </svg>
          </button>
          <button class="pl-act-btn btn-pl-dl" title="Descargar MP3 320 kbps oficial" data-index="${i}">⬇</button>
          <button class="pl-act-btn btn-pl-del" title="Eliminar de mi playlist" data-index="${i}">✕</button>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;

  // Listeners para checkboxes de multi-selección en la playlist
  container.querySelectorAll('.track-select-cb').forEach(cb => {
    cb.addEventListener('click', e => e.stopPropagation());
    cb.addEventListener('change', e => {
      e.stopPropagation();
      const row = cb.closest('.playlist-row');
      const idx = parseInt(row.getAttribute('data-index'), 10);
      const track = list[idx];
      if (track) toggleTrackSelection(track, cb.checked, row);
    });
  });

  // Clic en Artista en la tabla de playlist
  container.querySelectorAll('.artist-clickable').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const artist = el.getAttribute('data-artist');
      if (artist) openArtistProfile(artist);
    });
  });

  // Clic en Álbum en la tabla de playlist
  container.querySelectorAll('.album-clickable').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const album = el.getAttribute('data-album');
      const artist = el.getAttribute('data-artist');
      if (album && album !== 'Álbum Oficial' && album !== 'Single') {
        performSearch(album);
      } else if (artist) {
        openArtistProfile(artist);
      }
    });
  });

  container.querySelectorAll('.btn-pl-play').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.getAttribute('data-index'), 10);
      if (!isNaN(idx)) startPlaylistPlayback(idx, false);
    });
  });

  container.querySelectorAll('.btn-pl-more').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.getAttribute('data-index'), 10);
      const track = state.userPlaylist[idx];
      if (track) {
        openTrackContextMenu({
          title: track.title,
          artist: track.artist,
          cover: track.cover,
          album: track.album,
          albumId: track.album_id || track.albumId || null,
          duration: track.duration,
          preview: track.preview || '',
          audioUrl: track.preview || '',
          videoId: track.video_id || track.videoId || ''
        }, btn);
      }
    });
  });

  container.querySelectorAll('.btn-pl-dl').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.getAttribute('data-index'), 10);
      const track = state.userPlaylist[idx];
      if (track) {
        confirmDownloadSong(track);
      }
    });
  });

  container.querySelectorAll('.btn-pl-del').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.getAttribute('data-index'), 10);
      const track = state.userPlaylist[idx];
      if (track) showDeleteConfirmModal(track);
    });
  });

  container.querySelectorAll('.playlist-row').forEach(row => {
    row.addEventListener('click', (e) => {
      // Ignorar si se hizo clic en botones de acción o enlaces
      if (e.target.closest('.pl-col-actions') || e.target.closest('.artist-clickable') || e.target.closest('.album-clickable')) {
        return;
      }
      const idx = parseInt(row.getAttribute('data-index'), 10);
      if (!isNaN(idx)) {
        startPlaylistPlayback(idx, false);
      }
    });
  });
}

function playPlaylistTrack(track) {
  if (!track) return;
  primeAudioPlayback();
  state.currentTrack = track;
  state.currentMode = 'playlist';

  // Sincronizar activeCoverflowIndex con la canción que suena
  const tIdx = (state.userPlaylist || []).findIndex(t => 
    (t.id && track.id && t.id === track.id) ||
    (t.title && track.title && t.title.trim().toLowerCase() === track.title.trim().toLowerCase())
  );
  if (tIdx !== -1) {
    state.activeCoverflowIndex = tIdx;
  }

  // Si aleatorio está activo, registrarla para que NUNCA se repita en este ciclo
  if (state.isShuffle) {
    if (!Array.isArray(state.playedShuffleIds)) state.playedShuffleIds = [];
    const idKey = track.id || track.title;
    if (!state.playedShuffleIds.includes(idKey)) {
      state.playedShuffleIds.push(idKey);
    }
  }

  updateDockPlayState(true);
  renderCoverflow();
  renderPlaylistTracklist();

  // En la playlist SIEMPRE reproducir la canción 100% completa oficial
  playFullSong(track.artist, track.title, track.cover, track.album, track.duration, track.preview, track.videoId || track.video_id);
}

async function addToUserPlaylist(track) {
  if (!track || !track.title) {
    showToast('❌ No hay canción seleccionada para añadir.');
    return;
  }

  const user = getAuthUser();
  if (!user) {
    openLoginModal('Inicia sesión con tu cuenta VIP para guardar canciones en tu Playlist.', () => {
      addToUserPlaylist(track);
    });
    showToast('🔒 Inicia sesión para guardar canciones en tu playlist.');
    return;
  }
  const username = user.user;

  const exists = (state.userPlaylist || []).some(t => 
    t.title.toLowerCase().trim() === track.title.toLowerCase().trim() && 
    t.artist.toLowerCase().trim() === track.artist.toLowerCase().trim()
  );
  if (exists) {
    showToast(`⚠️ "${track.title}" ya está en tu playlist.`);
    showTopRightToast('Ya está en tu Playlist', track.title, 'info');
    return;
  }

  const playlistItem = {
    title: track.title,
    artist: track.artist || 'Artista Desconocido',
    cover: track.cover || (state.currentAlbum && state.currentAlbum.coverXl) || 'https://via.placeholder.com/300/1a0933/ff2a85?text=VI',
    preview: track.audioUrl || track.preview || '',
    album: track.album || (state.currentAlbum && state.currentAlbum.title) || 'Vice Music Single',
    duration: track.duration || 0,
    video_id: track.videoId || ''
  };

  try {
    const res = await fetch('/api/playlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: username, track: playlistItem })
    });
    const data = await res.json();
    if (data && data.success && Array.isArray(data.tracks)) {
      state.userPlaylist = data.tracks;
    } else {
      state.userPlaylist.unshift(playlistItem);
    }
  } catch (err) {
    state.userPlaylist.unshift(playlistItem);
  }

  try {
    localStorage.setItem(`vice_playlist_${username}`, JSON.stringify(state.userPlaylist));
  } catch (e) {}

  state.activeCoverflowIndex = 0;
  updatePlaylistBadge();
  renderCoverflow();
  renderPlaylistTracklist();
  showToast(`💖 ¡"${playlistItem.title}" añadida a tu Playlist 3D!`);
  showTopRightToast('Añadida a Mi Playlist 3D', playlistItem.title, 'heart');
}

async function removeFromUserPlaylist(trackOrId) {
  const user = getAuthUser();
  const username = user ? user.user : 'guest';

  let idToRemove = null;
  let titleToRemove = '';
  if (typeof trackOrId === 'object' && trackOrId !== null) {
    idToRemove = trackOrId.id;
    titleToRemove = trackOrId.title;
  } else {
    idToRemove = trackOrId;
  }

  const idx = state.userPlaylist.findIndex(t => (idToRemove && t.id === idToRemove) || (titleToRemove && t.title === titleToRemove));
  if (idx === -1) return;

  const removedTrack = state.userPlaylist[idx];
  state.userPlaylist.splice(idx, 1);
  if (state.activeCoverflowIndex >= state.userPlaylist.length) {
    state.activeCoverflowIndex = Math.max(0, state.userPlaylist.length - 1);
  }

  try {
    const res = await fetch('/api/playlist', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: username, id: removedTrack.id, title: removedTrack.title, artist: removedTrack.artist })
    });
    const data = await res.json();
    if (data && data.success && Array.isArray(data.tracks)) {
      state.userPlaylist = data.tracks;
    }
  } catch (err) {
    console.warn('Error eliminando del servidor:', err);
  }

  try {
    localStorage.setItem(`vice_playlist_${username}`, JSON.stringify(state.userPlaylist));
  } catch (e) {}

  updatePlaylistBadge();
  renderCoverflow();
  renderPlaylistTracklist();
  showToast(`🗑️ "${removedTrack.title}" eliminada de tu playlist.`);
  showTopRightToast('Canción Eliminada', removedTrack.title, 'delete');
}
