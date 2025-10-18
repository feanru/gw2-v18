<?php
require_once __DIR__.'/config.php';

if (!empty($_COOKIE['session_id'])) {
    $stmt = $pdo->prepare('DELETE FROM sessions WHERE id=?');
    $stmt->execute([$_COOKIE['session_id']]);
}

setcookie('session_id', '', [
    'expires'  => time()-3600,
    'path'     => '/',
    'secure'   => !empty($_SERVER['HTTPS']),
    'httponly' => true,
    'samesite' => 'Lax'
]);

header('Location: /');
exit;
?>
