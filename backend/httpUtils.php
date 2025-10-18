<?php
require_once __DIR__ . '/cacheUtils.php';
require_once __DIR__ . '/config/app.php';

function multi_fetch($requests) {
    $multi = curl_multi_init();
    $handles = [];
    $responses = [];

    foreach ($requests as $key => $req) {
        $normalizedKey = CacheKey::normalize($req['cacheKey']);
        $requests[$key]['cacheKey'] = $normalizedKey;
        $cache = CacheUtils::get($normalizedKey);
        if ($cache) {
            $responses[$key] = ['status' => 200, 'data' => $cache['data']];
            continue;
        }
        $ch = curl_init($req['url']);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_HEADER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, AppConfig::fetchTimeoutSeconds());
        if ($cache && isset($cache['meta'])) {
            $headers = [];
            if (isset($cache['meta']['etag'])) $headers[] = 'If-None-Match: ' . $cache['meta']['etag'];
            if (isset($cache['meta']['last_modified'])) $headers[] = 'If-Modified-Since: ' . $cache['meta']['last_modified'];
            if ($headers) curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
        }
        curl_multi_add_handle($multi, $ch);
        $handles[$key] = ['handle' => $ch, 'cacheKey' => $normalizedKey, 'ttl' => $req['ttl']];
    }

    do {
        $status = curl_multi_exec($multi, $active);
        if ($active) curl_multi_select($multi);
    } while ($active && $status == CURLM_OK);

    foreach ($handles as $key => $info) {
        $ch = $info['handle'];
        $content = curl_multi_getcontent($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $headerSize = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
        $headersStr = substr($content, 0, $headerSize);
        $body = substr($content, $headerSize);

        if ($code === 200) {
            $etag = null; $lastMod = null;
            foreach (explode("\r\n", $headersStr) as $line) {
                if (stripos($line, 'ETag:') === 0) $etag = trim(substr($line, 5));
                if (stripos($line, 'Last-Modified:') === 0) $lastMod = trim(substr($line, 14));
            }
            CacheUtils::set($info['cacheKey'], $body, $info['ttl'], ['etag' => $etag, 'last_modified' => $lastMod]);
        } elseif ($code === 304) {
            $cached = CacheUtils::get($info['cacheKey']);
            if ($cached) {
                CacheUtils::set($info['cacheKey'], $cached['data'], $info['ttl'], $cached['meta']);
                $body = $cached['data'];
                $code = 200;
            } else {
                $body = null;
            }
        } else {
            $body = null;
        }

        $responses[$key] = ['status' => $code, 'data' => $body];
        curl_multi_remove_handle($multi, $ch);
        curl_close($ch);
    }

    curl_multi_close($multi);
    return $responses;
}

function parse_market_csv($csv) {
    if ($csv === null) return [];
    $lines = array_map('trim', explode("\n", $csv));
    if (count($lines) < 2) return [];
    $headers = str_getcsv($lines[0]);
    $values = str_getcsv($lines[1]);
    $result = [];
    foreach ($headers as $i => $h) {
        $value = $values[$i] ?? null;
        if (is_numeric($value)) {
            $value = strpos($value, '.') !== false ? (float)$value : (int)$value;
        }
        $result[$h] = $value;
    }
    return $result;
}

function parse_market_bundle_csv($csv) {
    if ($csv === null) return [];
    $lines = array_map('trim', explode("\n", $csv));
    if (count($lines) < 2) return [];
    $headers = str_getcsv($lines[0]);
    $results = [];
    for ($i = 1; $i < count($lines); $i++) {
        if ($lines[$i] === '') continue;
        $values = str_getcsv($lines[$i]);
        $row = [];
        foreach ($headers as $j => $h) {
            $value = $values[$j] ?? null;
            if (is_numeric($value)) {
                $value = strpos($value, '.') !== false ? (float)$value : (int)$value;
            }
            $row[$h] = $value;
        }
        if (isset($row['id'])) {
            $results[(int)$row['id']] = $row;
        }
    }
    return $results;
}
?>
