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

  console.log('📦 [Database] Motor SQLite nativo activado con éxito en data/vice_music.db');
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

  if (db && !useJsonStore) {
    try {
      const stmt = db.prepare('DELETE FROM playlists WHERE lower(username) = ? AND lower(title) = ?');
      stmt.run(cleanUser, title.toLowerCase());
      return getPlaylist(cleanUser);
    } catch (_) {}
  }

  const store = loadJsonStore();
  if (store.playlists[cleanUser]) {
    store.playlists[cleanUser] = store.playlists[cleanUser].filter(t => t.title.toLowerCase() !== title.toLowerCase());
    saveJsonStore(store);
    return store.playlists[cleanUser];
  }
  return [];
}
