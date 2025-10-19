#!/usr/bin/env node
import { argv, exit } from 'node:process';
import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'node:zlib';
import fetch from 'node-fetch';

function printUsage() {
  console.log('Uso: node scripts/measure-payloads.mjs --url <endpoint> [--url <endpoint>] [--base <http://host:puerto>]');
}

function parseArgs(args) {
  const result = { base: 'http://127.0.0.1:3300', urls: [] };
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token === '--url' || token === '-u') {
      const value = args[i + 1];
      if (!value) {
        console.error('Falta el valor para --url');
        exit(1);
      }
      result.urls.push(value);
      i += 1;
    } else if (token === '--base') {
      const value = args[i + 1];
      if (!value) {
        console.error('Falta el valor para --base');
        exit(1);
      }
      result.base = value;
      i += 1;
    } else if (token === '--help' || token === '-h') {
      printUsage();
      exit(0);
    }
  }
  return result;
}

function resolveUrl(base, input) {
  try {
    return new URL(input, base).toString();
  } catch (err) {
    throw new Error(`URL inválida: ${input}`);
  }
}

function compressGzip(buffer) {
  try {
    return gzipSync(buffer, { level: 9 }).length;
  } catch (err) {
    console.warn('Error comprimiendo con gzip', err);
    return null;
  }
}

function compressBrotli(buffer) {
  try {
    return brotliCompressSync(buffer, {
      params: {
        [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
      },
    }).length;
  } catch (err) {
    console.warn('Error comprimiendo con brotli', err);
    return null;
  }
}

async function measureUrl(url) {
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const rawSize = buffer.length;
  const gzipSize = compressGzip(buffer);
  const brotliSize = compressBrotli(buffer);
  return {
    status: response.status,
    rawSize,
    gzipSize,
    brotliSize,
  };
}

async function main() {
  const args = parseArgs(argv.slice(2));
  if (args.urls.length === 0) {
    printUsage();
    exit(1);
  }

  const results = [];
  for (const url of args.urls) {
    const fullUrl = resolveUrl(args.base, url);
    try {
      const measurement = await measureUrl(fullUrl);
      results.push({ url: fullUrl, ...measurement });
    } catch (err) {
      results.push({ url: fullUrl, error: err.message || String(err) });
    }
  }

  const header = ['URL', 'Estado', 'Bytes', 'Gzip', 'Brotli'];
  console.log(header.join('\t'));
  results.forEach((result) => {
    if (result.error) {
      console.log(`${result.url}\tERROR\t${result.error}`);
      return;
    }
    console.log(
      `${result.url}\t${result.status}\t${result.rawSize}\t${result.gzipSize ?? '-'}\t${result.brotliSize ?? '-'}`,
    );
  });
}

main().catch((err) => {
  console.error(err);
  exit(1);
});
