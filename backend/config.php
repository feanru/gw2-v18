<?php
// backend/config.php
require_once __DIR__.'/env.php';
// ► Credenciales de conexión obtenidas de variables de entorno
$db_host = getenv('DB_HOST') ?: 'localhost';
$db_name = getenv('DB_NAME') ?: 'gw2db';
$db_user = getenv('DB_USER') ?: 'root';
$db_pass = getenv('DB_PASS') ?: '';

try {
    $pdo = new PDO(
        "mysql:host=$db_host;dbname=$db_name;charset=utf8mb4",
        $db_user,
        $db_pass,
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]  // lanza excepciones ante error
    );
} catch (PDOException $e) {
    // Devuelve error legible para el frontend
    error_log($e->getMessage());
    http_response_code(500);
    echo json_encode(['error' => 'Database connection failed']);
    exit;
}
?>
