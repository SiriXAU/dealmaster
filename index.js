import { loadConfig } from './src/config.js';
import { startMonitor } from './src/monitor.js';

const config = loadConfig();

console.log('=== dealmaster: Deal Notification Tool ===');
console.log(`Categories : ${config.categories.length ? config.categories.join(', ') : 'ALL'}`);
console.log(`Min votes  : ${config.minVotes}`);
console.log(`Poll every : ${config.pollIntervalMs / 1000}s`);
console.log(`Data dir   : ${config.dataDir}`);
console.log('=============================================');

process.on('SIGTERM', () => {
  console.log('[dealmaster] Received SIGTERM, shutting down.');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[dealmaster] Received SIGINT, shutting down.');
  process.exit(0);
});

startMonitor(config);
