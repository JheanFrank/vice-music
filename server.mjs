// Build trigger: 2026-10-23T22:30:00.0000000Z
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dns from 'dns';
import { spawn } from 'child_process';
import { Readable } from 'stream';
import ffmpegPath from 'ffmpeg-static';
import { Ytdl, Client, createPoTokenProvider } from '@distube/ytdl-core';
import { getUser, createUser, getPlaylist, addToPlaylist, removeFromPlaylist, addMultipleToPlaylist, setPlaylist } from './db.mjs';

try {
  if (ffmpegPath) fs.chmodSync(ffmpegPath, 0o755);
} catch (_) {}

// Motor de descarga multi-cliente (Tv + WebEmbedded + VisionOS + Mweb) anti-bloqueo para Render
let ytdlInstance = new Ytdl({ clients: [Client.Tv, Client.WebEmbedded, Client.VisionOS, Client.Mweb] });
console.log('⚡ [YTDL] Motor multi-cliente nativo (Tv + WebEmbedded + VisionOS) activado con éxito.');

const audioUrlCache = new Map();
const motionArtworkCache = new Map();

const INVIDIOUS_INSTANCES = [
  'https://yt.chocolatemoo53.com',
  'https://invidious.nerdvpn.de',
  'https://invidious.jing.rocks'
];

function normalizeStr(str) {
  return (str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

const ARTIST_STOP_WORDS = new Set(['de', 'la', 'el', 'los', 'las', 'del', 'san', 'y', 'e', 'en', 'con', 'por', 'the', 'and', 'of', 'ft', 'feat']);

function getFullArtistCredits(artist, title) {
  let fullArtist = (artist || '').trim();
  if (!title) return fullArtist;

  const featMatch = title.match(/[\(\[]\s*(?:feat\.?|ft\.?|con)\s+([^\)\]]+)[\)\]]/i);
  if (featMatch && featMatch[1]) {
    const featArtist = featMatch[1].trim();
    if (!fullArtist.toLowerCase().includes(featArtist.toLowerCase())) {
      fullArtist = `${fullArtist} ft. ${featArtist}`;
    }
  }
  return fullArtist;
}

function parseDurationSec(durStr) {
  if (!durStr) return 0;
  const parts = durStr.trim().split(':').map(Number);
  if (parts.some(isNaN)) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

const BAD_CHANNELS = [
  'latinhype', 'cantoyo', 'karaoke', 'clean hits', 'reaction', 'tutorial',
  'videos oficiales fm', 'flowkalle', 'gustavo paternina', 'ted sky', 'lover of music',
  'flow trap', 'trap urbano', 'find x', 'maycol estrenos', 'corto goat', 'temazos',
  'temazos de reggaeton', 'pxxr4ever', 'uforia debut'
];

async function fetchYtCandidates(queryTerm, isIsrc = false) {
  try {
    const ytRes = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(queryTerm)}`, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept-Language': 'es-419,es;q=0.9,en;q=0.8'
      },
      signal: AbortSignal.timeout(6500)
    });
    const html = await ytRes.text();
    const startIdx = html.indexOf('var ytInitialData = ');
    if (startIdx === -1) return [];
    const endIdx = html.indexOf(';</script>', startIdx);
    const data = JSON.parse(html.substring(startIdx + 20, endIdx));
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
          const hasAudioBadge = v.ownerBadges?.some(b => b.metadataBadgeRenderer?.icon?.iconType === 'AUDIO_BADGE') || false;
          const isVerified = badges.some(b => b && (b.includes('VERIFIED') || b.includes('ARTIST'))) || hasAudioBadge;
          const isTopic = channel.endsWith(' - Topic') || channel.includes('Topic');
          const durStr = v.lengthText?.simpleText || v.thumbnailOverlays?.[0]?.thumbnailOverlayTimeStatusRenderer?.text?.simpleText || '';
          const durSec = parseDurationSec(durStr);
          candidates.push({ id: v.videoId, title, channel, isVerified, isTopic, hasAudioBadge, fromIsrc: isIsrc, durStr, durSec });
        }
      }
    }
    return candidates;
  } catch (_) {
    return [];
  }
}

async function resolveFullAudio(artist, title, durationParam = 0, isrcParam = '') {
  const cleanArtist = (artist || '').replace(/\s*[\(\[].*?[\)\]]/gi, '').trim();
  const cleanTitle = (title || '').replace(/\s*[\(\[].*?[\)\]]/gi, '').trim();
  const isRemixRequest = /remix|rmx/i.test(`${title} ${artist}`);
  const userWantsFemale = /female|mujer|femenin/i.test(`${title} ${artist}`);
  const userWantsLive = /en vivo|live|concierto|en directo/i.test(`${title} ${artist}`);

  // Extraer lista completa de artistas tanto del campo artist como de cualquier (feat. ...) en el título
  let allArtistNames = [];
  const fullRawArtist = getFullArtistCredits(artist, title);

  const extractedFromFeat = [];
  const featMatch = (title || '').match(/[\(\[]\s*(?:feat\.?|ft\.?|con)\s+([^\)\]]+)[\)\]]/i);
  if (featMatch && featMatch[1]) {
    const featTokens = featMatch[1].split(/\s*(?:&|&amp;|,|[xX]|ft\.?|feat\.?|con)\s*/i);
    featTokens.forEach(t => {
      const name = t.trim();
      if (name.length >= 2) extractedFromFeat.push(name);
    });
  }

  const artistTokens = fullRawArtist.split(/\s*(?:&|&amp;|,|[xX]|ft\.?|feat\.?|con)\s*/i);
  artistTokens.forEach(t => {
    const name = t.trim();
    if (name.length >= 2) allArtistNames.push(name);
  });
  extractedFromFeat.forEach(f => {
    if (!allArtistNames.some(a => a.toLowerCase() === f.toLowerCase())) {
      allArtistNames.push(f);
    }
  });

  const primaryArtist = allArtistNames[0] || cleanArtist;

  // Palabras clave obligatorias del título (normalizadas sin tildes ni acentos)
  const normCleanTitle = normalizeStr(cleanTitle);
  const rawTitleWords = normCleanTitle
    .replace(/[^\w\s]/gi, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 2);

  const stopWords = new Set(['con', 'del', 'las', 'los', 'por', 'que', 'una', 'uno', 'the', 'and', 'for', 'feat', 'ft']);
  const titleKeywords = rawTitleWords.filter(w => !stopWords.has(w));
  const effectiveTitleWords = titleKeywords.length > 0 ? titleKeywords : rawTitleWords;

  // Buscar ISRC y Colaboradores Oficiales en Deezer
  let isrc = isrcParam;
  let resolvedArtist = cleanArtist;
  if (!isrc) {
    try {
      const dzQueries = [];
      if (extractedFromFeat.length > 0) {
        dzQueries.push(`${cleanTitle} ${extractedFromFeat.slice(0, 2).join(' ')}`);
        dzQueries.push(`${cleanTitle} ${isRemixRequest ? 'remix' : ''}`);
      }
      dzQueries.push(`${primaryArtist} ${cleanTitle} ${isRemixRequest ? 'remix' : ''}`);
      dzQueries.push(`${cleanArtist} ${cleanTitle}`);

      for (const q of dzQueries) {
        const dzRes = await fetch(`https://api.deezer.com/search?q=${encodeURIComponent(q.trim())}&limit=5`, {
          headers: { 'User-Agent': USER_AGENT },
          signal: AbortSignal.timeout(2500)
        });
        const dzData = await dzRes.json();
        if (dzData.data && Array.isArray(dzData.data) && dzData.data.length > 0) {
          // Filtrar el mejor candidato de Deezer validando que corresponda al artista solicitado
          const priNorm = normalizeStr(primaryArtist);
          const bestDz = dzData.data.find(d => {
            const dTitle = (d.title || '').toLowerCase();
            const dArtist = normalizeStr(d.artist?.name || '');
            if (!dArtist.includes(priNorm) && !priNorm.includes(dArtist)) return false;
            if (!userWantsFemale && /female version|version femenina|versión femenina/i.test(dTitle)) return false;
            if (isRemixRequest && !/remix|rmx/i.test(dTitle)) return false;
            return true;
          });

          if (bestDz && bestDz.id) {
            const trkRes = await fetch(`https://api.deezer.com/track/${bestDz.id}`, {
              headers: { 'User-Agent': USER_AGENT },
              signal: AbortSignal.timeout(2000)
            });
            const trkData = await trkRes.json();
            if (trkData.contributors && Array.isArray(trkData.contributors) && trkData.contributors.length > 1) {
              const performingContributors = trkData.contributors.filter(c => 
                !c.role || c.role.toLowerCase() === 'main' || c.role.toLowerCase() === 'featured'
              );
              const cNames = performingContributors.map(c => c.name).filter(Boolean);
              if (cNames.length > 1) {
                resolvedArtist = cNames.join(' x ');
              }
            }
            if (trkData.isrc) {
              isrc = trkData.isrc;
              break;
            }
          }
        }
      }
    } catch (_) {}
  }

  // Si aún no detectamos colaboradores, consultar iTunes brevemente con validación estricta
  if (!resolvedArtist.includes('&') && !resolvedArtist.includes('x') && !resolvedArtist.includes('X') && !resolvedArtist.includes('feat') && !resolvedArtist.includes(',')) {
    try {
      const itRes = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(cleanArtist + ' ' + cleanTitle)}&entity=song&limit=5`, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(2000)
      });
      const itData = await itRes.json();
      if (itData.results && Array.isArray(itData.results)) {
        const cleanPriNorm = normalizeStr(primaryArtist);
        const match = itData.results.find(r => {
          const rTitle = normalizeStr(r.trackName || '');
          if (!userWantsFemale && /female|femenin/i.test(rTitle)) return false;
          const rArtist = normalizeStr(r.artistName || '');
          const rPrimary = rArtist.split(/\s*(?:&|&amp;|,|[xX]|ft\.?|feat\.?|con)\s*/i)[0].trim();
          return rArtist.includes(cleanPriNorm) || cleanPriNorm.includes(rPrimary);
        });
        if (match && match.artistName) {
          const itArtist = match.artistName;
          if (itArtist.includes('&') || itArtist.includes(',') || itArtist.includes('feat') || itArtist.includes('ft') || itArtist.includes('x') || itArtist.includes('X')) {
            resolvedArtist = itArtist;
          }
        }
      }
    } catch (_) {}
  }
  resolvedArtist = getFullArtistCredits(resolvedArtist, title);

  // Actualizar allArtistNames con resolvedArtist para maximizar coincidencia en YouTube
  const resolvedTokens = resolvedArtist.split(/\s*(?:&|&amp;|,|[xX]|ft\.?|feat\.?|con)\s*/i);
  resolvedTokens.forEach(t => {
    const name = t.trim();
    if (name.length >= 2 && !allArtistNames.some(a => a.toLowerCase() === name.toLowerCase())) {
      allArtistNames.push(name);
    }
  });

  let rawCandidates = [];
  if (isrc) {
    const isrcCandidates = await fetchYtCandidates(isrc, true);
    rawCandidates.push(...isrcCandidates);
  }

  // Búsquedas dirigidas con colaboradores para garantizar versiones reales con invitados
  if (extractedFromFeat.length > 0) {
    const featCandidates = await fetchYtCandidates(`${cleanTitle} ${extractedFromFeat.slice(0, 3).join(' ')} audio`);
    rawCandidates.push(...featCandidates);
  } else if (allArtistNames.length > 1) {
    const multiArtistCandidates = await fetchYtCandidates(`${cleanTitle} ${allArtistNames.slice(0, 3).join(' ')} audio`);
    rawCandidates.push(...multiArtistCandidates);
  }

  // Si la pista solicitada es en vivo, buscar explícitamente la versión en vivo del artista
  if (userWantsLive) {
    const liveCandidates = await fetchYtCandidates(`${primaryArtist} ${cleanTitle} Live`);
    rawCandidates.push(...liveCandidates);
    const liveCandidates2 = await fetchYtCandidates(`${primaryArtist} ${cleanTitle} en vivo`);
    rawCandidates.push(...liveCandidates2);
  }

  // 1° Búsqueda: YouTube Music Master Topic con artista principal y título
  const topicCandidates = await fetchYtCandidates(`${primaryArtist} ${cleanTitle} ${isRemixRequest ? 'Remix' : ''} Topic`);
  rawCandidates.push(...topicCandidates);

  // 2° Búsqueda: Audio Oficial
  const audioOficialCandidates = await fetchYtCandidates(`${primaryArtist} ${cleanTitle} ${isRemixRequest ? 'Remix' : ''} audio oficial`);
  rawCandidates.push(...audioOficialCandidates);

  // 2.5° Búsqueda: Audio Oficial con Colaboradores (ej: Bryant Myers De La Ghetto Darell Almighty Ojala audio oficial)
  const cleanCollabs = allArtistNames.slice(1).filter(a => !ARTIST_STOP_WORDS.has(normalizeStr(a))).join(' ');
  if (cleanCollabs) {
    const fullCollabAudio = await fetchYtCandidates(`${primaryArtist} ${cleanCollabs} ${cleanTitle} audio oficial`);
    rawCandidates.push(...fullCollabAudio);
  }

  // 3° Búsqueda: Letra / Lyrics si hay pocos candidatos
  if (rawCandidates.length < 8) {
    const lyricCandidates = await fetchYtCandidates(`${cleanArtist} ${cleanTitle} ${isRemixRequest ? 'Remix' : ''} lyric video letra`);
    rawCandidates.push(...lyricCandidates);
  }
  // 4° Búsqueda estándar
  if (rawCandidates.length < 6) {
    const stdCandidates = await fetchYtCandidates(`${primaryArtist} ${cleanTitle} ${isRemixRequest ? 'Remix' : ''}`);
    rawCandidates.push(...stdCandidates);
  }

  // Deduplicar por videoId
  const seen = new Set();
  const uniqueCandidates = [];
  for (const c of rawCandidates) {
    if (!seen.has(c.id)) {
      seen.add(c.id);
      uniqueCandidates.push(c);
    }
  }

  function score(c) {
    let s = 0;
    const t = normalizeStr(c.title);
    const ch = normalizeStr(c.channel);
    const combined = `${t} ${ch}`;
    
    // 1. DESCARTE ESTRICTO DE VERSIONES NO DESEADAS
    if (!userWantsFemale && /female version|version femenina|versión femenina|version mujer|versión mujer|cover femenino/i.test(t)) {
      return -9999;
    }
    if (t.includes('parodia') || t.includes('karaoke') || t.includes('reaccion') || t.includes('reaction') || t.includes('tutorial') || t.includes('1 hour') || t.includes('1 hora') || t.includes('slowed') || t.includes('loop')) {
      return -9999;
    }
    if (BAD_CHANNELS.some(b => ch.includes(normalizeStr(b)))) return -9999;

    // Descartar versiones "En Vivo" / "Live" / "Concierto" si la pista original NO es en vivo
    if (!userWantsLive) {
      if (/en vivo|live at|concierto|en directo|live session|show en vivo|acustico|acústico|los carlos julios/i.test(t) || 
          /los carlos julios/i.test(ch) || 
          /\(live\)|\blive\b|\[live\]/i.test(c.title)) {
        return -9999; // DISQUALIFIED! Jamás poner concierto en vivo si la pista original de estudio no es en vivo
      }
    } else {
      if (/en vivo|live|concierto|en directo/i.test(t) || /\(live\)|\blive\b|\[live\]/i.test(c.title)) {
        s += 260; // Si la canción oficial ES en vivo, bonificación para capturar la interpretación oficial
      }
    }

    // Descartar versiones "Solo" si la pista original es una colaboración o remix
    if ((allArtistNames.length > 1 || isRemixRequest) && (t.includes('(solo)') || t.includes('version solo') || t.includes('original version/solo') || t.includes('original version / solo'))) {
      return -9999;
    }

    // 2. REQUISITO OBLIGATORIO DE TÍTULO (INQUEBRANTABLE)
    // El video DEBE coincidir con las palabras del título sin importar tildes/acentos
    if (effectiveTitleWords.length === 1) {
      if (!t.includes(effectiveTitleWords[0])) {
        return -9999;
      }
      s += 160;
    } else {
      const matchedWords = effectiveTitleWords.filter(w => t.includes(w));
      if (matchedWords.length < Math.ceil(effectiveTitleWords.length * 0.6)) {
        return -9999;
      }
      s += Math.round((matchedWords.length / effectiveTitleWords.length) * 160);
    }

    // 3. REQUISITO OBLIGATORIO DE ARTISTAS (INQUEBRANTABLE)
    // El video DEBE incluir al artista principal (con límite de palabra, descartando preposiciones como "de", "la")
    const primaryTokens = normalizeStr(primaryArtist)
      .split(/\s+/)
      .filter(w => w.length >= 3 && !ARTIST_STOP_WORDS.has(w));
    if (primaryTokens.length > 0) {
      const primaryMatched = primaryTokens.some(w => new RegExp('\\b' + w + '\\b', 'i').test(combined));
      if (!primaryMatched) {
        return -9999; // DISQUALIFIED! Falta el artista principal (ej: Ryan Castro en lugar de Bryant Myers)
      }
    }

    if (allArtistNames.length > 0) {
      let matchedArtistsCount = 0;
      for (const aName of allArtistNames) {
        const aWords = normalizeStr(aName).split(/\s+/).filter(w => w.length >= 3 && !ARTIST_STOP_WORDS.has(w));
        if (aWords.length > 0 && aWords.some(w => new RegExp('\\b' + w + '\\b', 'i').test(combined))) {
          matchedArtistsCount++;
        }
      }

      if (matchedArtistsCount === 0) {
        return -9999; // DISQUALIFIED! Ni los artistas coinciden -> JAMÁS se reproduce
      }

      s += matchedArtistsCount * 130;
      if (matchedArtistsCount === allArtistNames.length) {
        s += 280; // Bonificación máxima si figuran TODOS los artistas
      }
    }
    
    // 4. Requisito Estricto de Remix vs Versión Original
    const isCandidateRemix = /remix|rmx/i.test(t);
    const isOfficialArtistChannel = allArtistNames.some(aName => ch.includes(normalizeStr(aName)));

    if (isRemixRequest) {
      if (isCandidateRemix || combined.includes('remix') || combined.includes('rmx') || isOfficialArtistChannel) {
        s += 200;
      } else {
        s -= 450; // Penalización severa si el usuario pidió Remix pero el video es la versión sin invitados
      }
    } else {
      if (isCandidateRemix && !cleanTitle.includes('remix')) {
        s -= 250; // Si no era remix, evitar versiones remix
      }
    }
    
    // 5. Comparación Exacta de Duración con el Preview Oficial de Deezer/iTunes
    // Nota: durationParam === 180 era el valor por defecto antiguo, no descalificar si es 180
    if (durationParam > 30 && durationParam !== 180 && c.durSec > 0) {
      const diff = Math.abs(c.durSec - durationParam);
      if (diff > 35) {
        return -9999; // DISQUALIFIED! Más de 35s de diferencia con el preview oficial no es la misma versión
      }
      if (diff <= 3) s += 350;
      else if (diff <= 7) s += 220;
      else if (diff <= 14) s += 120;
      else if (diff <= 22) s += 40;
      else s -= 250;
    } else if (c.durSec >= 290 && c.durSec <= 325 && (durationParam === 0 || durationParam === 180)) {
      s += 300; // Gran bonificación si dura alrededor de 5 minutos (duración estándar de Ojalá 5:05)
    }
    
    // Descarte absoluto de covers, homenajes o imitadores
    if (/cover|homenaje|karaoke|imitador|pista instrumental|acapella/i.test(t)) {
      return -9999;
    }

    // 6. Jerarquía Estricta: 1° Audio Oficial / Topic > 2° Letra/Lyrics > 3° Video Oficial con diálogos/skits
    const isPureAudio = /cancion oficial|official audio|audio oficial|\(audio\)|\[audio\]|visualizer/i.test(t);
    const isLyric = /lyric|letra|lyrics/i.test(t);
    const isMusicVideo = /video oficial|official video|music video|\(oficial\)/i.test(t) && !/audio/i.test(t);

    if (isPureAudio) {
      s += 650; // Bonificación prioritaria para pistas de puro audio de estudio comercial
    } else if (isLyric) {
      s += 500; // Letras y lyric videos contienen el master de estudio limpio sin skits
    } else if (isMusicVideo) {
      s -= 250; // Penalización severa a video oficial con skits de diálogo, disparos y compresión
    }
    
    // Bonificación MASIVA para canales oficiales de entrega discográfica (Topic)
    if (c.isTopic || ch.endsWith(' - topic') || ch.includes('topic')) {
      s += 850; // Topic es 100% el master de estudio idéntico al preview de Deezer/Spotify
    } else if (isOfficialArtistChannel) {
      s += 200; // Canal oficial del artista
    }

    if (c.hasAudioBadge || /provided to youtube/i.test(combined)) {
      s += 200;
    }
    if (c.isVerified) s += 80;
    
    return s;
  }

  const scored = uniqueCandidates
    .filter(c => c.durSec === 0 || (c.durSec >= 60 && c.durSec <= 700))
    .map(c => ({ ...c, score: score(c) }))
    .filter(c => c.score > -1000)
    .sort((a, b) => b.score - a.score);

  const selected = scored[0] || null;
  const alternatives = scored.slice(1, 6).map(c => c.id);

  return { selected, alternatives, scored, resolvedArtist };
}

async function getAudioStreamForVideo(videoId, altIds = []) {
  const candidateIds = [videoId, ...(altIds || [])].filter((id, idx, arr) => id && id.length === 11 && arr.indexOf(id) === idx);
  let lastError = null;

  for (const vId of candidateIds) {
    // 1. Intentar instancias de proxy Invidious (evita bloqueos de datacenter en Render)
    for (const inst of INVIDIOUS_INSTANCES) {
      try {
        const vRes = await fetch(`${inst}/api/v1/videos/${vId}?local=true`, {
          headers: { 'User-Agent': USER_AGENT },
          signal: AbortSignal.timeout(6000)
        });
        if (!vRes.ok) continue;
        const vData = await vRes.json();
        const audioFormats = (vData.adaptiveFormats || []).filter(f => 
          (f.type && f.type.includes('audio')) || 
          (f.mimeType && f.mimeType.includes('audio')) ||
          ['251', '140', '250', '249'].includes(String(f.itag))
        );
        // Priorizar mayor bitrate para máxima fidelidad HD (192k Opus / 128k AAC) y nunca itag 139 (48k)
        audioFormats.sort((a, b) => Number(b.bitrate || b.audioBitrate || 0) - Number(a.bitrate || a.audioBitrate || 0));
        const format = audioFormats[0];
        if (format && format.url) {
          const streamUrl = format.url.startsWith('http') && !format.url.includes(new URL(inst).hostname)
            ? `${inst}${new URL(format.url).pathname}${new URL(format.url).search}`
            : format.url;
          const aRes = await fetch(streamUrl, {
            headers: { 'User-Agent': USER_AGENT },
            signal: AbortSignal.timeout(180000)
          });
          if (aRes.ok && aRes.body) {
            console.log(`[Audio Engine] Flujo de audio obtenido exitosamente vía ${inst} para [${vId}] (itag ${format.itag})`);
            return Readable.fromWeb(aRes.body);
          }
        }
      } catch (e) {
        console.warn(`[Audio Engine] Intento con ${inst} para [${vId}] falló:`, e.message);
      }
    }

    // 2. Fallback a YTDL nativo multi-cliente (Tv + WebEmbedded + VisionOS)
    try {
      console.log(`[Audio Engine] Usando motor YTDL nativo multi-cliente para [${vId}]...`);
      const stream = ytdlInstance.download(vId, {
        filter: { hasAudio: true, hasVideo: false },
        quality: 'highestaudio'
      });

      // Validar recepción de audio sin errores asíncronos de YouTube (como bot check)
      await new Promise((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
          if (!settled) {
            settled = true;
            resolve();
          }
        }, 4000);

        stream.once('error', (err) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            reject(err);
          }
        });

        stream.once('readable', () => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve();
          }
        });
      });

      console.log(`[Audio Engine] Flujo YTDL nativo validado con éxito para [${vId}]`);
      return stream;
    } catch (yErr) {
      console.warn(`[Audio Engine] YTDL nativo falló para [${vId}]:`, yErr.message);
      lastError = yErr;
      // Rotación automática anti-bot: continúa de inmediato con la siguiente alternativa
    }

    // 3. Fallback a satélite directo savenow (evita 100% bloqueos de datacenter en Render en descargas consecutivas)
    try {
      console.log(`[Audio Engine] Probando satélite directo para [${vId}]...`);
      const directUrl = await getFullSongMp3Url(vId);
      if (directUrl) {
        const dRes = await fetch(directUrl, {
          headers: { 'User-Agent': USER_AGENT },
          signal: AbortSignal.timeout(60000)
        });
        if (dRes.ok && dRes.body) {
          console.log(`[Audio Engine] Flujo de audio obtenido exitosamente vía satélite directo para [${vId}]`);
          return Readable.fromWeb(dRes.body);
        }
      }
    } catch (sErr) {
      console.warn(`[Audio Engine] Satélite directo falló para [${vId}]:`, sErr.message);
    }
  }

  throw lastError || new Error(`No se pudo obtener el audio para ninguno de los videos probados: ${candidateIds.join(', ')}`);
}

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
    artist: getFullArtistCredits(t.artist ? t.artist.name : 'Artista', t.title),
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
  if (cachedTopColombia && cachedTopColombia.tracks && cachedTopColombia.tracks.length > 0 && (now - cachedTopColombiaTime < 1000 * 60 * 10)) {
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

    // Artistas Populares en Colombia (Deezer Chart Colombia ID 73)
    let artists = [];
    try {
      const artChart = await fetchDeezer('/chart/73/artists');
      if (artChart && Array.isArray(artChart.data) && artChart.data.length > 0) {
        const candidateArtists = artChart.data.slice(0, 10).map((a, idx) => ({
          rank: idx + 1,
          id: a.id,
          name: a.name,
          picture: a.picture_xl || a.picture_big || a.picture_medium,
          link: a.link,
          nbFans: a.nb_fan || null,
          type: 'artist'
        }));

        // Detectar si Deezer geolocalizó la IP del servidor en EE.UU. devolviendo Drake, Linkin Park, Taylor Swift, etc.
        const isGlobalLeak = candidateArtists.some(a => /drake|linkin park|taylor swift|noah kahan|olivia rodrigo|kendrick lamar/i.test(a.name));
        if (!isGlobalLeak) {
          artists = candidateArtists;
        }
      } else {
        // Fallback 1: Extraer los artistas únicos más populares de la playlist oficial Top Colombia
        if (plData && plData.tracks && Array.isArray(plData.tracks.data)) {
          const seenArt = new Set();
          for (const t of plData.tracks.data) {
            if (t.artist && t.artist.name && !seenArt.has(t.artist.name.toLowerCase())) {
              seenArt.add(t.artist.name.toLowerCase());
              artists.push({
                rank: artists.length + 1,
                id: t.artist.id,
                name: t.artist.name,
                picture: t.artist.picture_xl || t.artist.picture_big || t.artist.picture_medium,
                link: t.artist.link || `https://www.deezer.com/artist/${t.artist.id}`,
                nbFans: null,
                type: 'artist'
              });
              if (artists.length >= 10) break;
            }
          }
        }
      }
    } catch (artErr) {
      console.warn('Chart de artistas Colombia fallback:', artErr.message);
    }

    // Fallback 2: Superestrellas 100% auténticas de Colombia si los servicios externos están caídos
    if (artists.length === 0) {
      artists = [
        { rank: 1, id: 13915127, name: 'Ryan Castro', picture: 'https://cdn-images.dzcdn.net/images/artist/85e4705e8cab0354605581abd89c703d/500x500-000000-80-0-0.jpg', type: 'artist' },
        { rank: 2, id: 4894676, name: 'KAROL G', picture: 'https://cdn-images.dzcdn.net/images/artist/5b0aab23f8d2856951a92f3a9faf70e3/500x500-000000-80-0-0.jpg', type: 'artist' },
        { rank: 3, id: 5041443, name: 'Feid', picture: 'https://cdn-images.dzcdn.net/images/artist/e629c93e03b3c225d8d52a42bae71537/500x500-000000-80-0-0.jpg', type: 'artist' },
        { rank: 4, id: 10583405, name: 'Bad Bunny', picture: 'https://cdn-images.dzcdn.net/images/artist/044a3f315b041864887a8dd8709e6926/500x500-000000-80-0-0.jpg', type: 'artist' },
        { rank: 5, id: 74614, name: 'Diomedes Diaz', picture: 'https://cdn-images.dzcdn.net/images/artist/fd9922415127264b9708992d5b0908a4/500x500-000000-80-0-0.jpg', type: 'artist' },
        { rank: 6, id: 388172, name: 'Silvestre Dangond', picture: 'https://cdn-images.dzcdn.net/images/artist/615aa8dceb24854b2cfdbe6339067242/500x500-000000-80-0-0.jpg', type: 'artist' },
        { rank: 7, id: 64790472, name: 'Beele', picture: 'https://cdn-images.dzcdn.net/images/artist/517e60ed50f56034769b7e845a71e35c/500x500-000000-80-0-0.jpg', type: 'artist' },
        { rank: 8, id: 160, name: 'Shakira', picture: 'https://cdn-images.dzcdn.net/images/artist/69c569506a8ff6ab0edfecbd1adf94b0/500x500-000000-80-0-0.jpg', type: 'artist' },
        { rank: 9, id: 574229, name: 'J Balvin', picture: 'https://cdn-images.dzcdn.net/images/artist/325eaa46bc25052d0e3d549d60cc8225/500x500-000000-80-0-0.jpg', type: 'artist' },
        { rank: 10, id: 89617302, name: 'Blessd', picture: 'https://cdn-images.dzcdn.net/images/artist/23fc8c0353fa282b7db5b6a71eec8bce/500x500-000000-80-0-0.jpg', type: 'artist' }
      ];
    }

    // Álbumes y Sencillos Populares en Colombia (extraídos de los éxitos de Colombia)
    let albums = [];
    if (plData && plData.tracks && Array.isArray(plData.tracks.data)) {
      const seenAlb = new Set();
      for (const t of plData.tracks.data) {
        if (t.album && t.album.id && !seenAlb.has(t.album.id)) {
          seenAlb.add(t.album.id);
          albums.push({
            id: `deezer_${t.album.id}`,
            deezerId: t.album.id,
            title: t.album.title,
            artist: t.artist ? t.artist.name : 'Artista',
            coverXl: t.album.cover_xl || t.album.cover_big || t.album.cover_medium,
            nbTracks: 1,
            releaseDate: 'Colombia Trending',
            link: `https://www.deezer.com/album/${t.album.id}`,
            lucidaUrl: `https://lucida.to/?url=${encodeURIComponent(`https://www.deezer.com/album/${t.album.id}`)}`,
            source: 'deezer'
          });
          if (albums.length >= 6) break;
        }
      }
    }

    if (albums.length === 0) {
      const albQueries = ['Blessd', 'Feid', 'Karol G'];
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
      cachedTopColombia = { tracks, artists, albums };
      cachedTopColombiaTime = now;
    }
    return { tracks, artists, albums };
  } catch (err) {
    console.error('Error al obtener Top Colombia:', err);
    if (cachedTopColombia) return cachedTopColombia;
    return { tracks: [], artists: [], albums: [] };
  }
}

async function getAlbumTracksDeezer(deezerAlbumId) {
  const album = await fetchDeezer(`/album/${deezerAlbumId}`);
  if (!album || album.error) return null;

  // Extraer todos los artistas colaboradores oficiales del álbum (ej: Jory Boy x Bad Bunny)
  let albumArtistName = album.artist ? album.artist.name : 'Artista';
  if (album.contributors && Array.isArray(album.contributors) && album.contributors.length > 0) {
    const mainContributors = album.contributors.map(c => c.name).filter(Boolean);
    if (mainContributors.length > 0) {
      albumArtistName = mainContributors.join(' x ');
    }
  }

  const tracks = (album.tracks && Array.isArray(album.tracks.data))
    ? album.tracks.data.map((t, idx) => {
        let trackArtist = t.artist ? t.artist.name : albumArtistName;
        if (album.contributors && album.contributors.length > 1) {
          trackArtist = albumArtistName;
        }

        return {
          position: t.track_position || idx + 1,
          id: `deezer_${t.id}`,
          title: t.title,
          artist: getFullArtistCredits(trackArtist, t.title),
          duration: t.duration || 0,
          preview: t.preview || null,
          link: t.link || `https://www.deezer.com/track/${t.id}`,
          lucidaUrl: `https://lucida.to/?url=${encodeURIComponent(t.link || `https://www.deezer.com/track/${t.id}`)}`
        };
      })
    : [];

  return {
    id: `deezer_${deezerAlbumId}`,
    deezerId: deezerAlbumId,
    title: album.title || 'Álbum',
    artist: albumArtistName,
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
    artist: getFullArtistCredits(t.artistName || 'Artista', t.trackName),
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
      artist: getFullArtistCredits(t.artistName || albumInfo.artistName || 'Artista', t.trackName),
      duration: Math.round((t.trackTimeMillis || 0) / 1000),
      preview: t.previewUrl || null,
      link: t.trackViewUrl || '',
      lucidaUrl: `https://lucida.to/?url=${encodeURIComponent(t.trackViewUrl || '')}`
    }));

  return {
    id: `itunes_${itunesAlbumId}`,
    itunesId: itunesAlbumId,
    title: albumInfo.collectionName || 'Álbum',
    artist: getFullArtistCredits(albumInfo.artistName || 'Artista', albumInfo.collectionName),
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
      return res.end(JSON.stringify({ version: '8.1.5', status: 'online', engine: 'Vice Music 3D Coverflow + Dual Invidious/VisionOS Native MP3 320 Engine' }));
    }

    // 0.01 TEST YTDL & DEBUG RENDER
    if (pathname === '/api/debug-render') {
      const vid = (reqUrl.searchParams.get('v') || '_RZQcpPViMA').trim();
      const report = {
        platform: process.platform,
        arch: process.arch,
        ffmpegPath,
        ffmpegExists: fs.existsSync(ffmpegPath),
        ffmpegVersion: null,
        ffmpegError: null,
        ytdlInfoFormats: null,
        ytdlDownloadChunks: 0,
        ytdlError: null
      };

      // Test FFmpeg execution
      try {
        await new Promise((resolve) => {
          const ff = spawn(ffmpegPath, ['-version']);
          let out = '';
          ff.stdout.on('data', d => out += d.toString());
          ff.stderr.on('data', d => out += d.toString());
          ff.on('close', code => {
            report.ffmpegVersion = out.split('\n')[0];
            resolve();
          });
          ff.on('error', err => {
            report.ffmpegError = err.message;
            resolve();
          });
          setTimeout(resolve, 3000);
        });
      } catch (ffErr) {
        report.ffmpegError = ffErr.message;
      }

      // Test fetching YouTube player script directly
      try {
        const pRes = await fetch('https://www.youtube.com/s/player/cbcfbf2f/player_ias.vflset/en_US/base.js', {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });
        report.baseJsStatus = pRes.status;
        report.baseJsLength = (await pRes.text()).length;
      } catch (pErr) {
        report.baseJsError = pErr.message;
      }

      // Test Invidious proxy stream (Funciona desde Render / Cloud IPs sin bloqueos)
      try {
        const invRes = await fetch(`https://yt.chocolatemoo53.com/api/v1/videos/${vid}?local=true`, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          signal: AbortSignal.timeout(7000)
        });
        const invData = await invRes.json();
        const bestAudio = invData.adaptiveFormats?.find(f => f.itag === '140' || f.itag === '251' || f.type?.includes('audio'));
        if (bestAudio && bestAudio.url) {
          report.invidiousUrl = bestAudio.url.substring(0, 60);
          const aStreamRes = await fetch(bestAudio.url, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            signal: AbortSignal.timeout(8000)
          });
          report.invidiousStatus = aStreamRes.status;
          report.invidiousType = aStreamRes.headers.get('content-type');
          report.invidiousLength = aStreamRes.headers.get('content-length');
        }
      } catch (inErr) {
        report.invidiousError = inErr.message;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(report, null, 2));
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
          const accessCode = (parsed.accessCode || parsed.code || '').trim();

          if (!username || !password) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, error: 'Ingresa un usuario y contraseña válidos.' }));
          }

          if (accessCode !== '3233') {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, error: 'Código de acceso incorrecto. No tienes permiso para crear una cuenta.' }));
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
        return res.end(JSON.stringify({ success: true, tracks, playlist: tracks }));
      }

      if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          try {
            const parsed = JSON.parse(body || '{}');
            const user = (parsed.user || '').trim();
            if (!user) throw new Error('Usuario requerido');
            
            let tracks = [];
            if (Array.isArray(parsed.tracks)) {
              tracks = addMultipleToPlaylist(user, parsed.tracks, parsed.position || 'end');
            } else if (Array.isArray(parsed.playlist)) {
              tracks = setPlaylist(user, parsed.playlist);
            } else if (parsed.track) {
              tracks = addToPlaylist(user, parsed.track);
            } else {
              throw new Error('Canción o lista requerida');
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: true, tracks, playlist: tracks, message: 'Playlist actualizada con éxito' }));
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
            return res.end(JSON.stringify({ success: true, tracks, playlist: tracks, message: 'Canción eliminada de tu playlist' }));
          } catch (e) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, error: e.message }));
          }
        });
        return;
      }
    }

    // 0.05 TOP 10 COLOMBIA EN VIVO + ARTISTAS TOP MUNDIALES
    if (pathname === '/api/top-colombia') {
      const topData = await getTopColombia();
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      });
      return res.end(JSON.stringify({
        success: true,
        count: (topData.tracks || []).length,
        tracks: topData.tracks || [],
        artists: topData.artists || [],
        albums: topData.albums || [],
        updatedAt: new Date().toISOString()
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

    // 0.15 STREAM DE AUDIO NATIVO CONTINUO (Background Audio / Pantalla Apagada)
    if (pathname === '/api/stream-live') {
      const vId = (reqUrl.searchParams.get('v') || reqUrl.searchParams.get('videoId') || '').trim();
      if (!vId) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        return res.end(JSON.stringify({ error: 'Falta videoId' }));
      }

      try {
        const audioStream = await getAudioStreamForVideo(vId);
        if (!audioStream) {
          res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          return res.end(JSON.stringify({ error: 'Audio stream no disponible' }));
        }

        const ffmpeg = spawn(ffmpegPath, [
          '-i', 'pipe:0',
          '-vn',
          '-c:a', 'libmp3lame',
          '-b:a', '256k',
          '-ar', '44100',
          '-ac', '2',
          '-af', 'volume=1.35',
          '-flush_packets', '1',
          '-f', 'mp3',
          'pipe:1'
        ]);

        ffmpeg.stdin.on('error', () => {});
        audioStream.pipe(ffmpeg.stdin);

        let headersSent = false;
        ffmpeg.stdout.on('data', (chunk) => {
          if (!headersSent) {
            headersSent = true;
            res.writeHead(200, {
              'Content-Type': 'audio/mpeg',
              'Access-Control-Allow-Origin': '*',
              'Cache-Control': 'no-cache, no-store, must-revalidate',
              'Accept-Ranges': 'bytes'
            });
          }
          res.write(chunk);
        });

        req.on('close', () => {
          try { ffmpeg.kill('SIGKILL'); } catch (_) {}
          try { if (audioStream && typeof audioStream.destroy === 'function') audioStream.destroy(); } catch (_) {}
        });

        ffmpeg.stdout.on('end', () => {
          if (!headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ error: 'FFmpeg terminó sin datos' }));
          } else {
            res.end();
          }
        });

        audioStream.on('error', (err) => {
          console.warn('[Stream Live] Error en audioStream:', err.message);
          try { ffmpeg.kill('SIGKILL'); } catch (_) {}
          if (!headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ error: err.message }));
          }
        });
      } catch (err) {
        console.error('[Stream Live] Error:', err.message);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ error: err.message }));
        }
      }
      return;
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
        if (!album || !album.title || !album.artist) return;
        album.artist = getFullArtistCredits(album.artist, album.title);
        const cleanTitle = album.title.toLowerCase().replace(/[\(\[].*?[\)\]]/g, '').replace(/-\s*single/gi, '').trim();

        const existingIdx = combined.findIndex(ex => {
          const exClean = ex.title.toLowerCase().replace(/[\(\[].*?[\)\]]/g, '').replace(/-\s*single/gi, '').trim();
          if (exClean !== cleanTitle) return false;
          const exA = normalizeStr(ex.artist);
          const alA = normalizeStr(album.artist);
          const primaryEx = exA.split(/\s*(?:&|&amp;|,|[xX]|ft\.?|feat\.?|con)\s*/i)[0].trim();
          const primaryAl = alA.split(/\s*(?:&|&amp;|,|[xX]|ft\.?|feat\.?|con)\s*/i)[0].trim();
          return exA.includes(primaryAl) || alA.includes(primaryEx);
        });

        if (existingIdx !== -1) {
          const existing = combined[existingIdx];
          const aHasCollab = album.artist.includes('&') || album.artist.includes('x') || album.artist.includes('feat') || album.artist.includes(',');
          const exHasCollab = existing.artist.includes('&') || existing.artist.includes('x') || existing.artist.includes('feat') || existing.artist.includes(',');
          if (aHasCollab && !exHasCollab) {
            existing.artist = album.artist;
          }
          return;
        }

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

      // Enriquecer créditos de artistas: si iTunes contiene colaboraciones completas del MISMO artista (ej: Jory Boy -> Jory Boy & Bad Bunny), usarlas
      for (const dt of deezerTracks) {
        const normT = normalizeStr(dt.title).replace(/[\(\[].*?[\)\]]/g, '').trim();
        const normDtArtist = normalizeStr(dt.artist);
        const primaryDt = normDtArtist.split(/\s*(?:&|&amp;|,|[xX]|ft\.?|feat\.?|con)\s*/i)[0].trim();

        const it = itunesTracks.find(itCandidate => {
          const normItT = normalizeStr(itCandidate.title).replace(/[\(\[].*?[\)\]]/g, '').trim();
          if (normItT !== normT) return false;
          const normItArtist = normalizeStr(itCandidate.artist);
          const primaryIt = normItArtist.split(/\s*(?:&|&amp;|,|[xX]|ft\.?|feat\.?|con)\s*/i)[0].trim();
          // Solo si coinciden en artista principal (ej: Jory Boy está en Jory Boy & Bad Bunny). NUNCA mezclar artistas distintos (ej: Karol G con Bigknot Records)
          return normItArtist.includes(primaryDt) || normDtArtist.includes(primaryIt);
        });

        if (it && it.artist && (it.artist.includes('&') || it.artist.includes('x') || it.artist.includes('X') || it.artist.includes('feat') || it.artist.includes('ft') || it.artist.includes(','))) {
          dt.artist = it.artist;
        }
      }

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

    // 4. AUDIO COMPLETO VÍA YOUTUBE (Jerarquía Estricta: 1° Audio Oficial -> 2° Letra/Lyrics -> 3° Video Oficial)
    if (pathname === '/api/fullaudio') {
      const q = (reqUrl.searchParams.get('q') || '').trim();
      const artistParam = (reqUrl.searchParams.get('artist') || '').trim();
      const titleParam = (reqUrl.searchParams.get('title') || '').trim();
      const durationParam = Number(reqUrl.searchParams.get('duration') || 0);

      if (!q && !titleParam) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Parámetro vacío' }));
      }

      try {
        const { selected, alternatives, resolvedArtist } = await resolveFullAudio(artistParam, titleParam || q, durationParam);

        if (selected) {
          console.log(`[FullAudio] Seleccionado [Score: ${selected.score}] [${selected.id}] "${selected.title}" (${selected.durStr || 'N/A'}) - Canal: ${selected.channel}`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            videoId: selected.id,
            videoTitle: selected.title,
            tier: selected.score >= 200 ? 'audio_oficial' : (selected.score >= 100 ? 'letra_lyrics' : 'video_oficial'),
            resolvedArtist: resolvedArtist || artistParam,
            alternatives: alternatives.filter(id => id !== selected.id).slice(0, 4)
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
          res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
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
        let altVideoIds = [];

        // Resolver con filtros oficiales estrictos y obtener alternativas para tolerancia anti-bot
        try {
          const durationVal = Number(reqUrl.searchParams.get('duration') || 0);
          const resolved = await resolveFullAudio(artist, title || q, durationVal);
          if (resolved && resolved.selected) {
            if (!targetVideoId) {
              targetVideoId = resolved.selected.id;
            }
            altVideoIds = (resolved.alternatives || []).filter(id => id !== targetVideoId);
          }
        } catch (resErr) {
          console.warn('[Native MP3 Engine] Error en resolveFullAudio:', resErr.message);
        }

        if (!targetVideoId) {
          res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          return res.end(JSON.stringify({ error: 'No se encontró el video en YouTube' }));
        }

        console.log(`[Native MP3 Engine] Generando MP3 320 kbps para "${safeFilename}" (${targetVideoId}, alts: ${altVideoIds.join(', ') || 'ninguna'})...`);

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

        console.log(`[Native MP3 Engine] Extrayendo y transmitiendo audio MP3 320 kbps para "${safeFilename}" (${targetVideoId})...`);

        let audioStream = await getAudioStreamForVideo(targetVideoId, altVideoIds);

        const ffmpeg = spawn(ffmpegPath, [
          '-i', 'pipe:0',
          '-vn',
          '-c:a', 'libmp3lame',
          '-b:a', '320k',
          '-f', 'mp3',
          'pipe:1'
        ]);

        ffmpeg.stdin.on('error', () => {}); // Prevenir crash por EPIPE

        audioStream.pipe(ffmpeg.stdin);

        let headersSent = false;

        ffmpeg.stdout.on('data', (chunk) => {
          if (!headersSent) {
            headersSent = true;
            res.writeHead(200, {
              'Content-Type': 'audio/mpeg',
              'Content-Disposition': `attachment; filename="${safeFilename}.mp3"; filename*=UTF-8''${encodedFilename}.mp3`,
              'Cache-Control': 'no-cache, no-store, must-revalidate',
              'Access-Control-Allow-Origin': '*'
            });
            // Escribir cabecera ID3v2.3 con carátula oficial al principio del archivo
            res.write(tag);
          }
          res.write(chunk);
        });

        req.on('close', () => {
          try { ffmpeg.kill('SIGKILL'); } catch (_) {}
          try { if (audioStream && typeof audioStream.destroy === 'function') audioStream.destroy(); } catch (_) {}
        });

        ffmpeg.stdout.on('end', () => {
          try { ffmpeg.kill(); } catch (_) {}
          if (!headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ error: 'FFmpeg terminó sin datos de audio' }));
          } else {
            res.end();
            console.log(`[Native MP3 Engine] ✅ Descarga transmitida con éxito: "${safeFilename}.mp3"`);
          }
        });

        audioStream.on('error', (aErr) => {
          console.error('[Native MP3 Engine] Error en stream de audio:', aErr.message);
          try { ffmpeg.kill('SIGKILL'); } catch (_) {}
          if (!headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ error: 'Error al obtener audio: ' + aErr.message }));
          } else {
            res.end();
          }
        });

        ffmpeg.on('error', (fErr) => {
          console.error('[Native MP3 Engine] Error en FFmpeg:', fErr.message);
          if (!headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Error en FFmpeg: ' + fErr.message }));
          } else {
            res.end();
          }
        });

        req.on('close', () => {
          try {
            audioStream.destroy();
            ffmpeg.kill('SIGKILL');
          } catch (_) {}
        });

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
