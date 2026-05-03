const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const LEVEL_NAMES = ['DEBUG', 'INFO', 'WARN', 'ERROR'];

const threshold = LEVELS[process.env.LOG_LEVEL?.toLowerCase()] ?? LEVELS.info;

function format(level, module, msg) {
  const ts = new Date().toISOString();
  return `${ts} [${LEVEL_NAMES[level]}] [${module}] ${msg}`;
}

export function createLogger(module) {
  return {
    debug(msg) { if (threshold <= 0) console.debug(format(0, module, msg)); },
    info(msg)  { if (threshold <= 1) console.info(format(1, module, msg)); },
    warn(msg)  { if (threshold <= 2) console.warn(format(2, module, msg)); },
    error(msg) { if (threshold <= 3) console.error(format(3, module, msg)); },
  };
}
