const { app, BrowserWindow, Menu, ipcMain, globalShortcut } = require('electron')
const isDevMode = require('electron-is-dev')
const { CapacitorSplashScreen, configCapacitor } = require('@capacitor/electron')

const childProcess = require('child_process')
const path = require('path')

// Place holders for our windows so they don't get garbage collected.
let mainWindow = null

// Placeholder for SplashScreen ref
let splashScreen = null

// Change this if you do not wish to have a splash screen
let useSplashScreen = false

// Create simple menu for easy devtools access, and for demo
const menuTemplate = [{ role: 'appMenu', submenu: [{ role: 'quit' }] }, { role: 'window', submenu: [{ role: 'minimize' }] }]
const menuTemplateDev = [
  {
    role: 'appMenu',
    submenu: [{ role: 'toggleDevTools' }, { role: 'quit' }]
  },
  { role: 'window', submenu: [{ role: 'minimize' }] }
]

async function createWindow() {
  // Define our main window size
  mainWindow = new BrowserWindow({
    height: 920,
    width: 1600,
    show: false,
    icon: path.join(__dirname, 'resources', 'icons', 'icon.png'),
    webPreferences: {
      nodeIntegration: true,
      preload: path.join(__dirname, 'node_modules', '@capacitor', 'electron', 'dist', 'electron-bridge.js')
    }
  })

  configCapacitor(mainWindow)

  if (isDevMode) {
    // Set our above template to the Menu Object if we are in development mode, dont want users having the devtools.
    Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplateDev))
    // If we are developers we might as well open the devtools by default.
    mainWindow.webContents.openDevTools()
  }

  if (useSplashScreen) {
    splashScreen = new CapacitorSplashScreen(mainWindow, {})
    splashScreen.init(false)
  } else {
    mainWindow.loadURL(`file://${__dirname}/app/index.html`)
    mainWindow.webContents.on('dom-ready', () => {
      mainWindow.show()
    })
  }

  if (!isDevMode) {
    Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate))
  }

  mainWindow.on('focus', () => {
    globalShortcut.registerAll(['CommandOrControl+R', 'CommandOrControl+Shift+R', 'F5'], () => {})
  })

  mainWindow.on('blur', () => {
    globalShortcut.unregisterAll()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some Electron APIs can only be used after this event occurs.
app.on('ready', createWindow)

// Quit when all windows are closed.
app.on('window-all-closed', function() {
  // On OS X it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== 'darwin') {
    for (const [_, child] of childProcesses) {
      child.kill()
    }

    app.quit()
  }
})

app.on('activate', function() {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (mainWindow === null) {
    createWindow()
  }
})

// Define any IPC or other custom functionality below here
const processPaths = new Map([['ledger', path.join(__dirname, 'ledger-transport.js')]])

const childProcesses = new Map()
const callbacks = new Map()

ipcMain.on('spawn-process', function(event, requestId, name) {
  const child = childProcesses.get(name)
  const reply = child ? child.pid : spawnProcess(name)

  event.reply('spawn-process-reply', requestId, reply)
})

ipcMain.on('send-to-child', function(event, requestId, name, type, data) {
  const child = childProcesses.get(name)
  if (!child) {
    event.reply('send-to-child-reply', requestId, { error: 'Process is not running.' })
  } else {
    callbacks.set(requestId, message => {
      event.reply('send-to-child-reply', message.requestId, message.data)
    })

    child.send({
      requestId,
      type,
      data
    })
  }
})

function spawnProcess(name) {
  const params = []
  const options = {
    stdio: ['inherit', 'inherit', 'inherit', 'ipc']
  }

  const path = processPaths.get(name)

  if (path) {
    const child = childProcess.fork(path, params, options)
    child.on('message', message => {
      const callback = callbacks.get(message.requestId)

      if (callback) {
        callback(message)
        callbacks.delete(message.requestId)
      }
    })

    childProcesses.set(name, child)

    return child.pid
  } else {
    return { error: 'Unknown process name.' }
  }
}
