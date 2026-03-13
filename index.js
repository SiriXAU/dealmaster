import { loadConfig } from './src/config.js';
import { startMonitor } from './src/monitor.js';

const config = loadConfig();

console.log('=== dealmaster: OzBargain Discord Monitor ===');
console.log(`Categories : ${config.categories.length ? config.categories.join(', ') : 'ALL'}`);
console.log(`Min votes  : ${config.minVotes}`);
console.log(`Poll every : ${config.pollIntervalMs / 1000}s`);
console.log(`Data dir   : ${config.dataDir}`);
console.log('=============================================');

startMonitor(config);
