import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const nginxConfPath = resolve(__dirname, '..', 'nginx.conf');

const config = readFileSync(nginxConfPath, 'utf8');

if (!/add_header\s+Content-Security-Policy\s+\$csp\s+always;/.test(config)) {
  console.error('La cabecera Content-Security-Policy no está configurada en modo enforce.');
  process.exitCode = 1;
}

if (
  !/"connect-src 'self'\$cdn_connect_src https:\/\/www\.google-analytics\.com https:\/\/region1\.google-analytics\.com https:\/\/www\.googletagmanager\.com; "/.test(
    config,
  )
) {
  console.error('El bloque connect-src endurecido no se encontró en la definición CSP.');
  process.exitCode = 1;
}
