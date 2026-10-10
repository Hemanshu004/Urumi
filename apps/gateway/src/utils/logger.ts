export const logger = {
  info: (msg: string, meta?: Record<string, any>) => {
    console.log(JSON.stringify({ level: 'info', ts: new Date().toISOString(), msg, ...meta }));
  },
  warn: (msg: string, meta?: Record<string, any>) => {
    console.warn(JSON.stringify({ level: 'warn', ts: new Date().toISOString(), msg, ...meta }));
  },
  error: (msg: string, meta?: Record<string, any>) => {
    console.error(JSON.stringify({ level: 'error', ts: new Date().toISOString(), msg, ...meta }));
  }
};
