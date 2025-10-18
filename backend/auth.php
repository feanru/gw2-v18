<?php
require_once __DIR__.'/env.php';
session_set_cookie_params([
    'path' => '/',
    'secure' => true,
    'httponly' => true,
    'samesite' => 'None'
]);
session_start();
header('Cache-Control: no-store, no-cache, must-revalidate');
$provider = $_GET['provider'] ?? '';
$state = bin2hex(random_bytes(16));
$_SESSION['oauth_state'] = $state;
$_SESSION['oauth_provider'] = $provider;
session_write_close();
$redirect = getenv('OAUTH_REDIRECT_URI') ?: 'http://localhost/backend/oauth_callback.php';

function require_env($name) {
    $value = getenv($name);
    if (empty($value)) {
        http_response_code(500);
        echo $name.' not configured';
        exit;
    }
    return $value;
}

switch ($provider) {
    case 'google':
        $client_id = require_env('GOOGLE_CLIENT_ID');
        $params = [
            'client_id' => $client_id,
            'redirect_uri' => $redirect,
            'response_type' => 'code',
            'scope' => 'profile email',
            'state' => $state
        ];
        $url = 'https://accounts.google.com/o/oauth2/v2/auth?'.http_build_query($params);
        header('Location: '.$url);
        exit;
    case 'discord':
        $client_id = require_env('DISCORD_CLIENT_ID');
        $params = [
            'client_id' => $client_id,
            'redirect_uri' => $redirect,
            'response_type' => 'code',
            'scope' => 'identify email',
            'state' => $state
        ];
        $url = 'https://discord.com/api/oauth2/authorize?'.http_build_query($params);
        header('Location: '.$url);
        exit;
    default:
        http_response_code(400);
        echo 'Unknown provider';
}
?>
