import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';

export function settings(env = process.env) {
  const port = Number(env.PORT || 4318);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT.');
  if (env.MT_LLM_API_KEY && !env.MT_LLM_BASE_URL) throw new Error('Set an explicit MT_LLM_BASE_URL for this key.');
  const base = new URL(env.MT_LLM_BASE_URL || 'http://127.0.0.1:11434/v1');
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname);
  if (base.username || base.password || base.search || base.hash ||
      !(base.protocol === 'https:' || (loopback && base.protocol === 'http:'))) {
    throw new Error('Use an HTTPS model URL, or HTTP on loopback. Supply credentials separately.');
  }
  const defaultDir = process.platform === 'darwin'
    ? join(homedir(), 'Library', 'Application Support', 'microtool', 'mt-support-ops')
    : join(env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'microtool', 'mt-support-ops');
  const dataDir = env.MT_DATA_DIR || defaultDir;
  if (!isAbsolute(dataDir)) throw new Error('MT_DATA_DIR must be an absolute path.');
  return {port, base: base.href.replace(/\/+$/, ''), key: env.MT_LLM_API_KEY || '', dataDir};
}
