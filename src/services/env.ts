// ============================================
// 环境变量加载工具
//
// 从 .env 文件加载环境变量到 process.env
// 供所有入口文件共用 (index.ts / local-runner.ts / 等)
// ============================================

import * as fs from 'fs';
import * as path from 'path';

/**
 * 加载 .env 文件到 process.env
 * 已存在的环境变量不会被覆盖
 */
export function loadEnv(): void {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) {
    console.warn('[Env] .env file not found, skipping');
    return;
  }

  const content = fs.readFileSync(envPath, 'utf-8');
  let loaded = 0;

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex <= 0) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const val = trimmed.slice(eqIndex + 1).trim();
    if (!process.env[key]) {
      process.env[key] = val;
      loaded++;
    }
  }

  if (loaded > 0) {
    console.log(`[Env] .env loaded (${loaded} variables)`);
  }
}
