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
        CacheUtils::invalidate("items_en_{$iid}");
        CacheUtils::invalidateMulti('items_en', $iid);
        CacheUtils::invalidate("recipe_search_{$iid}");
        CacheUtils::invalidate("recipe_{$iid}");
        CacheUtils::invalidate("market_{$iid}");
        CacheUtils::invalidateMulti('market', $iid);
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
        'id' => $recipe['id'] ?? null,
        'output_item_count' => $recipe['output_item_count'] ?? 1,
        'ingredients' => $ingredients,
    ];
}

$source = 'local';

try {
    $flags = FeatureFlags::resolveForRequest();
    $source = FeatureFlags::enabled('forceLocalOnly', $flags) ? 'local' : 'fallback';
    if (FeatureFlags::enabled('usePrecomputed', $flags)) {
        $source = 'fallback';
    }

    api_register_meta_overrides(['source' => $source]);

    $aggregation = withTimeout(function ($guard) use ($ids) {
        $guard();
        $lang = AppConfig::currentLang();
        $idStr = implode(',', $ids);
        $requests = [
            'items' => [
                'url' => ITEMS_ENDPOINT . "?ids={$idStr}&lang=" . $lang,
                'cacheKey' => CacheKey::forMulti('items', $ids),
                'ttl' => AppConfig::cacheTtlSlow(),
            ],
            'items_en' => [
                'url' => ITEMS_ENDPOINT . "?ids={$idStr}&lang=en",
                'cacheKey' => CacheKey::forMulti('items_en', $ids),
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

        $itemEnMap = [];
        if (isset($responses['items_en']) && $responses['items_en']['status'] === 200 && $responses['items_en']['data']) {
            $itemsEn = json_decode($responses['items_en']['data'], true);
            if (is_array($itemsEn)) {
                foreach ($itemsEn as $itemEn) {
                    if (isset($itemEn['id'])) {
                        $itemEnMap[$itemEn['id']] = $itemEn;
                    }
                }
            }
        }
        $guard();

        $itemMap = [];
        foreach ($items as $item) {
            if (!isset($item['id'])) {
                continue;
            }
            $itemMap[$item['id']] = [
                'id' => $item['id'],
                'name' => $item['name'] ?? null,
                'name_en' => $itemEnMap[$item['id']]['name'] ?? null,
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
                'extra' => [
                    'last_updated' => time(),
                ],
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
    json_fail(500, 'data_bundle_unexpected', 'Unexpected data bundle error', ['source' => $source], [
        ['code' => 'exception', 'msg' => $e->getMessage()],
    ]);
}
