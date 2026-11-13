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
      is_vip INTEGER DEFAULT 0,
      subscription_status TEXT DEFAULT 'inactive',
      subscription_expires_at TEXT,
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
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

  // Migración automática de columnas para usuarios existentes
  try {
    const userCols = db.prepare("PRAGMA table_info(users)").all();
    const colNames = userCols.map(c => c.name);
    if (!colNames.includes('is_vip')) db.exec("ALTER TABLE users ADD COLUMN is_vip INTEGER DEFAULT 0");
    if (!colNames.includes('subscription_status')) db.exec("ALTER TABLE users ADD COLUMN subscription_status TEXT DEFAULT 'inactive'");
    if (!colNames.includes('subscription_expires_at')) db.exec("ALTER TABLE users ADD COLUMN subscription_expires_at TEXT");
    if (!colNames.includes('stripe_customer_id')) db.exec("ALTER TABLE users ADD COLUMN stripe_customer_id TEXT");
    if (!colNames.includes('stripe_subscription_id')) db.exec("ALTER TABLE users ADD COLUMN stripe_subscription_id TEXT");
  } catch (_) {}

  // Crear o actualizar usuario admin por defecto con acceso VIP permanente
  const checkAdmin = db.prepare('SELECT id FROM users WHERE username = ?');
  if (!checkAdmin.get('admin')) {
    db.prepare(`
      INSERT INTO users (username, password, role, is_vip, subscription_status, subscription_expires_at) 
      VALUES (?, ?, ?, 1, 'active', '2099-12-31T23:59:59.000Z')
    `).run('admin', 'admin', 'VIP Admin');
  } else {
    db.prepare(`
      UPDATE users 
      SET is_vip = 1, subscription_status = 'active', subscription_expires_at = '2099-12-31T23:59:59.000Z', role = 'VIP Admin'
      WHERE username = 'admin'
    `).run();
  }

  // Restaurar automáticamente playlist desde vice_store.json persistente si SQLite está vacío (ej: nuevo deploy en Render)
  const countRow = db.prepare('SELECT COUNT(*) as cnt FROM playlists').get();
  if (countRow && countRow.cnt === 0 && fs.existsSync(JSON_FILE)) {
    try {
      const store = loadJsonStore();
      const insertStmt = db.prepare(`
        INSERT OR IGNORE INTO playlists (username, title, artist, cover, preview, album, duration, video_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const [u, plist] of Object.entries(store.playlists || {})) {
        if (Array.isArray(plist)) {
          for (let i = plist.length - 1; i >= 0; i--) {
            const t = plist[i];
            if (t && t.title) {
              insertStmt.run(
                u.toLowerCase().trim(),
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
        }
      }
      console.log('📦 [Database] Playlists restauradas automáticamente desde vice_store.json');
    } catch (err) {
      console.warn('Advertencia al restaurar JSON a SQLite:', err.message);
    }
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
      const stmt = db.prepare('SELECT id, username, password, role, is_vip, subscription_status, subscription_expires_at, stripe_customer_id, stripe_subscription_id, created_at FROM users WHERE lower(username) = ?');
      const u = stmt.get(cleanUser);
      if (u) return u;
    } catch (_) {}
  }
  const store = loadJsonStore();
  const u = store.users[cleanUser] || null;
  if (u && cleanUser === 'admin') {
    u.is_vip = 1;
    u.subscription_status = 'active';
    u.subscription_expires_at = '2099-12-31T23:59:59.000Z';
  }
  return u;
}

export function isUserVipActive(username) {
  if (!username) return false;
  const cleanUser = username.trim().toLowerCase();
  if (cleanUser === 'admin') return true;
  const user = getUser(cleanUser);
  if (!user) return false;
  if (user.role === 'VIP Admin' || user.username === 'admin') return true;
  if (user.subscription_status === 'active' || user.is_vip === 1) {
    if (!user.subscription_expires_at) return true;
    return new Date(user.subscription_expires_at).getTime() > Date.now();
  }
  return false;
}

export function setUserVip(username, status = 'active', expiresAt = null, customerId = '', subId = '') {
  if (!username) return null;
  const cleanUser = username.trim().toLowerCase();
  const exp = expiresAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const isVipNum = (status === 'active') ? 1 : 0;

  if (db && !useJsonStore) {
    try {
      db.prepare(`
        UPDATE users 
        SET is_vip = ?, subscription_status = ?, subscription_expires_at = ?, stripe_customer_id = ?, stripe_subscription_id = ?
        WHERE lower(username) = ?
      `).run(isVipNum, status, exp, customerId || '', subId || '', cleanUser);
    } catch (_) {}
  }

  const store = loadJsonStore();
  if (store.users[cleanUser]) {
    store.users[cleanUser].is_vip = isVipNum;
    store.users[cleanUser].subscription_status = status;
    store.users[cleanUser].subscription_expires_at = exp;
    if (customerId) store.users[cleanUser].stripe_customer_id = customerId;
    if (subId) store.users[cleanUser].stripe_subscription_id = subId;
    saveJsonStore(store);
  }
  return { username: cleanUser, isVip: isVipNum === 1, subscription_status: status, subscription_expires_at: exp };
}

export function createUser(username, password, role = 'VIP Member') {
  if (!username || !password) throw new Error('Usuario y contraseña requeridos');
  const cleanUser = username.trim().toLowerCase();

  if (db && !useJsonStore) {
    try {
      const stmt = db.prepare('INSERT INTO users (username, password, role, is_vip, subscription_status) VALUES (?, ?, ?, 0, \'inactive\')');
      stmt.run(cleanUser, password, role);
      return { username: cleanUser, role, is_vip: 0, subscription_status: 'inactive' };
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
    is_vip: 0,
    subscription_status: 'inactive',
    subscription_expires_at: null,
    created_at: new Date().toISOString()
  };
  saveJsonStore(store);
  return { username: cleanUser, role, is_vip: 0, subscription_status: 'inactive' };
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
      const resTracks = getPlaylist(cleanUser);
      try {
        const store = loadJsonStore();
        store.playlists[cleanUser] = resTracks;
        saveJsonStore(store);
      } catch (_) {}
      return resTracks;
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
      const resTracks = getPlaylist(cleanUser);
      try {
        const store = loadJsonStore();
        store.playlists[cleanUser] = resTracks;
        saveJsonStore(store);
      } catch (_) {}
      return resTracks;
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

export function removeFromPlaylist(username, title, artist, id = null) {
  if (!username) return [];
  const cleanUser = username.trim().toLowerCase();
  const cleanTitle = (title || '').trim().toLowerCase();
  const numId = id ? parseInt(id, 10) : null;

  if (db && !useJsonStore) {
    try {
      if (numId && !isNaN(numId)) {
        db.prepare('DELETE FROM playlists WHERE lower(username) = ? AND id = ?').run(cleanUser, numId);
      } else if (cleanTitle) {
        db.prepare('DELETE FROM playlists WHERE lower(username) = ? AND trim(lower(title)) = ?').run(cleanUser, cleanTitle);
      }
      const resTracks = getPlaylist(cleanUser);
      try {
        const store = loadJsonStore();
        store.playlists[cleanUser] = resTracks;
        saveJsonStore(store);
      } catch (_) {}
      return resTracks;
    } catch (_) {}
  }

  const store = loadJsonStore();
  if (store.playlists[cleanUser]) {
    store.playlists[cleanUser] = store.playlists[cleanUser].filter(t => {
      if (numId && t.id && t.id === numId) return false;
      if (cleanTitle && (t.title || '').trim().toLowerCase() === cleanTitle) return false;
      return true;
    });
    saveJsonStore(store);
    return store.playlists[cleanUser];
  }
  return [];
}
