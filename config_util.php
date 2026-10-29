<?php
// config_util.php — サーバ限定設定 config.local.php を1度だけ読み込んで配列で返す共通関数。
// api.php と transcribe.php の両方から require_once して使う（読み込みの重複を排除）。
if (!function_exists('local_config')) {
    function local_config() {
        static $cfg = null;
        if ($cfg === null) {
            $p = __DIR__ . '/config.local.php';
            $c = is_file($p) ? require $p : null;
            $cfg = is_array($c) ? $c : [];
        }
        return $cfg;
    }
}
