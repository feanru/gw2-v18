<?php
require_once __DIR__ . '/config/endpoints.php';

$id = null;
if (isset($_SERVER['PATH_INFO']) && $_SERVER['PATH_INFO'] !== '') {
    $id = trim($_SERVER['PATH_INFO'], '/');
} elseif (isset($_GET['id'])) {
    $id = $_GET['id'];
}

if (!$id) {
    http_response_code(400);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'missing id']);
    exit;
}

$target = rtrim(RECIPE_TREE_URL, '/') . '/' . urlencode($id);

$ch = curl_init($target);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_TIMEOUT, 10);

$body = curl_exec($ch);
$code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

http_response_code($code ?: 500);
header('Content-Type: application/json');
if ($body !== false) {
    echo $body;
} else {
    echo json_encode(['error' => 'request failed']);
}
