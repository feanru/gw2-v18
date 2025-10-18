<?php
// Simple Redis cache wrapper using phpredis extension
class RedisCacheClient {
    private static $client = null;

    public static function client(): ?Redis {
        if (self::$client === null) {
            if (!class_exists('Redis')) {
                return null;
            }
            $host = getenv('REDIS_HOST') ?: '127.0.0.1';
            $port = getenv('REDIS_PORT') ?: 6379;
            $redis = new Redis();
            try {
                $redis->connect($host, (int)$port, 2.5);
            } catch (RedisException $e) {
                return null;
            }
            self::$client = $redis;
        }
        return self::$client;
    }
}

// Fallback in-memory cache when Redis is not available
$LOCAL_CACHE = [];

function redis_cache_key(string $key): string {
    $ns = getenv('REDIS_NAMESPACE') ?: 'gw2v2:';
    return $ns . preg_replace('/[^A-Za-z0-9_\-\*]/', '_', $key);
}

function redis_get(string $key): ?array {
    $redis = RedisCacheClient::client();
    $cacheKey = redis_cache_key($key);
    if ($redis === null) {
        global $LOCAL_CACHE;
        if (!isset($LOCAL_CACHE[$cacheKey])) {
            return null;
        }
        $entry = $LOCAL_CACHE[$cacheKey];
        if (isset($entry['expires_at']) && $entry['expires_at'] < time()) {
            unset($LOCAL_CACHE[$cacheKey]);
            return null;
        }
        return ['data' => $entry['data'], 'meta' => $entry['meta']];
    }
    $raw = $redis->get($cacheKey);
    if ($raw === false || $raw === null) {
        return null;
    }
    $data = json_decode($raw, true);
    if (!is_array($data)) {
        return null;
    }
    return $data;
}

function redis_set(string $key, $value, int $ttl = 3600, array $meta = []): void {
    $redis = RedisCacheClient::client();
    $cacheKey = redis_cache_key($key);
    if ($redis === null) {
        global $LOCAL_CACHE;
        $LOCAL_CACHE[$cacheKey] = [
            'data' => $value,
            'meta' => $meta,
            'expires_at' => time() + $ttl,
        ];
        return;
    }
    $payload = json_encode([
        'data' => $value,
        'meta' => $meta,
    ]);
    $redis->setex($cacheKey, $ttl, $payload);
}

function redis_invalidate(string $pattern): void {
    $redis = RedisCacheClient::client();
    $prefixed = redis_cache_key($pattern);
    if ($redis === null) {
        global $LOCAL_CACHE;
        foreach (array_keys($LOCAL_CACHE) as $k) {
            if (fnmatch($prefixed, $k)) {
                unset($LOCAL_CACHE[$k]);
            }
        }
        return;
    }
    foreach ($redis->keys($prefixed) as $k) {
        $redis->del($k);
    }
}
?>
