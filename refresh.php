<?php
/**
 * Script de limpieza de caché / actualización de versión (seguro y JSON-first)
 * -----------------------------------------------------------------------------
 * • Requiere POST con Content-Type: application/json y clave en el body: {"key":"..."}
 * • La clave se carga desde un archivo externo fuera de public_html (.refresh-secret.php)
 * • Valida la clave (sin valor por defecto embebido)
 * • Limpia directorios de caché con límites por realpath
 * • Reinicia OPcache si está habilitado
 * • Actualiza version.txt (cache-busting)
 * • Devuelve JSON con resultado, advertencias y métricas
 * • Rate limiting básico opcional
 */

 // ---------- Configuración ----------
$CACHE_DIRS = [
    __DIR__ . '/backend/cache',
    // __DIR__ . '/otra/ruta/de/cache',
];
$RATE_LIMIT_SECONDS = 10;                 // 0 para desactivar rate limiting
$RATE_LIMIT_FILE    = __DIR__ . '/.refresh.lock';
$VERSION_FILE       = __DIR__ . '/version.txt';

// ---------- Utilidades ----------
function respond_json(int $status, array $payload): void {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
    header('Pragma: no-cache');
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

function safe_unlink(string $path, array &$errors): bool {
    if (@unlink($path)) return true;
    @chmod($path, 0664);
    if (@unlink($path)) return true;
    $errors[] = "No se pudo borrar archivo: $path";
    return false;
}

function safe_rmdir(string $path, array &$errors): bool {
    if (@rmdir($path)) return true;
    @chmod($path, 0775);
    if (@rmdir($path)) return true;
    $errors[] = "No se pudo borrar directorio: $path";
    return false;
}

// ---------- Requisitos de método y tipo de contenido ----------
$method = $_SERVER['REQUEST_METHOD'] ?? '';
if ($method !== 'POST') {
    header('Allow: POST');
    respond_json(405, ['ok' => false, 'error' => 'Método no permitido; usa POST']);
}

$contentType = $_SERVER['CONTENT_TYPE'] ?? '';
if (stripos($contentType, 'application/json') !== 0) {
    respond_json(415, ['ok' => false, 'error' => 'Content-Type debe ser application/json']);
}

// ---------- Cargar secreto desde archivo externo (fuera del webroot) ----------
/**
 * CREA este archivo en: /home/TU_USUARIO/.refresh-secret.php (fuera de public_html)
 * Contenido del archivo:
 *   <?php
 *   putenv('GW2_REFRESH_SECRET=TU_CLAVE_SECRETA');
 *
 * Ajusta la ruta si tu refresh.php no está en public_html/
 *   - Si está en public_html/api/ => __DIR__ . '/../../.refresh-secret.php'
 *   - Si está en public_html/backend/tools/ => cuenta los niveles necesarios
 */
$external = __DIR__ . '/../.refresh-secret.php';
if (is_readable($external)) {
    include $external; // ejecuta putenv() con la clave
}

// ---------- Autenticación por clave ----------
$secret = getenv('GW2_REFRESH_SECRET')
       ?: ($_SERVER['GW2_REFRESH_SECRET'] ?? $_SERVER['REDIRECT_GW2_REFRESH_SECRET'] ?? '');

if (!$secret) {
    respond_json(500, ['ok' => false, 'error' => 'Clave de actualización no configurada (GW2_REFRESH_SECRET)']);
}

$body = file_get_contents('php://input');
$input = json_decode($body ?: 'null', true);
$key = is_array($input) && isset($input['key']) ? (string)$input['key'] : '';
if ($key === '' || !hash_equals($secret, $key)) {
    respond_json(403, ['ok' => false, 'error' => 'Acceso denegado']);
}

// ---------- Rate limiting básico (opcional) ----------
if ($RATE_LIMIT_SECONDS > 0) {
    $now = time();
    $last = @file_exists($RATE_LIMIT_FILE) ? (int)@file_get_contents($RATE_LIMIT_FILE) : 0;
    if ($last && ($now - $last) < $RATE_LIMIT_SECONDS) {
        respond_json(429, [
            'ok' => false,
            'error' => 'Demasiadas solicitudes; intenta más tarde',
            'retry_after_seconds' => $RATE_LIMIT_SECONDS - ($now - $last),
        ]);
    }
    @file_put_contents($RATE_LIMIT_FILE, (string)$now, LOCK_EX);
}

// ---------- Preparar ejecución larga ----------
@set_time_limit(60);
@ignore_user_abort(true);

$basePath = realpath(__DIR__);
$errors = [];
$deletedFiles = 0;
$deletedDirs  = 0;

// ---------- Limpieza de cachés ----------
// ---------- Limpieza de cachés ----------
foreach ($CACHE_DIRS as $dir) {
    // Si el directorio no existe, lo ignoramos sin marcar error
    if (!is_dir($dir)) {
        continue;
    }

    $realDir = realpath($dir);
    if ($realDir === false) {
        $errors[] = "No se pudo resolver la ruta: $dir";
        continue;
    }

    // Seguridad: el directorio debe estar dentro del proyecto
    if ($basePath && strpos($realDir, $basePath) !== 0) {
        $errors[] = "Ruta fuera del proyecto: $dir";
        continue;
    }

    $it = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($realDir, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::CHILD_FIRST
    );

    foreach ($it as $file) {
        $path = $file->getPathname();
        if ($file->isLink()) {
            if (safe_unlink($path, $errors)) $deletedFiles++;
            continue;
        }
        if ($file->isDir()) {
            if (safe_rmdir($path, $errors)) $deletedDirs++;
        } else {
            if (safe_unlink($path, $errors)) $deletedFiles++;
        }
    }
}


// ---------- Reiniciar OPcache si está disponible ----------
$opcacheReset = null;
if (function_exists('opcache_reset')) {
    $opcacheReset = @opcache_reset();
    if ($opcacheReset === false) {
        $errors[] = 'opcache_reset() no se pudo completar (o no hay OPcache activo).';
    }
}

// ---------- Actualizar versión de assets ----------
$versionValue = (string)time();
if (@file_put_contents($VERSION_FILE, $versionValue, LOCK_EX) === false) {
    $errors[] = 'No se pudo escribir version.txt';
}

// ---------- Construir respuesta ----------
$ok = empty($errors);
if (!$ok) {
    error_log('Refresh con advertencias: ' . implode('; ', $errors));
}

respond_json($ok ? 200 : 207, [
    'ok' => $ok,
    'errors' => $errors,
    'metrics' => [
        'deleted_files' => $deletedFiles,
        'deleted_dirs'  => $deletedDirs,
        'opcache_reset' => $opcacheReset,
    ],
    'version' => $versionValue,
]);

// ---------- Autoeliminarse tras ejecutarse (opcional) ----------
// @unlink(__FILE__);
