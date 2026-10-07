const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 12_000_000 });
const publicDir = path.join(__dirname, 'public');
const dataDir = process.env.CONTROLOBS_DATA_DIR
  ? path.resolve(process.env.CONTROLOBS_DATA_DIR)
  : path.join(__dirname, 'data');
const statePath = path.join(dataDir, 'controlobs.json');
const emojiPickerDir = path.join(__dirname, 'node_modules', 'emoji-picker-element');
const emojiDataPath = path.join(__dirname, 'node_modules', 'emoji-picker-element-data', 'es', 'cldr', 'data.json');
const mediaDirectories = {
  audio: path.join(publicDir, 'audio'),
  video: path.join(publicDir, 'video'),
  imagen: path.join(publicDir, 'Imagenes')
};
const mediaExtensions = {
  audio: new Set(['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac']),
  video: new Set(['.mp4', '.webm', '.ogv', '.mov', '.m4v']),
  imagen: new Set(['.gif', '.png', '.jpg', '.jpeg', '.webp', '.bmp', '.avif'])
};
const defaultOverlaySize = { width: 1920, height: 1080 };

function detectImageContentType(filePath) {
  const header = Buffer.alloc(12);
  const descriptor = fs.openSync(filePath, 'r');
  try {
    fs.readSync(descriptor, header, 0, header.length, 0);
  } finally {
    fs.closeSync(descriptor);
  }
  if (header.subarray(0, 4).equals(Buffer.from('RIFF')) && header.subarray(8, 12).equals(Buffer.from('WEBP'))) return 'image/webp';
  if (header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (header.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';
  if (header.subarray(0, 6).equals(Buffer.from('GIF87a')) || header.subarray(0, 6).equals(Buffer.from('GIF89a'))) return 'image/gif';
  if (header.subarray(0, 2).equals(Buffer.from('BM'))) return 'image/bmp';
  if (header.subarray(4, 12).includes(Buffer.from('ftypavif'))) return 'image/avif';
  return null;
}

app.use(express.static(publicDir, {
  setHeaders(response, filePath) {
    if (path.basename(filePath) === 'overlay.html') {
      response.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    }
    if (path.dirname(filePath) !== mediaDirectories.imagen) return;
    const contentType = detectImageContentType(filePath);
    if (contentType) response.setHeader('Content-Type', contentType);
  }
}));
app.use('/vendor/emoji-picker-element', express.static(emojiPickerDir));
app.use(express.json({ limit: '12mb' }));

fs.mkdirSync(dataDir, { recursive: true });
Object.values(mediaDirectories).forEach(directory => {
  fs.mkdirSync(directory, { recursive: true });
});

const initialState = {
  gafetes: {
    'gafete-1': {
      id: 'gafete-1',
      nombreGafete: 'Gafete Principal',
      linea1: 'JUAN PÉREZ',
      size1: 28,
      color1: '#ffffff',
      linea2: 'Presentador / Host',
      size2: 16,
      color2: '#a1a1aa',
      tipoIcono: 'emoji',
      emojiIcono: '🎙️',
      usarLogo: true,
      logoUrl: '',
      logoSize: 40,
      logoPos: 'left',
      bgColor: '#0f172a',
      bgAlpha: 85,
      borderColor: '#3b82f6',
      borderWidth: 2,
      borderRadius: '12px',
      fontFamily: 'system-ui, sans-serif',
      posX: 10,
      posY: 80,
      animEntrada: 'slideLeft',
      animSalida: 'slideLeft',
      timerSeconds: 0,
      usarCiclo: false,
      tiempoOculto: 3,
      visibilidadManual: false,
      visibilidad: false
    }
  },
  audios: {},
  videos: {},
  imagenes: {},
  pizarras: {},
  overlaySize: defaultOverlaySize
};

let state = fs.existsSync(statePath)
  ? JSON.parse(fs.readFileSync(statePath, 'utf8'))
  : initialState;

if (!state || typeof state !== 'object' || Array.isArray(state)) {
  throw new Error('La configuración guardada no tiene un formato válido.');
}
state.gafetes = state.gafetes && typeof state.gafetes === 'object' ? state.gafetes : {};
state.audios = state.audios && typeof state.audios === 'object' ? state.audios : {};
state.videos = state.videos && typeof state.videos === 'object' ? state.videos : {};
state.imagenes = state.imagenes && typeof state.imagenes === 'object' ? state.imagenes : {};
state.pizarras = state.pizarras && typeof state.pizarras === 'object' ? state.pizarras : {};
state.overlaySize = normalizeOverlaySize(state.overlaySize);
Object.values(state.gafetes).forEach(badge => {
  badge.visibilidadManual = Boolean(badge.visibilidadManual ?? badge.visibilidad);
  badge.visibilidad = badge.visibilidadManual;
});
Object.values(state.audios).forEach(audio => {
  audio.activo = false;
  audio.gafeteId = audio.gafeteId || null;
});
Object.values(state.videos).forEach(video => {
  video.activo = false;
  video.gafeteId = video.gafeteId || null;
  video.animEntrada = video.animEntrada || 'fadeIn';
  video.animSalida = video.animSalida || 'fadeOut';
});
Object.values(state.imagenes).forEach(image => {
  image.activo = false;
  image.gafeteId = image.gafeteId || null;
  image.audioId = image.audioId || null;
  image.animEntrada = image.animEntrada || 'fadeIn';
  image.animSalida = image.animSalida || 'fadeOut';
});
Object.values(state.pizarras).forEach(board => {
  board.activo = false;
  board.dibujo = typeof board.dibujo === 'string' ? board.dibujo : '';
  board.bordeColor = validHexColor(board.bordeColor) ? board.bordeColor : '#38bdf8';
  board.bordeAncho = clampNumber(board.bordeAncho, 2, 0, 30);
});

let saveTimer = null;

function flushState() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');
}

function persistState() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(flushState, 200);
  saveTimer.unref();
}

process.on('exit', flushState);

function broadcastState() {
  io.emit('sync-gafetes', state.gafetes);
  io.emit('sync-medios', { audios: state.audios, videos: state.videos, imagenes: state.imagenes, pizarras: state.pizarras });
  io.emit('sync-overlay-size', state.overlaySize);
}

function getAvailableFiles(type) {
  if (!mediaDirectories[type]) return [];
  return fs.readdirSync(mediaDirectories[type], { withFileTypes: true })
    .filter(entry => entry.isFile() && mediaExtensions[type].has(path.extname(entry.name).toLowerCase()))
    .map(entry => ({
      nombre: entry.name,
      url: `/${type === 'imagen' ? 'Imagenes' : type}/${encodeURIComponent(entry.name)}`
    }));
}

function findMedia(type, id) {
  return mediaCollection(type)[id];
}

function mediaCollection(type) {
  return type === 'audio' ? state.audios
    : type === 'video' ? state.videos
      : type === 'imagen' ? state.imagenes
        : type === 'pizarra' ? state.pizarras
        : {};
}

function mediaCollectionForState(targetState, type) {
  return type === 'audio' ? targetState.audios
    : type === 'video' ? targetState.videos
      : type === 'imagen' ? targetState.imagenes
        : targetState.pizarras;
}

function allMedia() {
  return [...Object.values(state.audios), ...Object.values(state.videos), ...Object.values(state.imagenes), ...Object.values(state.pizarras)];
}

function isValidPngDataUrl(value) {
  if (typeof value !== 'string' || !value.startsWith('data:image/png;base64,')) return false;
  const encoded = value.slice('data:image/png;base64,'.length);
  if (!encoded || encoded.length > 11_200_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return false;
  const png = Buffer.from(encoded, 'base64');
  return png.length <= 8_000_000
    && png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
}

function updateBadgeVisibility(badgeId) {
  const badge = state.gafetes[badgeId];
  if (!badge) return;
  const mediaIsActive = allMedia()
    .some(media => media.activo && media.gafeteId === badgeId);
  badge.visibilidad = Boolean(badge.visibilidadManual || mediaIsActive);
}

function badgeHasMediaLink(badgeId) {
  return allMedia()
    .some(media => media.gafeteId === badgeId);
}

function setMediaActive(media, active) {
  if (!media) return;
  media.activo = active;
  const linkedImages = mediaCollection('audio')[media.id] === media
    ? Object.values(state.imagenes).filter(image => image.audioId === media.id)
    : [];
  linkedImages.forEach(image => {
    image.activo = active;
  });
  const relatedMedia = [media, ...linkedImages];
  if (mediaCollection('imagen')[media.id] === media && media.audioId) {
    const audio = state.audios[media.audioId];
    if (audio) {
      audio.activo = active;
      relatedMedia.push(audio);
    }
  }
  new Set(relatedMedia.map(item => item.gafeteId).filter(Boolean)).forEach(updateBadgeVisibility);
}

function validMediaType(type) {
  return type === 'audio' || type === 'video' || type === 'imagen';
}

function validStateMediaType(type) {
  return validMediaType(type) || type === 'pizarra';
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function normalizeOverlaySize(size) {
  if (!isRecord(size)) return { ...defaultOverlaySize };
  return {
    width: Math.round(clampNumber(size.width, defaultOverlaySize.width, 320, 3840)),
    height: Math.round(clampNumber(size.height, defaultOverlaySize.height, 240, 2160))
  };
}

function isValidOverlaySize(size) {
  return isRecord(size)
    && Number.isInteger(size.width) && size.width >= 320 && size.width <= 3840
    && Number.isInteger(size.height) && size.height >= 240 && size.height <= 2160;
}

function validHexColor(value) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}

function validAnimation(value, fallback) {
  return ['slideLeft', 'slideRight', 'slideUp', 'bounce', 'zoom', 'fadeIn', 'fadeOut'].includes(value)
    ? value
    : fallback;
}

function makeId(type) {
  let id;
  do {
    id = `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  } while (findMedia(type, id));
  return id;
}

app.get('/api/media/:type', (req, res) => {
  if (!validMediaType(req.params.type)) {
    res.status(404).json({ error: 'Tipo de medio no válido.' });
    return;
  }
  res.json(getAvailableFiles(req.params.type));
});

app.get('/api/emoji-data.json', (req, res) => {
  res.sendFile(emojiDataPath);
});

const cicloTimers = {};

function gestionarCiclo(id) {
  const g = state.gafetes[id];
  if (!g) return;
  if (cicloTimers[id]) clearTimeout(cicloTimers[id]);
  if (badgeHasMediaLink(id)) return;

  if (!g.visibilidadManual && !g.usarCiclo) return;

  if (g.visibilidadManual) {
    if (g.timerSeconds > 0) {
      cicloTimers[id] = setTimeout(() => {
        g.visibilidadManual = false;
        updateBadgeVisibility(id);
        broadcastState();
        persistState();
        if (g.usarCiclo) gestionarCiclo(id);
      }, g.timerSeconds * 1000);
    }
  } else if (g.usarCiclo) {
    cicloTimers[id] = setTimeout(() => {
      g.visibilidadManual = true;
      updateBadgeVisibility(id);
      broadcastState();
      persistState();
      gestionarCiclo(id);
    }, (g.tiempoOculto || 3) * 1000);
  }
}

io.on('connection', socket => {
  socket.emit('sync-gafetes', state.gafetes);
  socket.emit('sync-medios', { audios: state.audios, videos: state.videos, imagenes: state.imagenes, pizarras: state.pizarras });
  socket.emit('sync-overlay-size', state.overlaySize);

  socket.on('guardar-resolucion-overlay', (size, acknowledge) => {
    if (!isValidOverlaySize(size)) {
      if (typeof acknowledge === 'function') acknowledge({ ok: false, error: 'La resolución debe estar entre 320×240 y 3840×2160 píxeles.' });
      return;
    }
    state.overlaySize = { width: size.width, height: size.height };
    broadcastState();
    persistState();
    if (typeof acknowledge === 'function') acknowledge({ ok: true });
  });

  socket.on('guardar-gafete', data => {
    if (!data || typeof data.id !== 'string' || !state.gafetes[data.id]) return;
    const borderWidth = Number(data.borderWidth);
    state.gafetes[data.id] = {
      ...state.gafetes[data.id],
      ...data,
      borderWidth: Number.isFinite(borderWidth)
        ? Math.max(0, Math.min(30, borderWidth))
        : state.gafetes[data.id].borderWidth ?? 2
    };
    broadcastState();
    persistState();
    gestionarCiclo(data.id);
  });

  socket.on('crear-gafete', () => {
    const id = `gafete-${Date.now()}`;
    state.gafetes[id] = {
      id,
      nombreGafete: 'Nuevo Gafete',
      linea1: 'NUEVO TÍTULO',
      size1: 24,
      color1: '#ffffff',
      linea2: 'Subtítulo o Cargo',
      size2: 14,
      color2: '#cccccc',
      tipoIcono: 'emoji',
      emojiIcono: '🧠',
      usarLogo: true,
      logoUrl: '',
      logoSize: 36,
      logoPos: 'left',
      bgColor: '#18181b',
      bgAlpha: 90,
      borderColor: '#10b981',
      borderWidth: 2,
      borderRadius: '12px',
      fontFamily: 'system-ui, sans-serif',
      posX: 10,
      posY: 50,
      animEntrada: 'fadeIn',
      animSalida: 'fadeOut',
      timerSeconds: 0,
      usarCiclo: false,
      tiempoOculto: 3,
      visibilidadManual: false,
      visibilidad: false
    };
    broadcastState();
    persistState();
    socket.emit('elemento-creado', { tipo: 'gafete', id });
  });

  socket.on('eliminar-gafete', id => {
    if (typeof id !== 'string' || !state.gafetes[id]) return;
    if (cicloTimers[id]) clearTimeout(cicloTimers[id]);
    allMedia().forEach(media => {
      if (media.gafeteId === id) media.gafeteId = null;
    });
    delete state.gafetes[id];
    broadcastState();
    persistState();
  });

  socket.on('nueva-configuracion', acknowledge => {
    Object.keys(cicloTimers).forEach(id => {
      clearTimeout(cicloTimers[id]);
      delete cicloTimers[id];
    });
    state = {
      gafetes: {},
      audios: {},
      videos: {},
      imagenes: {},
      pizarras: {},
      overlaySize: { ...defaultOverlaySize }
    };
    broadcastState();
    persistState();
    if (typeof acknowledge === 'function') acknowledge({ ok: true });
  });

  socket.on('importar-configuracion', (config, acknowledge) => {
    const fail = message => {
      if (typeof acknowledge === 'function') acknowledge({ ok: false, error: message });
    };
    if (!isRecord(config) || !isRecord(config.gafetes) || !isRecord(config.audios) || !isRecord(config.videos)
      || (config.imagenes !== undefined && !isRecord(config.imagenes))
      || (config.pizarras !== undefined && !isRecord(config.pizarras))
      || (config.overlaySize !== undefined && !isValidOverlaySize(config.overlaySize))) {
      fail('El JSON debe incluir objetos válidos de gafetes, audios, videos, imágenes y pizarras, y una resolución de overlay válida.');
      return;
    }

    const nextState = {
      gafetes: Object.create(null),
      audios: Object.create(null),
      videos: Object.create(null),
      imagenes: Object.create(null),
      pizarras: Object.create(null),
      overlaySize: config.overlaySize ? { ...config.overlaySize } : { ...defaultOverlaySize }
    };
    const reservedIds = new Set(['__proto__', 'constructor', 'prototype']);
    for (const [id, badge] of Object.entries(config.gafetes)) {
      if (!id || reservedIds.has(id) || !isRecord(badge) || badge.id !== id) {
        fail(`El gafete "${id}" no tiene un identificador válido.`);
        return;
      }
      nextState.gafetes[id] = {
        ...badge,
        visibilidadManual: Boolean(badge.visibilidadManual ?? badge.visibilidad),
        visibilidad: false
      };
    }

    const linkedBadgeIds = new Set();
    const linkedAudioIds = new Set();
    for (const type of ['audio', 'video', 'imagen']) {
      const source = config[type === 'audio' ? 'audios' : type === 'video' ? 'videos' : 'imagenes'] || {};
      const target = mediaCollectionForState(nextState, type);
      const availableFiles = new Set(getAvailableFiles(type).map(file => file.nombre));
      for (const [id, media] of Object.entries(source)) {
        if (!id || reservedIds.has(id) || !isRecord(media) || media.id !== id) {
          fail(`El ${type} "${id}" no tiene un identificador válido.`);
          return;
        }
        if (typeof media.archivo !== 'string' || !availableFiles.has(media.archivo)) {
          fail(`No se encontró el archivo "${media.archivo || ''}" en public/${type}.`);
          return;
        }
        if (media.gafeteId !== undefined && media.gafeteId !== null && typeof media.gafeteId !== 'string') {
          fail(`El vínculo de gafete del ${type} "${media.nombre || id}" no es válido.`);
          return;
        }
        const badgeId = typeof media.gafeteId === 'string' && media.gafeteId ? media.gafeteId : null;
        if (badgeId && !Object.hasOwn(nextState.gafetes, badgeId)) {
          fail(`El ${type} "${media.nombre || id}" está vinculado a un gafete inexistente.`);
          return;
        }
        if (badgeId && linkedBadgeIds.has(badgeId)) {
          fail(`El gafete "${badgeId}" está vinculado a más de un medio.`);
          return;
        }
        if (badgeId) {
          linkedBadgeIds.add(badgeId);
          nextState.gafetes[badgeId].visibilidadManual = false;
        }
        let audioId = null;
        if (type === 'imagen') {
          if (media.audioId !== undefined && media.audioId !== null && typeof media.audioId !== 'string') {
            fail(`El vínculo de audio de la imagen "${media.nombre || id}" no es válido.`);
            return;
          }
          audioId = typeof media.audioId === 'string' && media.audioId ? media.audioId : null;
          if (audioId && !Object.hasOwn(nextState.audios, audioId)) {
            fail(`La imagen "${media.nombre || id}" está vinculada a un audio inexistente.`);
            return;
          }
          if (audioId && linkedAudioIds.has(audioId)) {
            fail(`El audio "${audioId}" está vinculado a más de una imagen.`);
            return;
          }
          if (audioId) linkedAudioIds.add(audioId);
        }
        target[id] = {
          ...media,
          activo: false,
          gafeteId: badgeId,
          ...(type === 'imagen' ? { audioId } : {})
        };
      }
    }

    for (const [id, board] of Object.entries(config.pizarras || {})) {
      if (!id || reservedIds.has(id) || !isRecord(board) || board.id !== id) {
        fail(`La pizarra "${id}" no tiene un identificador válido.`);
        return;
      }
      if (board.dibujo && !isValidPngDataUrl(board.dibujo)) {
        fail(`El dibujo de la pizarra "${board.nombre || id}" no es un PNG válido o supera el tamaño permitido.`);
        return;
      }
      nextState.pizarras[id] = {
        ...board,
        ancho: clampNumber(board.ancho, 640, 40, 1920),
        alto: clampNumber(board.alto, 360, 40, 1080),
        posX: clampNumber(board.posX, 50, 0, 100),
        posY: clampNumber(board.posY, 50, 0, 100),
        fondo: validHexColor(board.fondo) ? board.fondo : '#ffffff',
        fondoAlpha: clampNumber(board.fondoAlpha, 0, 0, 100),
        bordeColor: validHexColor(board.bordeColor) ? board.bordeColor : '#38bdf8',
        bordeAncho: clampNumber(board.bordeAncho, 2, 0, 30),
        dibujo: board.dibujo || '',
        activo: false
      };
    }

    Object.keys(cicloTimers).forEach(id => {
      clearTimeout(cicloTimers[id]);
      delete cicloTimers[id];
    });
    state = nextState;
    Object.keys(state.gafetes).forEach(id => {
      updateBadgeVisibility(id);
      gestionarCiclo(id);
    });
    broadcastState();
    persistState();
    if (typeof acknowledge === 'function') acknowledge({ ok: true });
  });

  socket.on('toggle-visibilidad', id => {
    const badge = state.gafetes[id];
    if (!badge) return;
    if (badgeHasMediaLink(id)) {
      socket.emit('error-control', 'Este gafete está vinculado a un botón de audio o video; se controla desde ese botón.');
      return;
    }
    badge.visibilidadManual = !badge.visibilidadManual;
    updateBadgeVisibility(id);
    broadcastState();
    persistState();
    gestionarCiclo(id);
  });

  socket.on('crear-media', payload => {
    const { tipo, nombreArchivo } = payload && typeof payload === 'object' ? payload : {};
    if (!validMediaType(tipo) || !getAvailableFiles(tipo).some(file => file.nombre === nombreArchivo)) {
      socket.emit('error-control', 'Elegí un archivo disponible en la carpeta correspondiente.');
      return;
    }
    const id = makeId(tipo);
    const media = {
      id,
      nombre: path.parse(nombreArchivo).name,
      archivo: nombreArchivo,
      volumen: 80,
      bucle: false,
      activo: false,
      gafeteId: null
    };
    if (tipo === 'video' || tipo === 'imagen') {
      Object.assign(media, {
        titulo: '',
        tituloPos: 'arriba',
        animEntrada: 'fadeIn',
        animSalida: 'fadeOut',
        posX: 50,
        posY: 50,
        ancho: 320,
        alto: 180,
        forma: 'rectangulo',
        colorBorde: '#3b82f6',
        anchoBorde: 2
      });
    }
    if (tipo === 'imagen') media.audioId = null;
    mediaCollection(tipo)[id] = media;
    broadcastState();
    persistState();
    socket.emit('elemento-creado', { tipo, id });
  });

  socket.on('crear-pizarra', () => {
    const id = makeId('pizarra');
    state.pizarras[id] = {
      id,
      nombre: 'Nueva pizarra',
      activo: false,
      posX: 50,
      posY: 50,
      ancho: 640,
      alto: 360,
      fondo: '#ffffff',
      fondoAlpha: 0,
      bordeColor: '#38bdf8',
      bordeAncho: 2,
      dibujo: ''
    };
    broadcastState();
    persistState();
    socket.emit('elemento-creado', { tipo: 'pizarra', id });
  });

  socket.on('guardar-pizarra', data => {
    if (!data || typeof data.id !== 'string' || !state.pizarras[data.id]) return;
    if (data.dibujo && !isValidPngDataUrl(data.dibujo)) {
      socket.emit('error-control', 'El dibujo debe ser un PNG válido de hasta 8 MB.');
      return;
    }
    const board = state.pizarras[data.id];
    const updated = {
      ...board,
      ...data,
      id: board.id,
      nombre: typeof data.nombre === 'string' ? data.nombre.slice(0, 100) : board.nombre,
      posX: clampNumber(data.posX, board.posX, 0, 100),
      posY: clampNumber(data.posY, board.posY, 0, 100),
      ancho: clampNumber(data.ancho, board.ancho, 40, 1920),
      alto: clampNumber(data.alto, board.alto, 40, 1080),
      fondo: validHexColor(data.fondo) ? data.fondo : board.fondo,
      fondoAlpha: clampNumber(data.fondoAlpha, board.fondoAlpha, 0, 100),
      bordeColor: validHexColor(data.bordeColor) ? data.bordeColor : board.bordeColor || '#38bdf8',
      bordeAncho: clampNumber(data.bordeAncho, board.bordeAncho ?? 2, 0, 30),
      dibujo: typeof data.dibujo === 'string' ? data.dibujo : board.dibujo,
      activo: Boolean(board.activo)
    };
    state.pizarras[data.id] = updated;
    broadcastState();
    persistState();
  });

  socket.on('guardar-media', payload => {
    const { tipo, data } = payload && typeof payload === 'object' ? payload : {};
    if (!validMediaType(tipo) || !data || typeof data.id !== 'string') return;
    const media = findMedia(tipo, data.id);
    if (!media || !getAvailableFiles(tipo).some(file => file.nombre === data.archivo)) {
      socket.emit('error-control', 'No se pudo guardar el medio: el archivo ya no está disponible.');
      return;
    }
    const linkedBadgeId = typeof data.gafeteId === 'string' && state.gafetes[data.gafeteId]
      ? data.gafeteId
      : null;
    const badgeAlreadyLinked = linkedBadgeId && allMedia()
      .some(item => item.id !== media.id && item.gafeteId === linkedBadgeId);
    if (badgeAlreadyLinked) {
      socket.emit('error-control', 'Ese gafete ya está vinculado a otro botón de audio o video.');
      return;
    }

    const volumen = Number(data.volumen);
    const updated = {
      ...media,
      ...data,
      volumen: Number.isFinite(volumen) ? Math.max(0, Math.min(100, volumen)) : media.volumen,
      bucle: Boolean(data.bucle),
      gafeteId: linkedBadgeId
    };
    if (tipo === 'imagen') {
      if (data.audioId !== undefined && data.audioId !== null
        && (typeof data.audioId !== 'string' || data.audioId && !state.audios[data.audioId])) {
        socket.emit('error-control', 'El audio vinculado ya no está disponible.');
        return;
      }
      const audioId = typeof data.audioId === 'string' && data.audioId ? data.audioId : null;
      const audioAlreadyLinked = audioId && Object.values(state.imagenes)
        .some(item => item.id !== media.id && item.audioId === audioId);
      if (audioAlreadyLinked) {
        socket.emit('error-control', 'Ese audio ya está vinculado a otra imagen.');
        return;
      }
      updated.audioId = audioId;
    }
    if (tipo === 'video' || tipo === 'imagen') {
      const numberOr = (value, fallback, min, max) => {
        const number = Number(value);
        return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
      };
      updated.posX = numberOr(data.posX, media.posX, 0, 100);
      updated.posY = numberOr(data.posY, media.posY, 0, 100);
      updated.ancho = numberOr(data.ancho, media.ancho, 40, 1920);
      updated.alto = numberOr(data.alto, media.alto, 40, 1080);
      updated.anchoBorde = numberOr(data.anchoBorde, media.anchoBorde, 0, 30);
      if (!['rectangulo', 'redondeado', 'circulo'].includes(updated.forma)) updated.forma = media.forma;
      if (!['arriba', 'abajo'].includes(updated.tituloPos)) updated.tituloPos = media.tituloPos;
      updated.animEntrada = validAnimation(data.animEntrada, media.animEntrada || 'fadeIn');
      updated.animSalida = validAnimation(data.animSalida, media.animSalida || 'fadeOut');
    }
    const previousBadgeId = media.gafeteId;
    const previousAudioId = tipo === 'imagen' ? media.audioId : null;
    if (tipo === 'imagen' && previousAudioId !== updated.audioId && media.activo) {
      updated.activo = false;
    }
    mediaCollection(tipo)[data.id] = updated;
    if (tipo === 'imagen' && previousAudioId && previousAudioId !== updated.audioId && state.audios[previousAudioId]) {
      setMediaActive(state.audios[previousAudioId], false);
    }
    if (updated.gafeteId) {
      state.gafetes[updated.gafeteId].visibilidadManual = false;
      if (cicloTimers[updated.gafeteId]) clearTimeout(cicloTimers[updated.gafeteId]);
    }
    if (previousBadgeId) updateBadgeVisibility(previousBadgeId);
    if (updated.gafeteId) updateBadgeVisibility(updated.gafeteId);
    if (previousBadgeId) gestionarCiclo(previousBadgeId);
    if (updated.gafeteId) gestionarCiclo(updated.gafeteId);
    broadcastState();
    persistState();
  });

  socket.on('eliminar-media', payload => {
    const { tipo, id } = payload && typeof payload === 'object' ? payload : {};
    if (!validStateMediaType(tipo) || typeof id !== 'string') return;
    const collection = mediaCollection(tipo);
    if (!collection[id]) return;
    const media = collection[id];
    const badgeId = media.gafeteId;
    const audioId = tipo === 'imagen' ? media.audioId : null;
    const linkedImages = tipo === 'audio'
      ? Object.values(state.imagenes).filter(image => image.audioId === id)
      : [];
    delete collection[id];
    if (audioId && state.audios[audioId]) setMediaActive(state.audios[audioId], false);
    if (tipo === 'audio') {
      linkedImages.forEach(image => {
        image.audioId = null;
        image.activo = false;
        if (image.gafeteId) {
          updateBadgeVisibility(image.gafeteId);
          gestionarCiclo(image.gafeteId);
        }
      });
    }
    if (badgeId) {
      updateBadgeVisibility(badgeId);
      gestionarCiclo(badgeId);
    }
    broadcastState();
    persistState();
  });

  socket.on('toggle-media', payload => {
    const { tipo, id } = payload && typeof payload === 'object' ? payload : {};
    const media = validStateMediaType(tipo) ? findMedia(tipo, id) : null;
    if (!media) return;
    setMediaActive(media, !media.activo);
    broadcastState();
    persistState();
  });

  socket.on('media-ended', payload => {
    const { tipo, id } = payload && typeof payload === 'object' ? payload : {};
    const media = validMediaType(tipo) ? findMedia(tipo, id) : null;
    if (!media || media.bucle || !media.activo) return;
    setMediaActive(media, false);
    broadcastState();
    persistState();
  });

  socket.on('media-error', payload => {
    const { tipo, id, message } = payload && typeof payload === 'object' ? payload : {};
    if (!validMediaType(tipo) || typeof id !== 'string') return;
    const media = findMedia(tipo, id);
    if (media) {
      setMediaActive(media, false);
      broadcastState();
      persistState();
    }
    io.emit('media-error', {
      tipo,
      id,
      message: typeof message === 'string' ? message.slice(0, 200) : 'No se pudo reproducir el archivo.'
    });
  });
});

if (!fs.existsSync(statePath)) flushState();

const port = Number(process.env.PORT) || 3000;
server.listen(port, () => {
  console.log(`Servidor activo en http://localhost:${port}`);
});
