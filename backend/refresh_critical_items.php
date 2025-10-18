#!/usr/bin/env php
<?php
// Script to warm cache for critical item IDs by hitting dataBundle.php and itemDetails.php.
// Logs request duration and any errors to refresh.log for monitoring.

$criticalIds = [19721, 19745, 19684]; // IDs to keep up to date
$baseUrl = getenv('CRON_BASE_URL') ?: 'http://localhost/backend/api';
$logFile = __DIR__ . '/refresh.log';

function logMessage(string $message): void {
    global $logFile;
    file_put_contents($logFile, '[' . date('c') . "] $message\n", FILE_APPEND);
}

function fetchUrl(string $url): void {
    $start = microtime(true);
    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 20);
    $response = curl_exec($ch);
    $error = curl_error($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    $duration = round((microtime(true) - $start) * 1000);
    if ($code !== 200) {
        logMessage("ERROR $code $url $error");
    } else {
        logMessage("OK $url {$duration}ms");
    }
}

logMessage('Start critical refresh');

if (!empty($criticalIds)) {
    $idsParam = implode(',', $criticalIds);
    fetchUrl("{$baseUrl}/dataBundle.php?ids={$idsParam}");
    foreach ($criticalIds as $id) {
        fetchUrl("{$baseUrl}/itemDetails.php?itemId={$id}");
    }
}

logMessage('End critical refresh');
