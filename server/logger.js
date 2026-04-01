import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
});

export default logger;

/**
 * Create a child logger bound to a module name.
 * Usage: const log = createLogger('scheduler');
 */
export function createLogger(module) {
  return logger.child({ module });
}
