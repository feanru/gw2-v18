<?php
require_once __DIR__ . '/app.php';

final class FeatureFlags
{
    private static $cache;

    private static function defaults(): array
    {
        if (self::$cache === null) {
            self::$cache = [
                'usePrecomputed' => AppConfig::envBool('FEATURE_USE_PRECOMPUTED', false),
                'forceLocalOnly' => AppConfig::envBool('FEATURE_FORCE_LOCAL_ONLY', false),
            ];
        }
        return self::$cache;
    }

    private static function normalizeKey(string $key): ?string
    {
        $normalized = strtolower(trim($key));
        $normalized = str_replace(['-', '_'], '', $normalized);
        switch ($normalized) {
            case 'useprecomputed':
            case 'featureuseprecomputed':
                return 'usePrecomputed';
            case 'forcelocalonly':
            case 'featureforcelocalonly':
                return 'forceLocalOnly';
            default:
                return null;
        }
    }

    private static function toBool($value): ?bool
    {
        if (is_bool($value)) {
            return $value;
        }
        if (is_numeric($value)) {
            return ((int) $value) === 1;
        }
        $value = strtolower(trim((string) $value));
        if ($value === '') {
            return null;
        }
        $truthy = ['1', 'true', 'yes', 'on'];
        $falsy = ['0', 'false', 'no', 'off'];
        if (in_array($value, $truthy, true)) {
            return true;
        }
        if (in_array($value, $falsy, true)) {
            return false;
        }
        return null;
    }

    private static function parseOverrides($raw): array
    {
        $overrides = [];
        if (is_array($raw)) {
            foreach ($raw as $key => $value) {
                $normalizedKey = self::normalizeKey((string) $key);
                if ($normalizedKey === null) {
                    continue;
                }
                $bool = self::toBool($value);
                if ($bool !== null) {
                    $overrides[$normalizedKey] = $bool;
                }
            }
            return $overrides;
        }

        $rawString = (string) $raw;
        foreach (explode(',', $rawString) as $chunk) {
            $chunk = trim($chunk);
            if ($chunk === '') {
                continue;
            }
            $value = 'true';
            $key = $chunk;
            if (strpos($chunk, ':') !== false) {
                [$key, $value] = array_map('trim', explode(':', $chunk, 2));
            } elseif (strpos($chunk, '=') !== false) {
                [$key, $value] = array_map('trim', explode('=', $chunk, 2));
            }
            $normalizedKey = self::normalizeKey($key);
            if ($normalizedKey === null) {
                continue;
            }
            $bool = self::toBool($value);
            if ($bool === null) {
                continue;
            }
            $overrides[$normalizedKey] = $bool;
        }
        return $overrides;
    }

    public static function resolveForRequest(): array
    {
        $flags = self::defaults();
        if (!isset($_GET['ff'])) {
            return $flags;
        }
        $overrides = self::parseOverrides($_GET['ff']);
        foreach ($overrides as $key => $value) {
            $flags[$key] = $value;
        }
        return $flags;
    }

    public static function enabled(string $flag, ?array $flags = null): bool
    {
        $flags = $flags ?? self::resolveForRequest();
        return isset($flags[$flag]) ? (bool) $flags[$flag] : false;
    }
}
