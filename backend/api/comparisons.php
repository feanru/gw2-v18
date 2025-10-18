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

if ($method === 'GET') {
    $stmt = $pdo->prepare('SELECT id, item_left, item_right, item_names, item_ids FROM comparisons WHERE user_id=?');
    $stmt->execute([$user['id']]);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
    foreach ($rows as &$row) {
        if (!empty($row['item_ids'])) {
            $row['item_ids'] = json_decode($row['item_ids'], true);
        } else {
            $row['item_ids'] = array_filter([$row['item_left'], $row['item_right']]);
        }
    }
    json_ok($rows, ['source' => $source]);
} elseif ($method === 'POST') {
    $data = json_decode(file_get_contents('php://input'), true);
    $ids = $data['item_ids'] ?? null;
    $names = $data['item_names'] ?? null;
    if (!is_array($ids) || count($ids) < 2) {
        json_fail(400, 'item_ids_required', 'item_ids array required (min 2)', ['source' => $source]);
    }
    if (is_array($names)) {
        $names = json_encode($names);
    }
    $left = $ids[0];
    $right = $ids[1];
    $stmt = $pdo->prepare('INSERT INTO comparisons (user_id, item_left, item_right, item_names, item_ids) VALUES (?, ?, ?, ?, ?)');
    $stmt->execute([$user['id'], $left, $right, $names, json_encode($ids)]);
    CacheUtils::invalidate('user_comparisons_' . $user['id']);
    json_ok(['success' => true, 'id' => $pdo->lastInsertId()], ['source' => $source]);
} elseif ($method === 'DELETE') {
    $id = $_GET['id'] ?? null;
    if (!$id) {
        json_fail(400, 'id_required', 'id required', ['source' => $source]);
    }
    $stmt = $pdo->prepare('DELETE FROM comparisons WHERE user_id=? AND id=?');
    $stmt->execute([$user['id'], $id]);
    CacheUtils::invalidate('user_comparisons_' . $user['id']);
    json_ok(['success' => true], ['source' => $source]);
} else {
    json_fail(405, 'method_not_allowed', 'Method not allowed', ['source' => $source]);
}
