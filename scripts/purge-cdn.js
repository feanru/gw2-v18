const fetch = global.fetch || ((...args) => import('node-fetch').then(({default: f}) => f(...args)));

if (process.env.SKIP_PURGE_CDN === '1' || process.env.SKIP_PURGE_CDN === 'true') {
  console.log('Skipping CDN purge');
  process.exit(0);
}

const zone = process.env.CLOUDFLARE_ZONE_ID;
const token = process.env.CLOUDFLARE_TOKEN;

if (!zone || !token) {
  console.error('CLOUDFLARE_ZONE_ID and CLOUDFLARE_TOKEN env vars are required');
  process.exit(1);
}

fetch(`https://api.cloudflare.com/client/v4/zones/${zone}/purge_cache`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify({ purge_everything: true }),
})
  .then((r) => r.json())
  .then((res) => {
    if (!res.success) {
      console.error('CDN purge failed', res.errors);
      process.exit(1);
    }
    console.log('CDN cache purged');
  })
  .catch((err) => {
    console.error('CDN purge failed', err);
    process.exit(1);
  });
