const { app, BrowserWindow, dialog } = require('electron');
const fs = require('fs');
const path = require('path');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let server;
  let serverStarted = false;
  let isStopping = false;
  let mainWindow;

  function copyMissingFiles(source, destination) {
    if (!fs.existsSync(source)) return;
    fs.mkdirSync(destination, { recursive: true });
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
      const sourcePath = path.join(source, entry.name);
      const destinationPath = path.join(destination, entry.name);
      if (entry.isDirectory()) {
        copyMissingFiles(sourcePath, destinationPath);
      } else if (entry.isFile() && !fs.existsSync(destinationPath)) {
        fs.copyFileSync(sourcePath, destinationPath);
      }
    }
  }

  function prepareUserFiles() {
    const userDirectory = path.join(app.getPath('documents'), 'ControlOBS');
    const dataDirectory = path.join(userDirectory, 'data');
    const mediaDirectory = userDirectory;
    const bundledDirectory = app.getAppPath();
    const savedConfiguration = path.join(dataDirectory, 'controlobs.json');
    const previousConfiguration = path.join(bundledDirectory, 'data', 'controlobs.json');

    fs.mkdirSync(dataDirectory, { recursive: true });
    if (!fs.existsSync(savedConfiguration) && fs.existsSync(previousConfiguration)) {
      fs.copyFileSync(previousConfiguration, savedConfiguration);
    }

    for (const directory of ['audio', 'video', 'Imagenes']) {
      copyMissingFiles(
        path.join(bundledDirectory, 'public', directory),
        path.join(mediaDirectory, directory)
      );
    }

    process.env.CONTROLOBS_DATA_DIR = dataDirectory;
    process.env.CONTROLOBS_MEDIA_DIR = mediaDirectory;
  }

  async function createMainWindow() {
    const address = await server.startServer({ port: 3000, host: '127.0.0.1' });
    serverStarted = true;
    mainWindow = new BrowserWindow({
      width: 1280,
      height: 900,
      minWidth: 900,
      minHeight: 650,
      show: false,
      autoHideMenuBar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false
      }
    });
    mainWindow.once('ready-to-show', () => mainWindow.show());
    await mainWindow.loadURL(`http://127.0.0.1:${address.port}/control.html`);
  }

  app.whenReady().then(async () => {
    try {
      prepareUserFiles();
      server = require('../server');
      await createMainWindow();
    } catch (error) {
      const message = error.code === 'EADDRINUSE'
        ? 'El puerto 3000 ya está en uso. Cerrá la otra instancia de ControlOBS o la aplicación que lo esté usando y volvé a intentar.'
        : `No se pudo iniciar ControlOBS: ${error.message}`;
      dialog.showErrorBox('ControlOBS', message);
      app.quit();
    }
  });

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.on('before-quit', event => {
    if (!serverStarted || isStopping) return;
    event.preventDefault();
    isStopping = true;
    server.stopServer(() => {
      serverStarted = false;
      app.quit();
    });
  });
}
