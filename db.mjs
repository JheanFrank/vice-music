import fs from 'fs';
import path from 'path';

const DATA_DIR = path.resolve('data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

let db = null;
let useJsonStore = false;
const JSON_FILE = path.join(DATA_DIR, 'vice_store.json');

// Inicializar almacenamiento JSON por defecto para máxima compatibilidad
function loadJsonStore() {
  if (!fs.existsSync(JSON_FILE)) {
    const initial = {
      users: {
        admin: { username: 'admin', password: 'admin', role: 'VIP Admin', created_at: new Date().toISOString() }
      },
      playlists: {}
    };
    fs.writeFileSync(JSON_FILE, JSON.stringify(initial, null, 2), 'utf-8');
    return initial;
  }
  try {
    return JSON.parse(fs.readFileSync(JSON_FILE, 'utf-8'));
  } catch (_) {
    return { users: {}, playlists: {} };
  }
}

function saveJsonStore(data) {
  try {
    fs.writeFileSync(JSON_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error al guardar datos en JSON store:', err.message);
  }
}

try {
  const { DatabaseSync } = await import('node:sqlite');
  db = new DatabaseSync(path.join(DATA_DIR, 'vice_music.db'));
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'VIP Member',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS playlists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      cover TEXT,
      preview TEXT,
      album TEXT,
      duration INTEGER,
      video_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(username, title, artist)
    );
  `);

  // Crear usuario admin por defecto si no existe
  const checkAdmin = db.prepare('SELECT id FROM users WHERE username = ?');
  if (!checkAdmin.get('admin')) {
    db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)').run('admin', 'admin', 'VIP Admin');
  }

  console.log('📦 [Database] Motor SQL Relacional Estándar activado con éxito en data/vice_music.db');
} catch (e) {
  console.warn('⚠️ [Database] SQLite no disponible, usando almacén JSON persistente:', e.message);
  useJsonStore = true;
  loadJsonStore();
}

export function getUser(username) {
  if (!username) return null;
  const cleanUser = username.trim().toLowerCase();
  if (db && !useJsonStore) {
    try {
      const stmt = db.prepare('SELECT id, username, password, role, created_at FROM users WHERE lower(username) = ?');
      return stmt.get(cleanUser);
    } catch (_) {}
  }
  const store = loadJsonStore();
  return store.users[cleanUser] || null;
}

export function createUser(username, password, role = 'VIP Member') {
  if (!username || !password) throw new Error('Usuario y contraseña requeridos');
  const cleanUser = username.trim().toLowerCase();

  if (db && !useJsonStore) {
    try {
      const stmt = db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)');
      stmt.run(cleanUser, password, role);
      return { username: cleanUser, role };
    } catch (e) {
      if (e.message?.includes('UNIQUE')) {
        throw new Error('El nombre de usuario ya está registrado');
      }
      throw e;
    }
  }

  const store = loadJsonStore();
  if (store.users[cleanUser]) {
    throw new Error('El nombre de usuario ya está registrado');
  }
  store.users[cleanUser] = {
    username: cleanUser,
    password,
    role,
    created_at: new Date().toISOString()
  };
  saveJsonStore(store);
  return { username: cleanUser, role };
}

export function getPlaylist(username) {
  if (!username) return [];
  const cleanUser = username.trim().toLowerCase();

  if (db && !useJsonStore) {
    try {
      const stmt = db.prepare('SELECT id, title, artist, cover, preview, album, duration, video_id as videoId, created_at FROM playlists WHERE lower(username) = ? ORDER BY id DESC');
      return stmt.all(cleanUser) || [];
    } catch (_) {}
  }

  const store = loadJsonStore();
  return store.playlists[cleanUser] || [];
}

export function addMultipleToPlaylist(username, tracks, position = 'end') {
  if (!username || !Array.isArray(tracks) || tracks.length === 0) return getPlaylist(username);
  const cleanUser = username.trim().toLowerCase();

  const current = getPlaylist(cleanUser);
  const existingKeys = new Set(current.map(t => `${t.title.toLowerCase().trim()}___${(t.artist || '').toLowerCase().trim()}`));
  
  const toAdd = tracks.filter(t => t && t.title && !existingKeys.has(`${t.title.toLowerCase().trim()}___${(t.artist || '').toLowerCase().trim()}`));
  if (toAdd.length === 0) return current;

  let updatedList = [];
  if (position === 'start') {
    updatedList = [...toAdd, ...current];
  } else {
    updatedList = [...current, ...toAdd];
  }

  return setPlaylist(cleanUser, updatedList);
}

export function setPlaylist(username, fullPlaylist) {
  if (!username) return [];
  const cleanUser = username.trim().toLowerCase();
  const list = Array.isArray(fullPlaylist) ? fullPlaylist : [];

  if (db && !useJsonStore) {
    try {
      db.prepare('DELETE FROM playlists WHERE lower(username) = ?').run(cleanUser);
      const insertStmt = db.prepare(`
        INSERT INTO playlists (username, title, artist, cover, preview, album, duration, video_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      // Insertar en orden inverso para que ORDER BY id DESC preserve la lista exactamente
      for (let i = list.length - 1; i >= 0; i--) {
        const t = list[i];
        if (t && t.title) {
          insertStmt.run(
            cleanUser,
            t.title,
            t.artist || 'Desconocido',
            t.cover || '',
            t.preview || t.audioUrl || '',
            t.album || '',
            t.duration || 0,
            t.videoId || t.video_id || ''
          );
        }
      }
      return getPlaylist(cleanUser);
    } catch (e) {
      console.warn('Error guardando playlist en SQLite:', e.message);
    }
  }

  const store = loadJsonStore();
  store.playlists[cleanUser] = list.map((t, idx) => ({
    id: t.id || (Date.now() + idx),
    title: t.title,
    artist: t.artist || 'Desconocido',
    cover: t.cover || '',
    preview: t.preview || t.audioUrl || '',
    album: t.album || '',
    duration: t.duration || 0,
    videoId: t.videoId || t.video_id || '',
    created_at: t.created_at || new Date().toISOString()
  }));
  saveJsonStore(store);
  return store.playlists[cleanUser];
}

export function addToPlaylist(username, track) {
  if (!username || !track || !track.title) throw new Error('Datos de canción incompletos');
  const cleanUser = username.trim().toLowerCase();

  if (db && !useJsonStore) {
    try {
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO playlists (username, title, artist, cover, preview, album, duration, video_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        cleanUser,
        track.title,
        track.artist || 'Desconocido',
        track.cover || '',
        track.preview || track.audioUrl || '',
        track.album || '',
        track.duration || 0,
        track.videoId || ''
      );
      return getPlaylist(cleanUser);
    } catch (e) {
      console.warn('Error al insertar en SQLite playlist:', e.message);
    }
  }

  const store = loadJsonStore();
  if (!store.playlists[cleanUser]) store.playlists[cleanUser] = [];
  
  // Evitar duplicados
  const exists = store.playlists[cleanUser].some(t => t.title.toLowerCase() === track.title.toLowerCase() && t.artist.toLowerCase() === (track.artist || '').toLowerCase());
  if (!exists) {
    store.playlists[cleanUser].unshift({
      id: Date.now(),
      title: track.title,
      artist: track.artist || 'Desconocido',
      cover: track.cover || '',
      preview: track.preview || track.audioUrl || '',
      album: track.album || '',
      duration: track.duration || 0,
      videoId: track.videoId || '',
      created_at: new Date().toISOString()
    });
    saveJsonStore(store);
  }
  return store.playlists[cleanUser];
}

export function removeFromPlaylist(username, title, artist) {
  if (!username || !title) return [];
  const cleanUser = username.trim().toLowerCase();
  const cleanTitle = title.trim().toLowerCase();

  if (db && !useJsonStore) {
    try {
      const stmt = db.prepare('DELETE FROM playlists WHERE lower(username) = ? AND trim(lower(title)) = ?');
      stmt.run(cleanUser, cleanTitle);
      return getPlaylist(cleanUser);
    } catch (_) {}
  }

  const store = loadJsonStore();
  if (store.playlists[cleanUser]) {
    store.playlists[cleanUser] = store.playlists[cleanUser].filter(t => (t.title || '').trim().toLowerCase() !== cleanTitle);
    saveJsonStore(store);
    return store.playlists[cleanUser];
  }
  return [];
}
