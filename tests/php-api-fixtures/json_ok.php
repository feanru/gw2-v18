<?php
require_once __DIR__ . '/../../backend/api/response.php';

$data = ['status' => 'ok'];
$meta = ['source' => 'local'];

if (isset($_GET['withErrors'])) {
    json_ok($data, $meta, 200, [
        'cacheStale',
        ['code' => 'secondary_issue', 'msg' => 'Secondary issue'],
    ]);
}

json_ok($data, $meta);
