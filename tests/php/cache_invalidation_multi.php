<?php
require_once __DIR__ . '/../../backend/cacheUtils.php';

function clean_cache_dir(): void {
    $dir = __DIR__ . '/../../backend/cache';
    if (!is_dir($dir)) {
        return;
    }
    foreach (glob($dir . '/*.json') as $file) {
        @unlink($file);
    }
}

function assert_true(bool $condition, string $message): void {
    if (!$condition) {
        fwrite(STDERR, $message . "\n");
        exit(1);
    }
}

clean_cache_dir();

// Ensure multi keys are normalized regardless of order or separator.
$legacyKey = 'items_9,1';
CacheUtils::set($legacyKey, 'legacy', 60);
assert_true(CacheUtils::get(CacheKey::forMulti('items', [1, 9])) !== null, 'Failed to normalize legacy multi cache key.');

// Create multiple cached entries that should be invalidated selectively.
$firstKey = CacheKey::forMulti('items', [1, 5]);
CacheUtils::set($firstKey, 'primary', 60);
$secondKey = CacheKey::forMulti('items', [2, 3]);
CacheUtils::set($secondKey, 'secondary', 60);

assert_true(CacheUtils::get(CacheKey::forMulti('items', [5, 1])) !== null, 'Canonical lookup failed for primary multi cache.');
assert_true(CacheUtils::get($secondKey) !== null, 'Secondary cache missing before invalidation.');

CacheUtils::invalidateMulti('items', 5);

assert_true(CacheUtils::get(CacheKey::forMulti('items', [1, 5])) === null, 'Primary multi cache not invalidated when removing id 5.');
assert_true(CacheUtils::get($secondKey) !== null, 'Secondary cache should remain after invalidating id 5.');

CacheUtils::invalidateMulti('items', 3);
assert_true(CacheUtils::get($secondKey) === null, 'Secondary cache not invalidated when removing id 3.');

clean_cache_dir();
exit(0);
