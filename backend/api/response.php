<?php
require_once __DIR__ . '/../config/app.php';

function &api_request_context_ref(): array
{
    static $context = null;
    if ($context === null) {
        $traceId = null;
        try {
            $traceId = bin2hex(random_bytes(16));
        } catch (Throwable $e) {
            // Fallback handled below.
        }
        if (!$traceId && function_exists('openssl_random_pseudo_bytes')) {
            $traceId = bin2hex(openssl_random_pseudo_bytes(16));
        }
        if (!$traceId) {
            $traceId = bin2hex(pack('N4', mt_rand(), mt_rand(), mt_rand(), mt_rand()));
        }

        $context = [
            'traceId' => $traceId,
            'ts' => gmdate('c'),
            'metaOverrides' => [],
        ];
    }

    return $context;
}

function api_request_context(): array
{
    $context = &api_request_context_ref();

    return $context;
}

function api_register_meta_overrides(array $overrides): void
{
    $context = &api_request_context_ref();
    $context['metaOverrides'] = array_merge($context['metaOverrides'], $overrides);
}

function api_meta(array $overrides = []): array
{
    $context = &api_request_context_ref();

    $defaults = [
        'lang' => AppConfig::currentLang(),
        'lastUpdated' => gmdate('c'),
        'stale' => false,
        'traceId' => $context['traceId'],
        'ts' => $context['ts'],
        'source' => 'local',
    ];

    return array_merge($defaults, $context['metaOverrides'], $overrides);
}

function normalize_error_entries($errors): array
{
    if ($errors === null) {
        return [];
    }

    $normalized = [];
    $seen = [];

    $process = static function ($entry) use (&$normalized, &$seen, &$process) {
        if ($entry === null) {
            return;
        }

        if (is_array($entry) && array_values($entry) !== $entry) {
            $hasKnownKeys = array_key_exists('code', $entry) || array_key_exists('msg', $entry) || array_key_exists('message', $entry);
            if ($hasKnownKeys) {
                $normalizedEntry = normalize_error_entry($entry);
                $key = $normalizedEntry['code'] . "\n" . $normalizedEntry['msg'];
                if (!isset($seen[$key])) {
                    $normalized[] = $normalizedEntry;
                    $seen[$key] = true;
                }
                return;
            }
        }

        if (is_array($entry)) {
            foreach ($entry as $value) {
                $process($value);
            }
            return;
        }

        $normalizedEntry = normalize_error_entry($entry);
        $key = $normalizedEntry['code'] . "\n" . $normalizedEntry['msg'];
        if (!isset($seen[$key])) {
            $normalized[] = $normalizedEntry;
            $seen[$key] = true;
        }
    };

    $process($errors);

    return $normalized;
}

function json_ok($data, array $metaOverrides = [], int $statusCode = 200, $errors = null): void
{
    http_response_code($statusCode);
    header('Content-Type: application/json; charset=utf-8');

    $metaErrors = null;
    if (array_key_exists('errors', $metaOverrides)) {
        $metaErrors = $metaOverrides['errors'];
        unset($metaOverrides['errors']);
    }

    if ($errors === null) {
        $errors = $metaErrors;
    } elseif ($metaErrors !== null) {
        $errors = [$metaErrors, $errors];
    }

    $payload = [
        'data' => $data,
        'meta' => api_meta($metaOverrides),
    ];

    $normalizedErrors = normalize_error_entries($errors);
    if (!empty($normalizedErrors)) {
        $payload['errors'] = $normalizedErrors;
    }

    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function normalize_error_entry($error): array
{
    if (is_array($error)) {
        $code = isset($error['code']) ? trim((string) $error['code']) : null;
        if ($code === '') {
            $code = null;
        }
        $message = null;
        if (array_key_exists('msg', $error)) {
            $message = trim((string) $error['msg']);
        } elseif (array_key_exists('message', $error)) {
            $message = trim((string) $error['message']);
        }
        if ($message === '') {
            $message = null;
        }
        if ($code !== null && $message !== null) {
            return ['code' => $code, 'msg' => $message];
        }
        if (count($error) === 2) {
            $values = array_values($error);
            $pairCode = trim((string) $values[0]);
            $pairMsg = trim((string) $values[1]);
            if ($pairCode === '') {
                $pairCode = null;
            }
            if ($pairMsg === '') {
                $pairMsg = null;
            }
            if ($pairCode === null && $pairMsg === null) {
                $pairMsg = 'Unknown error';
            }
            if ($pairCode === null) {
                $pairCode = $pairMsg ?? 'error';
            }
            if ($pairMsg === null) {
                $pairMsg = $pairCode;
            }
            return ['code' => $pairCode, 'msg' => $pairMsg];
        }
        if ($code !== null) {
            return ['code' => $code, 'msg' => $message ?? $code];
        }
        if ($message !== null) {
            $sanitizedCode = preg_replace('/[^a-z0-9_\-]/i', '', strtolower(str_replace(' ', '_', substr($message, 0, 50)))) ?: 'error';
            return ['code' => $sanitizedCode, 'msg' => $message];
        }
    }

    $message = is_scalar($error) ? trim((string) $error) : '';
    if ($message === '') {
        $message = 'Unknown error';
    }

    return [
        'code' => preg_replace('/[^a-z0-9_\-]/i', '', strtolower(str_replace(' ', '_', substr($message, 0, 50)))) ?: 'error',
        'msg' => $message,
    ];
}

function json_fail(int $statusCode, string $code, string $message, array $metaOverrides = [], array $extraErrors = []): void
{
    http_response_code($statusCode);
    header('Content-Type: application/json; charset=utf-8');

    $metaErrors = null;
    if (array_key_exists('errors', $metaOverrides)) {
        $metaErrors = $metaOverrides['errors'];
        unset($metaOverrides['errors']);
    }

    $errors = normalize_error_entries([
        ['code' => $code, 'msg' => $message],
        $metaErrors,
        $extraErrors,
    ]);

    $payload = [
        'data' => null,
        'meta' => api_meta($metaOverrides),
    ];

    if (!empty($errors)) {
        $payload['errors'] = $errors;
    }

    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function api_response($data, array $metaOverrides = [], int $statusCode = 200): void
{
    json_ok($data, $metaOverrides, $statusCode);
}

function api_error(int $statusCode, string $message, array $metaOverrides = []): void
{
    json_fail($statusCode, 'error', $message, $metaOverrides);
}

function api_render_unhandled_throwable(Throwable $throwable): void
{
    $extraErrors = [];
    $throwableMessage = trim((string) $throwable->getMessage());
    if ($throwableMessage !== '') {
        $extraErrors[] = [
            'code' => 'exception',
            'msg' => $throwableMessage,
        ];
    }

    json_fail(
        500,
        'error_unexpected',
        'Unexpected error',
        [],
        $extraErrors
    );
}

set_exception_handler(static function (Throwable $throwable): void {
    api_render_unhandled_throwable($throwable);
});

set_error_handler(static function (int $severity, string $message, ?string $file = null, ?int $line = null): bool {
    if (!(error_reporting() & $severity)) {
        return false;
    }

    $extraErrors = [];
    $trimmedMessage = trim($message);
    if ($trimmedMessage !== '') {
        $extraErrors[] = [
            'code' => 'php_error',
            'msg' => $trimmedMessage,
        ];
    }

    json_fail(
        500,
        'error_unexpected',
        'Unexpected error',
        [],
        $extraErrors
    );

    return true;
});
