const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let gafetes = {
  'gafete-1': {
    id: 'gafete-1',
    nombreGafete: 'Gafete Principal',
    linea1: 'JUAN PÉREZ',
    size1: 28,
    color1: '#ffffff',
    linea2: 'Presentador / Host',
    size2: 16,
    color2: '#a1a1aa',
    tipoIcono: 'emoji', // 'emoji' o 'imagen'
    emojiIcono: '🎙️',
    usarLogo: true,
    logoUrl: '',
    logoSize: 40,
    logoPos: 'left',
    // Estilos visuales
    bgColor: '#0f172a',
    bgAlpha: 85,
    borderColor: '#3b82f6',
    borderRadius: '12px',
    fontFamily: 'system-ui, sans-serif',
    // Animación y posición
    posX: 10,
    posY: 80,
    animEntrada: 'slideLeft',
    animSalida: 'slideLeft',
    timerSeconds: 0, // 0 = Fijo en pantalla (se oculta manualmente)
    usarCiclo: false,
    tiempoOculto: 3,
    visibilidad: false
  }
};

const cicloTimers = {};

function gestionarCiclo(id) {
  const g = gafetes[id];
  if (cicloTimers[id]) clearTimeout(cicloTimers[id]);

  if (!g.visibilidad && !g.usarCiclo) return;

  if (g.visibilidad) {
    // Si timerSeconds es mayor a 0, se oculta automáticamente tras T1
    if (g.timerSeconds > 0) {
      const t1 = g.timerSeconds * 1000;
      cicloTimers[id] = setTimeout(() => {
        g.visibilidad = false;
        io.emit('sync-gafetes', gafetes);

        if (g.usarCiclo) {
          gestionarCiclo(id);
        }
      }, t1);
    }
  } else if (g.usarCiclo) {
    // Si está oculto pero tiene ciclo activo, reaparece tras T2
    const t2 = (g.tiempoOculto || 3) * 1000;
    cicloTimers[id] = setTimeout(() => {
      g.visibilidad = true;
      io.emit('sync-gafetes', gafetes);
      gestionarCiclo(id);
    }, t2);
  }
}

io.on('connection', (socket) => {
  socket.emit('sync-gafetes', gafetes);

  socket.on('guardar-gafete', (data) => {
    if (gafetes[data.id]) {
      gafetes[data.id] = { ...gafetes[data.id], ...data };
      io.emit('sync-gafetes', gafetes);
      gestionarCiclo(data.id);
    }
  });

  socket.on('crear-gafete', () => {
    const id = 'gafete-' + Date.now();
    gafetes[id] = {
      id: id,
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
      borderRadius: '12px',
      fontFamily: 'system-ui, sans-serif',
      posX: 10,
      posY: 50,
      animEntrada: 'fadeIn',
      animSalida: 'fadeOut',
      timerSeconds: 0,
      usarCiclo: false,
      tiempoOculto: 3,
      visibilidad: false
    };
    io.emit('sync-gafetes', gafetes);
  });

  socket.on('eliminar-gafete', (id) => {
    if (cicloTimers[id]) clearTimeout(cicloTimers[id]);
    delete gafetes[id];
    io.emit('sync-gafetes', gafetes);
  });

  socket.on('toggle-visibilidad', (id) => {
    if (gafetes[id]) {
      gafetes[id].visibilidad = !gafetes[id].visibilidad;
      io.emit('sync-gafetes', gafetes);
      gestionarCiclo(id);
    }
  });
});

server.listen(3000, () => {
  console.log('Servidor activo en http://localhost:3000');
});