import { createLogger } from './src/logger.js';
import { loadConfig } from './src/config.js';
import { loadSettings, saveSettings } from './src/settings.js';
import { startMonitor, startPollLoop, stopPollLoop, getLastPollTime } from './src/monitor.js';
import { startWebServer } from './src/web.js';
import { loadHistory } from './src/history.js';

const log = createLogger('dealmaster');

const dataDir      = process.env.DATA_DIR ?? '/data';
const savedSettings = await loadSettings(dataDir);
let activeConfig   = loadConfig(savedSettings);

const _gs = activeConfig.gamingSources;
const _gsActive = [
  _gs.gamerpower      && 'GamerPower',
  _gs.gamerpowerGames && 'GamerPower·Games',
  _gs.gamerpowerLoot  && 'GamerPower·Loot',
  _gs.epicbundle      && 'EpicBundle',
].filter(Boolean);

log.info('=== dealmaster: Deal Notification Tool ===');
log.info(`Categories : ${activeConfig.categories.length ? activeConfig.categories.join(', ') : 'ALL'}`);
log.info(`Min votes  : ${activeConfig.minVotes}`);
log.info(`Poll every : ${activeConfig.pollIntervalMs / 1000}s`);
log.info(`Gaming srcs: ${_gsActive.length ? _gsActive.join(', ') : 'disabled'}`);
log.info(`Data dir   : ${activeConfig.dataDir}`);
log.info(`Config src : ${savedSettings ? 'settings.json (web UI)' : 'environment variables'}`);
const webPort = parseInt(process.env.WEB_PORT ?? '8080', 10);
log.info(`Web UI     : http://localhost:${webPort}`);
log.info('=============================================');

process.on('SIGTERM', () => {
  log.info('Received SIGTERM, shutting down.');
  stopPollLoop();
  process.exit(0);
});

process.on('SIGINT', () => {
  log.info('Received SIGINT, shutting down.');
  stopPollLoop();
  process.exit(0);
});

let currentSavedAt = savedSettings?.savedAt ?? null;

startWebServer({
  port: webPort,
  getConfig: () => activeConfig,
  getMeta:   () => ({ savedAt: currentSavedAt }),
  getLastPollTime,
  getHistory: () => loadHistory(dataDir),
  onSettingsSaved: async (newSettings) => {
    const saved    = await saveSettings(dataDir, newSettings);
    currentSavedAt = saved.savedAt;
    activeConfig   = loadConfig(saved);
    startPollLoop(activeConfig);
    log.info(`Settings saved — poll loop restarted at ${saved.pollIntervalSeconds}s`);
    return saved;
  },
});

startMonitor(activeConfig);
