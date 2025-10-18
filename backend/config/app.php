<?php
require_once __DIR__ . '/../env.php';

final class AppConfig
{
    private const TRUE_VALUES = ['1', 'true', 'yes', 'on'];
    private const FALSE_VALUES = ['0', 'false', 'no', 'off'];

    public static function env(string $key, $default = null)
    {
        $value = getenv($key);
        if ($value === false || $value === null || $value === '') {
            return $default;
        }
        return $value;
    }

    public static function envInt(string $key, int $default): int
    {
        $value = self::env($key);
        if ($value === null) {
            return $default;
        }
        return (int) $value;
    }

    public static function envBool(string $key, bool $default = false): bool
    {
        $value = self::env($key);
        if ($value === null) {
            return $default;
        }
        $normalized = strtolower(trim((string) $value));
        if (in_array($normalized, self::TRUE_VALUES, true)) {
            return true;
        }
        if (in_array($normalized, self::FALSE_VALUES, true)) {
            return false;
        }
        return $default;
    }

    public static function appEnv(): string
    {
        return (string) self::env('APP_ENV', 'production');
    }

    public static function defaultLang(): string
    {
        $lang = (string) self::env('DEFAULT_LANG', 'es');
        return $lang !== '' ? $lang : 'es';
    }

    public static function currentLang(): string
    {
        if (isset($_GET['lang'])) {
            $candidate = strtolower(trim((string) $_GET['lang']));
            if ($candidate !== '') {
                return $candidate;
            }
        }
        return self::defaultLang();
    }

    public static function cacheTtlFast(): int
    {
        $ttl = self::envInt('CACHE_TTL_FAST', 120);
        return $ttl > 0 ? $ttl : 120;
    }

    public static function cacheTtlSlow(): int
    {
        $ttl = self::envInt('CACHE_TTL_SLOW', 1800);
        return $ttl > 0 ? $ttl : 1800;
    }

    public static function fetchTimeoutMs(): int
    {
        $timeout = self::envInt('FETCH_TIMEOUT_MS', 15000);
        return $timeout > 0 ? $timeout : 15000;
    }

    public static function fetchTimeoutSeconds(): int
    {
        $seconds = (int) ceil(self::fetchTimeoutMs() / 1000);
        return $seconds > 0 ? $seconds : 1;
    }

    public static function maxAggregationMs(): int
    {
        $timeout = self::envInt('MAX_AGGREGATION_MS', 12000);
        return $timeout > 0 ? $timeout : 12000;
    }
}
