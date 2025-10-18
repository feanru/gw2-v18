<?php
require_once __DIR__ . '/../session.php';
require_once __DIR__ . '/../config/featureFlags.php';
require_once __DIR__ . '/response.php';

header('Cache-Control: no-store, private');

$user = require_session();
$flags = FeatureFlags::resolveForRequest();
$source = FeatureFlags::enabled('forceLocalOnly', $flags) ? 'local' : 'fallback';

json_ok([
    'id' => $user['id'],
    'email' => $user['email'],
    'name' => $user['name'],
    'avatar' => $user['avatar'],
    'provider' => $user['oauth_provider'],
], ['source' => $source]);
