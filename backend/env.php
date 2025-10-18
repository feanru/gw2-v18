<?php
// backend/env.php
// Load environment variables from a .env file.
// Prefer a location outside the web root to avoid exposing secrets.
// Allow overriding the .env location via the ENV_PATH variable
$envFile = getenv('ENV_PATH');
if ($envFile === false || $envFile === '') {
    // One directory above the project root:
    $envFile = dirname(__DIR__, 2).'/.env';
    // If that file does not exist, fall back to the old location for
    // backwards compatibility.
    if (!is_readable($envFile)) {
        $envFile = dirname(__DIR__).'/.env';
    }
}
if (is_readable($envFile)) {
    $vars = parse_ini_file($envFile, false, INI_SCANNER_RAW);
    if ($vars !== false) {
        foreach ($vars as $key => $value) {
            if (getenv($key) === false) {
                putenv("$key=$value");
                $_ENV[$key] = $value;
                $_SERVER[$key] = $value;
            }
        }
    }
}
?>
