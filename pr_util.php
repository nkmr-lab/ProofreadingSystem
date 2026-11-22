<?php
// pr_util.php — api.php / transcribe.php 共用の小さなユーティリティ。
// 以前は両ファイルに is_valid_uuid が別定義で重複していたのを集約する。
// function_exists ガードで二重 require でも安全。
if (!function_exists('is_valid_uuid')) {
    // UUID v1〜v5 形式（RFC4122のバリアント）の厳密チェック。パストラバーサル対策の第一関門。
    function is_valid_uuid($u) {
        return is_string($u) && preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', $u);
    }
}
