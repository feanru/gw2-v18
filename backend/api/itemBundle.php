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

$ids = isset($_GET['ids']) ? $_GET['ids'] : [];
if (!is_array($ids)) {
    $ids = explode(',', $ids);
}
$ids = array_values(array_filter(array_map('intval', $ids)));
if (count($ids) === 0) {
    json_fail(400, 'ids_required', 'ids required');
}
$ids = CacheKey::normalizeIds($ids);

if (isset($_GET['invalidate'])) {
    $inv = $_GET['invalidate'];
    if (!is_array($inv)) {
        $inv = explode(',', $inv);
    }
    foreach ($inv as $iid) {
        $iid = intval($iid);
        CacheUtils::invalidate("items_{$iid}");
        CacheUtils::invalidateMulti('items', $iid);
        CacheUtils::invalidate("recipe_search_{$iid}");
        CacheUtils::invalidate("recipe_{$iid}");
        CacheUtils::invalidate("market_{$iid}");
        CacheUtils::invalidateMulti('market', $iid);
        CacheUtils::invalidate("nested_recipe_{$iid}");
    }
}

function recipe_min_from_data($recipe)
{
    if (!$recipe) {
        return null;
    }
    $ingredients = [];
    if (isset($recipe['ingredients']) && is_array($recipe['ingredients'])) {
        foreach ($recipe['ingredients'] as $ing) {
            $ingredients[] = [
                'item_id' => $ing['item_id'],
                'count' => $ing['count'],
            ];
        }
    }
    return [
        'output_item_count' => $recipe['output_item_count'] ?? 1,
        'ingredients' => $ingredients,
    ];
}

function unwrap_nested_recipe_payload($json)
{
    if (!is_array($json)) {
        return null;
    }
    if (array_key_exists('data', $json) && array_key_exists('meta', $json)) {
        return $json['data'];
    }
    return $json;
}

function fetch_nested_recipe(int $id, array $flags)
{
    if (FeatureFlags::enabled('usePrecomputed', $flags)) {
        return null;
    }
    $cacheKey = "nested_recipe_{$id}";
    $cache = CacheUtils::get($cacheKey);
    if ($cache && isset($cache['data'])) {
        $json = json_decode($cache['data'], true);
        if ($json !== null) {
            return unwrap_nested_recipe_payload($json);
        }
    }
    $ch = curl_init(RECIPE_TREE_ENDPOINT . "/{$id}");
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, AppConfig::fetchTimeoutSeconds());
    $body = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($code === 200 && $body !== false) {
        CacheUtils::set($cacheKey, $body, AppConfig::cacheTtlSlow());
        $json = json_decode($body, true);
        if ($json !== null) {
            return unwrap_nested_recipe_payload($json);
        }
    }
    return null;
}

$source = 'local';

try {
    $flags = FeatureFlags::resolveForRequest();
    $source = FeatureFlags::enabled('forceLocalOnly', $flags) ? 'local' : 'fallback';
    if (FeatureFlags::enabled('usePrecomputed', $flags)) {
        $source = 'fallback';
    }

    api_register_meta_overrides(['source' => $source]);

    $aggregation = withTimeout(function ($guard) use ($ids, $flags) {
    $guard();
    $lang = AppConfig::currentLang();
    $idStr = implode(',', $ids);
    $requests = [
        'items' => [
            'url' => ITEMS_ENDPOINT . "?ids={$idStr}&lang=" . $lang,
            'cacheKey' => CacheKey::forMulti('items', $ids),
            'ttl' => AppConfig::cacheTtlSlow(),
        ],
        'market' => [
            'url' => MARKET_CSV_URL . "?fields=id,buy_price,sell_price&ids={$idStr}",
            'cacheKey' => CacheKey::forMulti('market', $ids),
            'ttl' => AppConfig::cacheTtlFast(),
        ],
    ];

    foreach ($ids as $id) {
        $requests["recipe_search_{$id}"] = [
            'url' => RECIPES_SEARCH_ENDPOINT . "?output={$id}",
            'cacheKey' => "recipe_search_{$id}",
            'ttl' => AppConfig::cacheTtlSlow(),
        ];
    }

    $responses = multi_fetch($requests);
    $guard();

    $items = [];
    if ($responses['items']['status'] === 200 && $responses['items']['data']) {
        $items = json_decode($responses['items']['data'], true);
    }
    if (!is_array($items)) {
        return [
            'status' => 502,
            'payload' => null,
            'errors' => ['Failed to fetch item data'],
        ];
    }

    $itemMap = [];
    foreach ($items as $item) {
        if (!isset($item['id'])) {
            continue;
        }
        $itemMap[$item['id']] = [
            'id' => $item['id'],
            'name' => $item['name'] ?? null,
            'icon' => $item['icon'] ?? null,
            'rarity' => $item['rarity'] ?? null,
        ];
        $guard();
    }

    $marketMap = [];
    if ($responses['market']['status'] === 200 && $responses['market']['data']) {
        $marketMap = parse_market_bundle_csv($responses['market']['data']);
    }
    $guard();

    $recipeIds = [];
    foreach ($ids as $id) {
        $key = "recipe_search_{$id}";
        if (isset($responses[$key]) && $responses[$key]['status'] === 200 && $responses[$key]['data']) {
            $idsList = json_decode($responses[$key]['data'], true);
            if ($idsList && count($idsList) > 0) {
                $recipeIds[$id] = $idsList[0];
            }
        }
        $guard();
    }

    $recipeReqs = [];
    foreach ($recipeIds as $itemId => $recipeId) {
        $recipeReqs[$itemId] = [
            'url' => RECIPES_ENDPOINT . "/{$recipeId}?lang=" . $lang,
            'cacheKey' => "recipe_{$itemId}",
            'ttl' => AppConfig::cacheTtlSlow(),
        ];
    }

    $recipeResponses = multi_fetch($recipeReqs);
    $guard();

    $recipeMap = [];
    foreach ($recipeResponses as $itemId => $resp) {
        if ($resp['status'] === 200 && $resp['data']) {
            $recipeData = json_decode($resp['data'], true);
            $recipeMap[$itemId] = recipe_min_from_data($recipeData);
        }
        $guard();
    }

    $result = [];
    foreach ($ids as $id) {
        if (!isset($itemMap[$id])) {
            continue;
        }
        $result[] = [
            'id' => $id,
            'item' => $itemMap[$id],
            'recipe' => $recipeMap[$id] ?? null,
            'market' => $marketMap[$id] ?? [],
            'nested_recipe' => fetch_nested_recipe($id, $flags),
        ];
        $guard();
    }

    return [
        'status' => 200,
        'payload' => $result,
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
    json_fail(500, 'item_bundle_unexpected', 'Unexpected item bundle error', ['source' => $source], [
        ['code' => 'exception', 'msg' => $e->getMessage()],
    ]);
}
