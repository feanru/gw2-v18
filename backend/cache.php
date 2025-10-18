<?php
function cache_dir() {
    $dir = __DIR__ . '/cache';
    if (!is_dir($dir)) {
        mkdir($dir, 0777, true);
    }
    return $dir;
}

function cache_key($key) {
    return preg_replace('/[^A-Za-z0-9_\-\*]/', '_', $key);
}

function cache_path($key) {
    return cache_dir() . '/' . cache_key($key) . '.json';
}

function cache_get($key) {
    $file = cache_path($key);
    if (!file_exists($file)) {
        return null;
    }
    $data = json_decode(file_get_contents($file), true);
    if (!$data) {
        return null;
    }
    if (isset($data['expires']) && time() > $data['expires']) {
        return null;
    }
    return $data;
}

function cache_set($key, $value, $ttl = 3600, $meta = []) {
    $file = cache_path($key);
    $payload = [
        'data' => $value,
        'meta' => $meta,
        'expires' => time() + $ttl
    ];
    file_put_contents($file, json_encode($payload));
}

function cache_invalidate($keyPattern) {
    $dir = cache_dir();
    $pattern = cache_key($keyPattern);
    foreach (glob("{$dir}/{$pattern}.json") as $file) {
        @unlink($file);
    }
}

function cache_fetch($key, $url, $ttl = 3600) {
    $cached = cache_get($key);
    $headers = [];
    if ($cached && isset($cached['meta']['etag'])) {
        $headers[] = 'If-None-Match: ' . $cached['meta']['etag'];
    }
    if ($cached && isset($cached['meta']['last_modified'])) {
        $headers[] = 'If-Modified-Since: ' . $cached['meta']['last_modified'];
    }
    $opts = [
        'http' => [
            'timeout' => 10,
            'ignore_errors' => true,
            'header' => implode("\r\n", $headers)
        ]
    ];
    $context = stream_context_create($opts);
    $data = @file_get_contents($url, false, $context);
    $status = 0;
    if (isset($http_response_header[0])) {
        if (preg_match('#HTTP/\S+\s+(\d{3})#', $http_response_header[0], $m)) {
            $status = (int)$m[1];
        }
    }
    if ($status === 304 && $cached) {
        cache_set($key, $cached['data'], $ttl, $cached['meta']);
        return $cached['data'];
    }
    if ($data === false) {
        return $cached ? $cached['data'] : null;
    }
    $meta = [];
    foreach ($http_response_header as $h) {
        if (stripos($h, 'ETag:') === 0) {
            $meta['etag'] = trim(substr($h, 5));
        } elseif (stripos($h, 'Last-Modified:') === 0) {
            $meta['last_modified'] = trim(substr($h, 14));
        }
    }
    cache_set($key, $data, $ttl, $meta);
    return $data;
}

function cache_fetch_json($key, $url, $ttl = 3600) {
    $data = cache_fetch($key, $url, $ttl);
    if ($data === null) {
        return null;
    }
    $json = json_decode($data, true);
    if ($json === null && json_last_error() !== JSON_ERROR_NONE) {
        return null;
    }
    return $json;
}
?>
