'use strict';

const fs = require('fs');
const path = require('path');

/**
 * 读取项目根目录的 .env 文件（无第三方依赖）。
 * 已存在于 process.env 的变量优先，便于命令行临时覆盖。
 */
function loadEnv(file = path.join(__dirname, '..', '.env')) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return false;
  }

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    if (!key || key in process.env) continue;

    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }

  return true;
}

module.exports = { loadEnv };
