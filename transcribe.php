<?php
// transcribe.php — OpenAI Whisper で音声を文字起こし（研究室ログイン限定）。
//   GET  ?uuid=...      : 既存の文字起こしを返す（無ければ has=false）
//   POST uuid=...       : 生成（キャッシュがあれば再利用）。whisper-1 / verbose_json / ja。
// 文字起こし結果は Web 非公開の meta/{uuid}.transcript.json に保存（外部共有では見せない）。
// APIキーは公開リポジトリに置かない → サーバのみの config.local.php から読む。
header('Content-Type: application/json');
require_once __DIR__ . '/nkmrauth.php';

// 研究室ログイン限定（未ログインは何も返さない）
$me = nkmrauth_identity();
if (!$me) {
    http_response_code(401);
    echo json_encode(['status' => 'error', 'message' => 'ログインが必要です'], JSON_UNESCAPED_UNICODE);
    exit;
}

function j_err($m, $c = 400) {
    http_response_code($c);
    echo json_encode(['status' => 'error', 'message' => $m], JSON_UNESCAPED_UNICODE);
    exit;
}
function is_valid_uuid($u) {
    return is_string($u) && preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', $u);
}

$filesDir = __DIR__ . '/files/';
$metaDir  = __DIR__ . '/meta/';
if (!is_dir($metaDir)) {
    @mkdir($metaDir, 0755, true);
    @file_put_contents($metaDir . '.htaccess', "Require all denied\n");
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$uuid = $_GET['uuid'] ?? ($_POST['uuid'] ?? '');
if (!is_valid_uuid($uuid)) j_err('Invalid uuid');

$transcriptFile = $metaDir . $uuid . '.transcript.json';

// ---- GET: 既存の文字起こし ----
if ($method === 'GET') {
    if (is_file($transcriptFile)) { echo file_get_contents($transcriptFile); exit; }
    echo json_encode(['status' => 'success', 'has' => false, 'segments' => []], JSON_UNESCAPED_UNICODE);
    exit;
}

// ---- POST: 生成 ----
if ($method === 'POST') {
    if (is_file($transcriptFile)) { echo file_get_contents($transcriptFile); exit; }  // キャッシュ

    // APIキー（サーバのみの config.local.php）
    $OPENAI_KEY = '';
    $cfg = __DIR__ . '/config.local.php';
    if (is_file($cfg)) { $c = require $cfg; if (is_array($c)) $OPENAI_KEY = $c['openai_key'] ?? ''; }
    if ($OPENAI_KEY === '') j_err('OpenAI APIキーが未設定です（サーバ管理者に config.local.php の設定を依頼してください）', 500);

    $audio = $filesDir . $uuid . '.m4a';
    if (!is_file($audio)) j_err('音声が見つかりません', 404);
    if (filesize($audio) > 25 * 1024 * 1024) j_err('音声が大きすぎます（Whisperの25MB上限）', 413);

    $ch = curl_init('https://api.openai.com/v1/audio/transcriptions');
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $OPENAI_KEY],
        CURLOPT_POSTFIELDS => [
            'file'            => new CURLFile($audio, 'audio/mp4', $uuid . '.m4a'),
            'model'           => 'whisper-1',
            'response_format' => 'verbose_json',
            'language'        => 'ja',
        ],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 300,
    ]);
    $resp = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $cerr = curl_error($ch);
    curl_close($ch);

    if ($resp === false) j_err('OpenAI接続に失敗: ' . $cerr, 502);
    if ($code < 200 || $code >= 300) j_err('文字起こしAPIエラー(HTTP ' . $code . '): ' . substr($resp, 0, 300), 502);

    $data = json_decode($resp, true);
    if (!is_array($data)) j_err('APIレスポンスの解析に失敗', 502);

    $segs = [];
    foreach (($data['segments'] ?? []) as $s) {
        $segs[] = [
            'start' => round((float)($s['start'] ?? 0), 2),
            'end'   => round((float)($s['end'] ?? 0), 2),
            'text'  => trim($s['text'] ?? ''),
        ];
    }

    $out = json_encode([
        'status'   => 'success',
        'has'      => true,
        'lang'     => $data['language'] ?? 'ja',
        'text'     => $data['text'] ?? '',
        'segments' => $segs,
        'by'       => $me['email'] ?? '',
        'created'  => gmdate('c'),
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

    @file_put_contents($transcriptFile, $out, LOCK_EX);
    echo $out;
    exit;
}

j_err('Invalid request');
