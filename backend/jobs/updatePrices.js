const { MongoClient } = require('mongodb');
const fetch = (...args) => import('node-fetch').then(({ default: fetchFn }) => fetchFn(...args));
const { log } = require('./logger');
const { getLastSync, setLastSync, recordFailure } = require('./syncStatus');

const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017/gw2';
const API_URL = process.env.MARKET_CSV_URL || 'https://api.datawars2.ie/gw2/v1/items/csv';
const DEFAULT_LANG = (process.env.DEFAULT_LANG || 'es').trim() || 'es';
const PRICE_FIELDS = process.env.PRICE_FIELDS || 'id,buy_price,sell_price';

function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result.map(value => value.trim());
}

function parsePriceCsv(csv) {
  if (!csv) {
    return [];
  }
  const lines = csv
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0);
  if (lines.length < 2) {
    return [];
  }
  const headers = parseCsvLine(lines[0]);
  const records = [];
  for (let i = 1; i < lines.length; i += 1) {
    const values = parseCsvLine(lines[i]);
    if (values.length === 0) {
      continue;
    }
    const row = {};
    headers.forEach((header, index) => {
      const raw = values[index] ?? '';
      if (raw === '') {
        row[header] = null;
        return;
      }
      if (!Number.isNaN(Number(raw)) && raw !== '') {
        row[header] = raw.includes('.') ? Number.parseFloat(raw) : Number.parseInt(raw, 10);
      } else {
        row[header] = raw;
      }
    });
    records.push(row);
  }
  return records;
}

async function fetchPrices() {
  const idsParam = process.env.PRICE_IDS || 'all';
  const url = new URL(API_URL);
  if (idsParam) {
    url.searchParams.set('ids', idsParam);
  }
  if (PRICE_FIELDS) {
    url.searchParams.set('fields', PRICE_FIELDS);
  }
  const response = await fetch(url.href);
  if (!response.ok) {
    throw new Error(`Failed to fetch prices: ${response.status}`);
  }
  const text = await response.text();
  return parsePriceCsv(text);
}

async function updatePrices() {
  const mongo = new MongoClient(MONGO_URL);

  await mongo.connect();

  try {
    log('[prices] job started');
    if (process.env.DRY_RUN) {
      log('[prices] DRY_RUN active - skipping fetch');
      await setLastSync(mongo, 'prices');
      return;
    }

    const lastSync = await getLastSync(mongo, 'prices');
    if (lastSync) {
      log(`[prices] last sync ${lastSync.toISOString()}`);
    }

    const prices = await fetchPrices();
    const collection = mongo.db().collection('prices');
    const timestamp = new Date();

    const operations = [];
    for (const price of prices) {
      if (!price || typeof price.id === 'undefined' || price.id === null) {
        continue;
      }
      const numericId = Number(price.id);
      const document = {
        ...price,
        id: Number.isNaN(numericId) ? price.id : numericId,
        lang: DEFAULT_LANG,
        source: 'external',
        lastUpdated: new Date(timestamp),
      };
      operations.push({
        updateOne: {
          filter: { id: document.id },
          update: { $set: document },
          upsert: true,
        },
      });
    }

    if (operations.length > 0) {
      await collection.bulkWrite(operations, { ordered: false });
    }

    await setLastSync(mongo, 'prices', timestamp);
    log(`[prices] upserted ${operations.length} documents`);
  } catch (error) {
    log(`[prices] error: ${error.message}`);
    try {
      await recordFailure(mongo, 'prices', error);
    } catch (recordErr) {
      log(`[prices] failed to record failure: ${recordErr.message}`);
    }
    throw error;
  } finally {
    await mongo.close();
    log('[prices] job finished');
  }
}

module.exports = updatePrices;

if (require.main === module) {
  updatePrices().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
