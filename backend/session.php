<?php
require_once __DIR__.'/config.php';
require_once __DIR__ . '/api/response.php';

function require_session() {
    global $pdo;
    if (empty($_COOKIE['session_id'])) {
        json_fail(401, 'session_required', 'No session');
    }
    $stmt = $pdo->prepare('SELECT users.* FROM sessions JOIN users ON sessions.user_id=users.id WHERE sessions.id=?');
    $stmt->execute([$_COOKIE['session_id']]);
    $user = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$user) {
        json_fail(401, 'session_invalid', 'Invalid session');
    }
    return $user;
}
?>
