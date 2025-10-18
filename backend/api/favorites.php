<?php
require_once __DIR__ . '/../session.php';
require_once __DIR__ . '/../cacheUtils.php';
require_once __DIR__ . '/../config/featureFlags.php';
require_once __DIR__ . '/response.php';

header('Cache-Control: no-store, private');

$user = require_session();
$method = $_SERVER['REQUEST_METHOD'];
$flags = FeatureFlags::resolveForRequest();
$source = FeatureFlags::enabled('forceLocalOnly', $flags) ? 'local' : 'fallback';

api_register_meta_overrides(['source' => $source]);

try {
    if ($method === 'GET') {
        $stmt = $pdo->prepare('SELECT item_id FROM favorites WHERE user_id=?');
        $stmt->execute([$user['id']]);
        json_ok($stmt->fetchAll(PDO::FETCH_COLUMN), ['source' => $source]);
    } elseif ($method === 'POST') {
        $data = json_decode(file_get_contents('php://input'), true);
        $item = $data['item_id'] ?? null;
        if (!$item) {
            json_fail(400, 'item_id_required', 'item_id required', ['source' => $source]);
        }
        $stmt = $pdo->prepare('INSERT IGNORE INTO favorites (user_id, item_id) VALUES (?, ?)');
        $stmt->execute([$user['id'], $item]);
        CacheUtils::invalidate('user_favorites_' . $user['id']);
        json_ok(['success' => true], ['source' => $source]);
    } elseif ($method === 'DELETE') {
        $item = $_GET['item_id'] ?? null;
        if (!$item) {
            json_fail(400, 'item_id_required', 'item_id required', ['source' => $source]);
        }
        $stmt = $pdo->prepare('DELETE FROM favorites WHERE user_id=? AND item_id=?');
        $stmt->execute([$user['id'], $item]);
        CacheUtils::invalidate('user_favorites_' . $user['id']);
        json_ok(['success' => true], ['source' => $source]);
    } else {
        json_fail(405, 'method_not_allowed', 'Method not allowed', ['source' => $source]);
    }
} catch (Throwable $e) {
    json_fail(500, 'favorites_unexpected', 'Unexpected favorites error', ['source' => $source], [
        ['code' => 'exception', 'msg' => $e->getMessage()],
    ]);
}
