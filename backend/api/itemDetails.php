<?php
require_once __DIR__ . '/../config/app.php';
require_once __DIR__ . '/../config/featureFlags.php';
require_once __DIR__ . '/../cacheUtils.php';
require_once __DIR__ . '/../config/endpoints.php';
require_once __DIR__ . '/../httpUtils.php';
require_once __DIR__ . '/../utils/timeout.php';
require_once __DIR__ . '/response.php';

$ttl = AppConfig::cacheTtlFast();
header('Cache-Control: public, max-age=' . $ttl . ', stale-while-revalidate=' . $ttl);

$itemId = isset($_GET['itemId']) ? intval($_GET['itemId']) : 0;
if (!$itemId) {
    json_fail(400, 'item_id_required', 'itemId required');
}

if (isset($_GET['invalidate'])) {
    CacheUtils::invalidate("item_{$itemId}");
    CacheUtils::invalidate("item_{$itemId}_en");
    CacheUtils::invalidate("recipe_search_{$itemId}");
    CacheUtils::invalidate("recipe_{$itemId}");
    CacheUtils::invalidate("market_{$itemId}");
    CacheUtils::invalidateMulti('items', $itemId);
    CacheUtils::invalidateMulti('items_en', $itemId);
    CacheUtils::invalidateMulti('market', $itemId);
    CacheUtils::invalidate("nested_recipe_{$itemId}");
}

function fetch_json(string $url, ?string $cacheKey, int $ttl)
{
    $cacheKey = $cacheKey ?? md5($url);
    $cached = CacheUtils::get($cacheKey);
    $headers = [];
    if ($cached && isset($cached['meta'])) {
        if (isset($cached['meta']['etag'])) {
            $headers[] = 'If-None-Match: ' . $cached['meta']['etag'];
        }
        if (isset($cached['meta']['last_modified'])) {
            $headers[] = 'If-Modified-Since: ' . $cached['meta']['last_modified'];
        }
    }

    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HEADER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, AppConfig::fetchTimeoutSeconds());
    if ($headers) {
        curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    }

    $response = curl_exec($ch);
    $statusCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $headerSize = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    $headerStr = substr($response, 0, $headerSize);
    $body = substr($response, $headerSize);
    curl_close($ch);

    if ($statusCode === 304 && $cached) {
        CacheUtils::set($cacheKey, $cached['data'], $ttl, $cached['meta']);
        $body = $cached['data'];
        $statusCode = 200;
    } elseif ($statusCode === 200) {
        $etag = null;
        $lastMod = null;
        foreach (explode("\r\n", $headerStr) as $line) {
            if (stripos($line, 'ETag:') === 0) {
                $etag = trim(substr($line, 5));
            }
            if (stripos($line, 'Last-Modified:') === 0) {
                $lastMod = trim(substr($line, 14));
            }
        }
        CacheUtils::set($cacheKey, $body, $ttl, ['etag' => $etag, 'last_modified' => $lastMod]);
    } else {
        return [null, $statusCode];
    }

    $json = json_decode($body, true);
    if ($json === null && json_last_error() !== JSON_ERROR_NONE) {
        return [null, $statusCode];
    }

    if (is_array($json) && array_key_exists('data', $json) && array_key_exists('meta', $json)) {
        return [$json['data'], $statusCode];
    }

    return [$json, $statusCode];
}

$source = 'local';

try {
    $flags = FeatureFlags::resolveForRequest();
    $source = FeatureFlags::enabled('forceLocalOnly', $flags) ? 'local' : 'fallback';
    if (FeatureFlags::enabled('usePrecomputed', $flags)) {
        $source = 'fallback';
    }

    api_register_meta_overrides(['source' => $source]);

    $aggregation = withTimeout(function ($guard) use ($itemId, $flags) {
    $guard();
    $lang = AppConfig::currentLang();
    $requests = [
        'item' => [
            'url' => ITEMS_ENDPOINT . "/{$itemId}?lang=" . $lang,
            'cacheKey' => "item_{$itemId}",
            'ttl' => AppConfig::cacheTtlSlow(),
        ],
        'item_en' => [
            'url' => ITEMS_ENDPOINT . "/{$itemId}?lang=en",
            'cacheKey' => "item_{$itemId}_en",
            'ttl' => AppConfig::cacheTtlSlow(),
        ],
        'recipe_search' => [
            'url' => RECIPES_SEARCH_ENDPOINT . "?output={$itemId}",
            'cacheKey' => "recipe_search_{$itemId}",
            'ttl' => AppConfig::cacheTtlSlow(),
        ],
        'market' => [
            'url' => MARKET_CSV_URL . "?fields=id,buy_price,sell_price,buy_quantity,sell_quantity,last_updated,1d_buy_sold,1d_sell_sold,2d_buy_sold,2d_sell_sold,7d_buy_sold,7d_sell_sold,1m_buy_sold,1m_sell_sold&ids={$itemId}",
            'cacheKey' => "market_{$itemId}",
            'ttl' => AppConfig::cacheTtlFast(),
        ],
    ];

    $responses = multi_fetch($requests);
    $guard();

    $item = null;
    $itemStatus = $responses['item']['status'];
    if ($itemStatus === 200 && $responses['item']['data']) {
        $item = json_decode($responses['item']['data'], true);
    }

    if (!$item) {
        $error = $itemStatus === 404 ? 'Item not found' : 'Failed to fetch item data';
        return [
            'status' => $itemStatus === 404 ? 404 : 502,
            'payload' => null,
            'errors' => [$error],
        ];
    }

    $nameEn = null;
    if (isset($responses['item_en']) && $responses['item_en']['status'] === 200 && $responses['item_en']['data']) {
        $itemEnData = json_decode($responses['item_en']['data'], true);
        if (is_array($itemEnData) && isset($itemEnData['name'])) {
            $nameEn = $itemEnData['name'];
        }
    }
    $item['name_en'] = $nameEn;
    $guard();

    $recipe = null;
    if ($responses['recipe_search']['status'] === 200 && $responses['recipe_search']['data']) {
        $ids = json_decode($responses['recipe_search']['data'], true);
        if ($ids && count($ids) > 0) {
            $recipeId = $ids[0];
            [$recipeData, $recipeStatus] = fetch_json(
                RECIPES_ENDPOINT . "/{$recipeId}?lang=" . $lang,
                "recipe_{$itemId}",
                AppConfig::cacheTtlSlow()
            );
            if ($recipeStatus === 200 && $recipeData) {
                $ingredients = [];
                if (isset($recipeData['ingredients'])) {
                    foreach ($recipeData['ingredients'] as $ing) {
                        $ingredients[] = [
                            'item_id' => $ing['item_id'],
                            'count' => $ing['count'],
                        ];
                        $guard();
                    }
                }
                $recipe = [
                    'output_item_count' => $recipeData['output_item_count'] ?? 1,
                    'ingredients' => $ingredients,
                ];
            }
        }
    }

    $market = [];
    if ($responses['market']['status'] === 200 && $responses['market']['data']) {
        $market = parse_market_csv($responses['market']['data']);
    }
    $guard();

    $nested = null;
    if (!FeatureFlags::enabled('usePrecomputed', $flags)) {
        [$nested, $nestedStatus] = fetch_json(
            RECIPE_TREE_ENDPOINT . "/{$itemId}",
            "nested_recipe_{$itemId}",
            AppConfig::cacheTtlSlow()
        );
        if ($nestedStatus !== 200) {
            $nested = null;
        }
    }

    return [
        'status' => 200,
        'payload' => [
            'item' => $item,
            'recipe' => $recipe,
            'market' => $market,
            'nested_recipe' => $nested,
        ],
        'errors' => [],
    ];
}, AppConfig::maxAggregationMs());

    if ($aggregation['stale']) {
        json_fail(200, 'aggregation_timeout', 'Aggregation timeout exceeded', [
            'stale' => true,
            'source' => 'fallback',
        ]);
    }

    $result = $aggregation['data'] ?? [];
    $status = $result['status'] ?? 200;
    $payload = $result['payload'] ?? null;
    $errors = $result['errors'] ?? [];

    if ($status !== 200) {
        json_fail($status, 'aggregation_failed', $errors[0] ?? 'Unexpected error', [
            'source' => 'fallback',
        ], $errors);
    }

    json_ok($payload, [
        'source' => $source,
    ], 200, $errors);
} catch (Throwable $e) {
    json_fail(500, 'item_details_unexpected', 'Unexpected item details error', ['source' => $source], [
        ['code' => 'exception', 'msg' => $e->getMessage()],
    ]);
}
