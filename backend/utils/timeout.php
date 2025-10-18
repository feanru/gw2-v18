<?php
require_once __DIR__ . '/../config/app.php';

class TimeoutExceededException extends RuntimeException
{
}

/**
 * Execute a callable with a soft timeout guard. The callable receives a guard
 * function that should be invoked periodically. If the guard determines that
 * the maximum duration has been exceeded, a TimeoutExceededException is
 * thrown and the helper returns a stale response structure.
 *
 * @param callable $fn function (callable $guard): mixed
 * @param int $timeoutMs maximum time in milliseconds
 * @return array{data:mixed, stale:bool}
 */
function withTimeout(callable $fn, int $timeoutMs): array
{
    $deadline = microtime(true) + ($timeoutMs / 1000);
    $guard = function () use ($deadline) {
        if (microtime(true) >= $deadline) {
            throw new TimeoutExceededException('Aggregation timeout exceeded');
        }
    };

    try {
        $result = $fn($guard);
        return [
            'data' => $result,
            'stale' => false,
        ];
    } catch (TimeoutExceededException $e) {
        return [
            'data' => null,
            'stale' => true,
        ];
    }
}
