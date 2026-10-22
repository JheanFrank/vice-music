// ========================================================
// VICE MUSIC // GTA VI EDITION (FULL ALBUMS & FLAC)
// ========================================================

const state = {
  currentMode: 'albums', // 'albums' | 'tracks'
  currentTrack: null,
  currentAlbum: null,
  isPlaying: false,
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
const btnPlayPause = document.getElementById('btnPlayPause');
const iconPlay = document.getElementById('iconPlay');
const iconPause = document.getElementById('iconPause');
const btnBackward = document.getElementById('btnBackward');
const btnForward = document.getElementById('btnForward');
const progressTrack = document.getElementById('progressTrack');
const progressFill = document.getElementById('progressFill');
const progressThumb = document.getElementById('progressThumb');
const currentTimeLabel = document.getElementById('currentTime');
const totalTimeLabel = document.getElementById('totalTime');
const waveIndicator = document.getElementById('waveIndicator');
const visualizerCanvas = document.getElementById('visualizerCanvas');

// Modal Full Audio DOM
const fullAudioModal = document.getElementById('fullAudioModal');
const modalFullAudioClose = document.getElementById('modalFullAudioClose');
const fullAudioTitle = document.getElementById('fullAudioTitle');
const fullAudioArtist = document.getElementById('fullAudioArtist');
const fullAudioContainer = document.getElementById('fullAudioContainer');
const btnPlayFullSong = document.getElementById('btnPlayFullSong');

const vCtx = visualizerCanvas ? visualizerCanvas.getContext('2d') : null;

// Inicialización
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  startVisualizer();
  
  // Búsqueda inicial
  performSearch('BbY WOW Karol G');
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
  });

  // Botón Escuchar Completa en la barra fija
  if (btnPlayFullSong) {
    btnPlayFullSong.addEventListener('click', () => {
      if (state.currentTrack) {
        playFullSong(state.currentTrack.artist, state.currentTrack.title);
      } else {
        showToast('Selecciona primero una canción para escucharla completa.');
      }
    });
  }

  // Cerrar Modal Full Audio
  if (modalFullAudioClose) {
    modalFullAudioClose.addEventListener('click', closeFullAudioModal);
  }
  if (fullAudioModal) {
    fullAudioModal.addEventListener('click', (e) => {
      if (e.target === fullAudioModal || e.target.classList.contains('modal-backdrop')) {
        closeFullAudioModal();
      }
    });
  }

  // Reproductor
  btnPlayPause.addEventListener('click', togglePlayPause);
  btnBackward.addEventListener('click', () => {
    state.audio.currentTime = Math.max(0, state.audio.currentTime - 5);
  });
  btnForward.addEventListener('click', () => {
    state.audio.currentTime = Math.min(state.audio.duration || 0, state.audio.currentTime + 5);
  });

  progressTrack.addEventListener('click', (e) => {
    if (!state.audio.duration) return;
    const rect = progressTrack.getBoundingClientRect();
    const pos = (e.clientX - rect.left) / rect.width;
    state.audio.currentTime = pos * state.audio.duration;
  });

  state.audio.addEventListener('timeupdate', updateProgress);
  state.audio.addEventListener('ended', () => setPlayingState(false));
  state.audio.addEventListener('play', () => setPlayingState(true));
  state.audio.addEventListener('pause', () => setPlayingState(false));
}

function switchViewMode(mode) {
  state.currentMode = mode;
  albumDetailView.classList.add('hidden');
  catalogSection.classList.remove('hidden');

  if (mode === 'albums') {
    tabAlbums.classList.add('active');
    tabTracks.classList.remove('active');
    searchHeaderTitle.innerText = 'BUSCA CUALQUIER ÁLBUM O CANCIÓN';
    searchHeaderSub.innerHTML = 'Escribe un artista o canción (ej: <strong>BbY WOW de Karol G</strong>) y te llevará a su álbum completo.';
    searchInput.placeholder = 'Busca un artista o canción (ej: BbY WOW Karol G, Blessd, Feid)...';
    resultsTitle.innerText = 'ÁLBUMES DISPONIBLES';
  } else {
    tabTracks.classList.add('active');
    tabAlbums.classList.remove('active');
    searchHeaderTitle.innerText = 'BUSCA PISTAS O PEGA ENLACES';
    searchHeaderSub.innerHTML = 'Encuentra canciones sueltas y salta a su <strong>álbum completo</strong> con un solo clic.';
    searchInput.placeholder = 'Busca canción (ej: BbY WOW, Mírame, Luna)...';
    resultsTitle.innerText = 'PISTAS IDENTIFICADAS';
  }

  const query = searchInput.value.trim() || 'BbY WOW Karol G';
  performSearch(query);
}

// Búsqueda Principal
async function performSearch(query) {
  if (!query || !query.trim()) return;

  albumDetailView.classList.add('hidden');
  catalogSection.classList.remove('hidden');

  loader.classList.remove('hidden');
  resultsGrid.innerHTML = '';
  resultsCount.innerText = 'LOCALIZANDO...';

  try {
    if (state.currentMode === 'albums') {
      const res = await fetch(`/api/albums/search?q=${encodeURIComponent(query.trim())}`);
      const data = await res.json();
      state.results = data.albums || [];
      renderAlbums(state.results);
    } else {
      const res = await fetch(`/api/resolve?q=${encodeURIComponent(query.trim())}`);
      const data = await res.json();
      if (data.isAlbum && data.albumId) {
        openAlbumDetail(data.albumId);
        return;
      }
      state.results = data.data || [];
      renderTracks(state.results);
    }
  } catch (error) {
    console.error('Error al buscar:', error);
    resultsGrid.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 3rem; color: #ff2a85;">
        <h3>Error al consultar los satélites</h3>
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
        <p style="color: var(--text-dim); margin-top: 0.5rem;">Prueba buscando el nombre directo del artista o canción (ej: BbY WOW Karol G, Blessd, Feid).</p>
      </div>
    `;
    return;
  }

  albums.forEach(album => {
    const card = document.createElement('div');
    card.className = 'album-card';

    const matchedPill = album.matchedTrack 
      ? `<span class="badge-tag-hd" style="top: 12px; left: 12px; border-color: var(--vice-cyan); color: var(--vice-cyan);">🎯 CONTIENE: "${album.matchedTrack}"</span>` 
      : '';

    card.innerHTML = `
      <div class="album-cover-wrapper">
        <img class="album-cover" src="${album.coverXl}" alt="${album.title}" loading="lazy">
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
  window.scrollTo({ top: 300, behavior: 'smooth' });

  albumHeroContent.innerHTML = `
    <div style="text-align: center; width: 100%; padding: 3rem 0;">
      <div class="vice-spinner"><div class="inner-vi">VI</div></div>
      <p style="font-family: var(--font-mono); color: var(--vice-pink); margin-top: 1rem;">CARGANDO DISCOGRAFÍA Y TODAS LAS CANCIONES...</p>
    </div>
  `;
  albumTracklist.innerHTML = '';

  try {
    const res = await fetch(`/api/album/${albumId}`);
    const album = await res.json();
    state.currentAlbum = album;

    // Renderizar Hero del Álbum con el botón de DESCARGA DE ÁLBUM COMPLETO
    albumHeroContent.innerHTML = `
      <div class="album-hero-cover-wrapper">
        <img src="${album.coverXl}" alt="${album.title}">
      </div>
      <div class="album-hero-meta">
        <span class="album-badge-type">DISCOGRAFÍA OFICIAL MASTER</span>
        <h2 class="album-hero-title">${album.title}</h2>
        <p class="album-hero-artist">${album.artist}</p>
        <div class="album-hero-details">
          <span>📅 Lanzamiento: ${album.releaseDate}</span>
          <span>💿 ${album.nbTracks} Canciones</span>
          <span>🏷️ ${album.label}</span>
          <span>🖼️ Portada: 1000x1000 HD</span>
        </div>
        <div class="album-hero-actions">
          <!-- BOTÓN PRINCIPAL: DESCARGAR ÁLBUM COMPLETO EN FLAC -->
          <button class="vice-btn-primary btn-download-full-album" style="background: linear-gradient(135deg, #00f0ff, #ff2a85); font-size: 0.95rem; padding: 0.9rem 2rem;">
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
      navigator.clipboard.writeText(album.link);
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
          <button class="btn-track-action btn-dl-flac" title="Descargar pista individual en FLAC">
            ⚡ FLAC
          </button>
        </div>
      `;

      // Escuchar muestra de 30s
      trackRow.querySelector('.btn-track-play').addEventListener('click', () => {
        if (!track.preview) {
          showToast('⚠️ Esta pista no tiene muestra de audio disponible.');
          return;
        }
        loadTrack({
          title: track.title,
          artist: track.artist,
          cover: album.coverXl,
          audioUrl: track.preview
        });
      });

      // Escuchar Canción Completa (Full Stream)
      trackRow.querySelector('.btn-play-full').addEventListener('click', () => {
        playFullSong(track.artist, track.title);
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
    albumHeroContent.innerHTML = `<p style="color: #ff2a85;">Error al cargar el álbum: ${err.message}</p>`;
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

    // Botón para saltar al álbum completo de la canción
    const goToAlbumBtn = track.albumId ? `
      <button class="btn-go-to-album" style="
        width: 100%;
        margin-bottom: 0.6rem;
        background: linear-gradient(90deg, #ff2a85, #9d00ff);
        color: #fff;
        border: none;
        padding: 0.65rem;
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
        <img class="album-cover" src="${track.coverXl}" alt="${track.title}" loading="lazy">
        <span class="album-badge-tracks" style="background: rgba(0, 240, 255, 0.2); border: 1px solid var(--vice-cyan); color: var(--vice-cyan);">
          💿 ${track.album}
        </span>
      </div>
      <div class="album-info">
        <h3 class="album-title" title="${track.title}">${track.title}</h3>
        <p class="album-artist" title="${track.artist}">${track.artist}</p>
        
        <div style="margin-top: auto;">
          ${goToAlbumBtn}
          <div style="display: flex; gap: 0.5rem;">
            <button class="btn-track-action btn-single-flac" style="flex: 1; padding: 0.6rem; font-size: 0.78rem;">
              ⚡ FLAC CANCIÓN
            </button>
            <button class="btn-track-play btn-single-play">
              <svg viewBox="0 0 24 24" fill="currentColor" style="width: 16px; height: 16px;"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
            </button>
          </div>
        </div>
      </div>
    `;

    // Click en botón para saltar de una vez al álbum completo
    if (track.albumId) {
      card.querySelector('.btn-go-to-album').addEventListener('click', (e) => {
        e.stopPropagation();
        openAlbumDetail(track.albumId);
      });
    }

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

// Reproductor
function loadTrack(track) {
  state.currentTrack = track;
  playerTitle.innerText = track.title;
  playerArtist.innerText = track.artist;
  playerCover.src = track.cover;

  if (track.audioUrl) {
    state.audio.src = track.audioUrl;
    state.audio.play().then(() => setPlayingState(true)).catch(() => setPlayingState(false));
  }
}

function togglePlayPause() {
  if (!state.audio.src) return;
  if (state.audio.paused) {
    state.audio.play();
  } else {
    state.audio.pause();
  }
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

// REPRODUCIR CANCIÓN 100% COMPLETA
async function playFullSong(artist, title) {
  // Pausar audio de muestra si está sonando
  if (state.audio) {
    state.audio.pause();
    setPlayingState(false);
  }

  fullAudioTitle.innerText = title;
  fullAudioArtist.innerText = artist;
  fullAudioContainer.innerHTML = `
    <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: var(--vice-pink);">
      <div class="vice-spinner"><div class="inner-vi">VI</div></div>
      <p style="font-family: var(--font-mono); font-size: 0.85rem; margin-top: 1rem;">CARGANDO STREAM COMPLETO OFICIAL...</p>
    </div>
  `;
  fullAudioModal.classList.remove('hidden');

  try {
    const res = await fetch(`/api/fullaudio?q=${encodeURIComponent(artist + ' ' + title)}`);
    const data = await res.json();

    if (data.embedUrl) {
      fullAudioContainer.innerHTML = `
        <iframe 
          src="${data.embedUrl}" 
          style="width: 100%; height: 100%; border: none;" 
          allow="autoplay; encrypted-media; picture-in-picture" 
          allowfullscreen>
        </iframe>
      `;
      showToast(`🎧 Reproduciendo canción completa: ${title}`);
    } else {
      fullAudioContainer.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: #fff; padding: 2rem;">
          <p style="color: var(--vice-pink); font-size: 1.1rem; margin-bottom: 0.5rem;">No se encontró stream directo.</p>
          <p style="color: var(--text-dim); font-size: 0.85rem;">Puedes escuchar la muestra o descargar el FLAC completo con el botón FLAC.</p>
        </div>
      `;
    }
  } catch (err) {
    console.error('Error al cargar stream completo:', err);
    fullAudioContainer.innerHTML = `<p style="color: #ff2a85; padding: 2rem;">Error al conectar: ${err.message}</p>`;
  }
}

function closeFullAudioModal() {
  if (fullAudioModal) {
    fullAudioModal.classList.add('hidden');
    // Limpiar iframe para detener la reproducción de inmediato al cerrar
    fullAudioContainer.innerHTML = '';
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
        const wave = Math.sin(Date.now() / 140 + i * 0.7) * 14 + Math.cos(Date.now() / 200 + i) * 6;
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
