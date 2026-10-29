<?php
// labpay.php — LabPay 連携のサーバ側ヘルパー。api.php から require_once して使う。
//   作業中タスクは Web 非公開の meta/inreview/{review_id}_{reviewer_row_id}.json に保存。
//   依存（json_error / meta_dir / meta_put / local_config）は api.php 側の関数を実行時に参照する
//   （PHPの関数はトップレベルで巻き上げられるため、呼び出し時に解決される）。

function inreview_dir() {
    $d = meta_dir() . 'inreview/';
    if (!is_dir($d)) { @mkdir($d, 0777, true); @file_put_contents($d . '.htaccess', "Require all denied\n"); }
    return $d;
}

// pr↔LabPay サーバ間共通シークレット（config.local.php の pr_integration.shared_secret）
function read_pr_secret() {
    return (string)(local_config()['pr_integration']['shared_secret'] ?? '');
}
function verify_pr_secret() {
    $secret = read_pr_secret();
    if ($secret === '') json_error('連携シークレットが未設定です（サーバ管理者へ）', 503);
    if (!hash_equals($secret, (string)($_SERVER['HTTP_X_PR_SECRET'] ?? ''))) json_error('invalid secret', 401);
}

// Phase1: LabPay が reviewer の「受ける」で呼ぶ。作業中として登録（冪等）。
function handle_mark_in_review($input) {
    verify_pr_secret();
    $reviewId = (int)($input['review_id'] ?? 0);
    $rrId     = (int)($input['reviewer_row_id'] ?? 0);
    $email    = trim((string)($input['reviewer_email'] ?? ''));
    if ($reviewId <= 0 || $rrId <= 0 || $email === '') json_error('missing fields', 400);
    // pull_url / result_callback は pay.nkmr.io 限定
    foreach (['pull_url', 'result_callback'] as $k) {
        $h = strtolower((string)parse_url((string)($input[$k] ?? ''), PHP_URL_HOST));
        if ($h !== 'pay.nkmr.io') json_error("invalid $k host", 400);
    }
    $key = $reviewId . '_' . $rrId;
    $task = [
        'review_id' => $reviewId, 'reviewer_row_id' => $rrId,
        'reviewer_email' => $email, 'reviewer_name' => (string)($input['reviewer_name'] ?? ''),
        'requester_name' => (string)($input['requester_name'] ?? ''), 'title' => (string)($input['title'] ?? ''),
        'pull_url' => (string)($input['pull_url'] ?? ''), 'result_callback' => (string)($input['result_callback'] ?? ''),
        'cbt' => (string)($input['cbt'] ?? ''),   // ※§4.1に無いが、来れば結果返却に使う
        'accepted_at' => (string)($input['accepted_at'] ?? ''), 'created' => gmdate('c'), 'done' => false,
    ];
    meta_put(inreview_dir() . $key . '.json', json_encode($task, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    echo json_encode(['ok' => true, 'pr_task_id' => $key], JSON_UNESCAPED_SLASHES);
}

// Phase2: 自分の作業中タスク一覧
function list_inreview($me, $filesDir = null) {
    $meEmail = strtolower(trim($me['email'] ?? ''));
    if ($meEmail === '') return [];
    $items = [];
    $dir = inreview_dir();
    foreach (@scandir($dir) ?: [] as $fn) {
        if (!preg_match('/^([A-Za-z0-9_]+)\.json$/', $fn, $m)) continue;
        $t = json_decode(@file_get_contents($dir . $fn), true);
        if (!is_array($t) || !empty($t['done'])) continue;
        if (strtolower(trim($t['reviewer_email'] ?? '')) !== $meEmail) continue;
        // 受領したPDFコピーがあればそのサイズ（同一原稿の判別用）。無ければ null。
        $size = null;
        $src = (string)($t['source_pdf_uuid'] ?? '');
        if ($filesDir && $src !== '' && is_file($filesDir . $src . '.pdf')) $size = @filesize($filesDir . $src . '.pdf') ?: null;
        $items[] = ['key' => $m[1], 'title' => $t['title'] ?? '', 'requester' => $t['requester_name'] ?? '', 'accepted_at' => $t['accepted_at'] ?? ($t['created'] ?? ''), 'size' => $size];
    }
    usort($items, fn($a, $b) => strcmp($b['accepted_at'], $a['accepted_at']));
    return $items;
}

// 作業中タスク1件（本人のみ）。無ければ null。
function get_inreview($key, $me) {
    if (!preg_match('/^[A-Za-z0-9_]+$/', (string)$key)) return null;
    $p = inreview_dir() . $key . '.json';
    if (!is_file($p)) return null;
    $t = json_decode(@file_get_contents($p), true);
    if (!is_array($t)) return null;
    if (strtolower(trim($t['reviewer_email'] ?? '')) !== strtolower(trim($me['email'] ?? ''))) return null;
    return $t;
}

// pr内依頼のイベントを LabPay の汎用通知受け口 /api/incoming-notify へ送る（LabPay v1434）。
// LabPay側で in-app通知／本人Slack DM／#labpay ブロードキャストを行う。best-effort（未設定・失敗でも止めない）。
function notify_labpay($payload) {
    $c = local_config();
    $url = (string)($c['labpay_event_url'] ?? '');
    $secret = (string)($c['labpay_event_secret'] ?? '');
    if ($url === '' || $secret === '' || strtolower((string)parse_url($url, PHP_URL_HOST)) !== 'pay.nkmr.io') return;
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json; charset=utf-8',
            'Authorization: Bearer ' . $secret,
        ],
        CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 5,
        CURLOPT_CONNECTTIMEOUT => 4,
    ]);
    @curl_exec($ch);
    curl_close($ch);
}
