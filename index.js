import { loadConfig } from './src/config.js';
import { loadSettings, saveSettings } from './src/settings.js';
import { startMonitor, startPollLoop, stopPollLoop } from './src/monitor.js';
import { startWebServer } from './src/web.js';

const dataDir      = process.env.DATA_DIR ?? '/data';
const savedSettings = await loadSettings(dataDir);
let activeConfig   = loadConfig(savedSettings);

console.log('=== dealmaster: Deal Notification Tool ===');
console.log(`Categories : ${activeConfig.categories.length ? activeConfig.categories.join(', ') : 'ALL'}`);
console.log(`Min votes  : ${activeConfig.minVotes}`);
console.log(`Poll every : ${activeConfig.pollIntervalMs / 1000}s`);
console.log(`Data dir   : ${activeConfig.dataDir}`);
console.log(`Config src : ${savedSettings ? 'settings.json (web UI)' : 'environment variables'}`);
const webPort = parseInt(process.env.WEB_PORT ?? '8080', 10);
console.log(`Web UI     : http://localhost:${webPort}`);
console.log('=============================================');

process.on('SIGTERM', () => {
  console.log('[dealmaster] Received SIGTERM, shutting down.');
  stopPollLoop();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[dealmaster] Received SIGINT, shutting down.');
  stopPollLoop();
  process.exit(0);
});

let currentSavedAt = savedSettings?.savedAt ?? null;

startWebServer({
  port: webPort,
  getConfig: () => activeConfig,
  getMeta:   () => ({ savedAt: currentSavedAt }),
  onSettingsSaved: async (newSettings) => {
    const saved    = await saveSettings(dataDir, newSettings);
    currentSavedAt = saved.savedAt;
    activeConfig   = loadConfig(saved);
    startPollLoop(activeConfig);
    console.log(`[web] Settings saved — poll loop restarted at ${saved.pollIntervalSeconds}s`);
    return saved;
  },
});

startMonitor(activeConfig);
