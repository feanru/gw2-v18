<?php
require_once __DIR__.'/cache.php';
require_once __DIR__.'/redis_cache.php';

class CacheKey {
    /**
     * @param array<int|string> $ids
     * @return int[]
     */
    public static function normalizeIds(array $ids): array {
        $normalized = [];
        foreach ($ids as $id) {
            if (is_numeric($id)) {
                $normalized[] = (int)$id;
            }
        }
        if (count($normalized) === 0) {
            return [];
        }
        $normalized = array_values(array_unique($normalized));
        sort($normalized, SORT_NUMERIC);
        return $normalized;
    }

    /**
     * @param array<int|string> $ids
     */
    public static function forMulti(string $prefix, array $ids): string {
        $normalized = self::normalizeIds($ids);
        if (count($normalized) === 0) {
            return $prefix . '_multi';
        }
        return $prefix . '_multi_' . implode('_', $normalized);
    }

    public static function normalize(string $key): string {
        if (strpos($key, ',') === false && strpos($key, '_multi_') === false) {
            return $key;
        }

        $prefix = null;
        $idPart = null;
        $hasMultiSuffix = false;

        if (strpos($key, '_multi_') !== false) {
            [$prefix, $idPart] = explode('_multi_', $key, 2);
            $hasMultiSuffix = true;
        } else {
            $lastUnderscore = strrpos($key, '_');
            if ($lastUnderscore === false) {
                return $key;
            }
            $prefix = substr($key, 0, $lastUnderscore);
            $idPart = substr($key, $lastUnderscore + 1);
        }

        if ($prefix === null || $idPart === null) {
            return $key;
        }

        $trimmed = trim($idPart, '_');
        if ($trimmed === '') {
            return $key;
        }

        $parts = preg_split('/[,_]/', $trimmed);
        if ($parts === false) {
            return $key;
        }

        $ids = [];
        foreach ($parts as $part) {
            if ($part === '') {
                continue;
            }
            if (!is_numeric($part)) {
                return $key;
            }
            $ids[] = (int)$part;
        }

        if (count($ids) <= 1) {
            if ($hasMultiSuffix && count($ids) === 1) {
                return $prefix . '_multi_' . $ids[0];
            }
            return $key;
        }

        $ids = array_values(array_unique($ids));
        sort($ids, SORT_NUMERIC);
        return $prefix . '_multi_' . implode('_', $ids);
    }

    public static function normalizePattern(string $pattern): string {
        if (strpos($pattern, '*') === false) {
            return self::normalize($pattern);
        }
        if (strpos($pattern, ',') === false) {
            return $pattern;
        }

        $starPos = strpos($pattern, '*');
        if ($starPos === false) {
            return self::normalize($pattern);
        }

        $prefix = substr($pattern, 0, $starPos);
        $suffix = substr($pattern, $starPos);

        $trailingUnderscore = false;
        if ($prefix !== '' && substr($prefix, -1) === '_') {
            $trailingUnderscore = true;
            $prefix = substr($prefix, 0, -1);
        }

        $normalizedPrefix = self::normalize($prefix);
        if ($trailingUnderscore) {
            $normalizedPrefix .= '_';
        }

        return $normalizedPrefix . $suffix;
    }

    /**
     * @return string[]
     */
    public static function patternsForId(string $prefix, int $id): array {
        $id = (int)$id;
        return [
            sprintf('%s_multi_%d', $prefix, $id),
            sprintf('%s_multi_%d_*', $prefix, $id),
            sprintf('%s_multi_*_%d_*', $prefix, $id),
            sprintf('%s_multi_*_%d', $prefix, $id),
        ];
    }
}

class CacheUtils {
    private static $useRedis = null;

    private static function useRedis(): bool {
        if (self::$useRedis === null) {
            self::$useRedis = RedisCacheClient::client() !== null;
        }
        return self::$useRedis;
    }

    public static function get(string $key): ?array {
        $key = CacheKey::normalize($key);
        return self::useRedis() ? redis_get($key) : cache_get($key);
    }

    public static function set(string $key, $value, int $ttl = 3600, array $meta = []): void {
        $key = CacheKey::normalize($key);
        if (self::useRedis()) {
            redis_set($key, $value, $ttl, $meta);
        } else {
            cache_set($key, $value, $ttl, $meta);
        }
    }

    public static function invalidate(string $pattern): void {
        $pattern = CacheKey::normalizePattern($pattern);
        if (self::useRedis()) {
            redis_invalidate($pattern);
        } else {
            cache_invalidate($pattern);
        }
    }

    public static function invalidateMulti(string $prefix, int $id): void {
        foreach (CacheKey::patternsForId($prefix, $id) as $pattern) {
            self::invalidate($pattern);
        }
    }
}
?>
