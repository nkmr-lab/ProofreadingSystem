<?php
// transcribe.php — OpenAI Whisper で音声を文字起こし（研究室ログイン限定）。
//   GET  ?uuid=...            : 既存の文字起こしを返す（無ければ has=false）
//   POST uuid=... [force=1]   : 生成。force が無ければキャッシュ再利用。
//
// ハルシネーション対策：Whisper の verbose_json が返す品質指標
//   - no_speech_prob（無発話確率）… 無音ハルシネーション
//   - avg_logprob（平均対数確率＝信頼度）… 低信頼な幻聴
//   - compression_ratio（圧縮率）… 高いほど同語反復（反復ハルシネーション）
// でセグメントを間引き、さらに連続重複を畳む。
// 生レスポンスは meta/{uuid}.whisper.json にキャッシュ → 閾値を変えても再課金なしで再適用。
// APIキーは公開リポジトリに置かない → サーバのみの config.local.php から読む。
header('Content-Type: application/json');
require_once __DIR__ . '/nkmrauth.php';

// 研究室ログイン限定
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

// ハルシネーション抑制のしきい値（Whisper既定に準拠。ボソボソ音声で本物を消しすぎない設定）
const NO_SPEECH_MAX  = 0.6;    // これ以上の無発話確率＋低信頼なら無音幻聴として捨てる
const LOGPROB_NOSPCH = -1.0;   // 無音判定の信頼度条件
const LOGPROB_MIN    = -1.2;   // これ未満は低信頼として単独で捨てる
const COMPRESS_MAX   = 2.4;    // これ以上は同語反復（反復ハルシネーション）として捨てる

function norm_text($t) {
    // 比較用に空白と句読点を除去（Whisper日本語は同一文でも間隔が揺れる）
    return preg_replace('/[\s、。・,.!?！？]+/u', '', $t);
}

// 生セグメント配列 → 表示用に間引き＆重複畳み込み
function filter_segments($raw) {
    $out = [];
    $recent = [];   // 直近で採用した正規化テキスト（反復検出用）
    foreach (($raw['segments'] ?? []) as $s) {
        $text = trim($s['text'] ?? '');
        if ($text === '') continue;

        $nsp = (float)($s['no_speech_prob']    ?? 0);
        $alp = (float)($s['avg_logprob']       ?? 0);
        $cr  = (float)($s['compression_ratio'] ?? 0);

        if ($nsp >= NO_SPEECH_MAX && $alp < LOGPROB_NOSPCH) continue; // 無音幻聴
        if ($cr  >= COMPRESS_MAX) continue;                            // 反復（高圧縮）
        if ($alp <  LOGPROB_MIN)  continue;                            // 低信頼

        $n = norm_text($text);
        if ($n === '') continue;
        // 直近2つと同一なら反復とみなして捨てる（AA/ABAB 反復を抑制）
        if (in_array($n, array_slice($recent, -2), true)) continue;

        $out[] = [
            'start' => round((float)($s['start'] ?? 0), 2),
            'end'   => round((float)($s['end'] ?? 0), 2),
            'text'  => $text,
        ];
        $recent[] = $n;
    }
    return $out;
}

function respond_from_raw($raw, $me) {
    echo json_encode([
        'status'   => 'success',
        'has'      => true,
        'lang'     => $raw['language'] ?? 'ja',
        'segments' => filter_segments($raw),
        'by'       => $me['email'] ?? '',
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
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

// recipients 制限を尊重（限定公開なら本人＋指定相手のみ文字起こし可）
$ownerFile = $metaDir . $uuid . '.json';
$owner = is_file($ownerFile) ? json_decode(@file_get_contents($ownerFile), true) : null;
$recips = (is_array($owner) && is_array($owner['recipients'] ?? null)) ? $owner['recipients'] : [];
if (!empty($recips)) {
    $isOwner = strtolower(trim($me['email'] ?? '')) === strtolower(trim($owner['email'] ?? '')) && ($owner['email'] ?? '') !== '';
    if (!$isOwner && !in_array($me['user'] ?? '', $recips, true)) j_err('閲覧権限がありません', 403);
}

$rawFile = $metaDir . $uuid . '.whisper.json';   // 生API応答のキャッシュ

// ---- GET: 既存があれば間引いて返す ----
if ($method === 'GET') {
    if (is_file($rawFile)) {
        $raw = json_decode(file_get_contents($rawFile), true);
        if (is_array($raw)) respond_from_raw($raw, $me);
    }
    echo json_encode(['status' => 'success', 'has' => false, 'segments' => []], JSON_UNESCAPED_UNICODE);
    exit;
}

// ---- POST: 生成（force が無ければキャッシュ再利用）----
if ($method === 'POST') {
    $force = !empty($_POST['force']);
    if (!$force && is_file($rawFile)) {
        $raw = json_decode(file_get_contents($rawFile), true);
        if (is_array($raw)) respond_from_raw($raw, $me);
    }

    $OPENAI_KEY = '';
    $cfg = __DIR__ . '/config.local.php';
    if (is_file($cfg)) { $c = require $cfg; if (is_array($c)) $OPENAI_KEY = $c['openai_key'] ?? ''; }
    if ($OPENAI_KEY === '') j_err('OpenAI APIキーが未設定です（サーバ管理者に config.local.php の設定を依頼してください）', 500);

    $audio = $filesDir . $uuid . '.m4a';
    if (!is_file($audio)) j_err('音声が見つかりません', 404);
    if (filesize($audio) > 25 * 1024 * 1024) j_err('音声が大きすぎます（Whisperの25MB上限）', 413);

    // ffmpeg 前処理：ボソボソ音声を持ち上げて認識精度を上げる（あれば使う・失敗しても原音で続行）。
    //   highpass=低域ノイズ除去 / speechnorm=発話音量の正規化 / 16kHz mono AAC（Whisperは16k想定）。
    //   長さは変わらないのでタイムスタンプはそのまま。
    $sendPath = $audio;
    $tmpNorm = null;
    $ff = '/usr/bin/ffmpeg';
    if (is_executable($ff)) {
        $tmpNorm = sys_get_temp_dir() . '/tr_' . $uuid . '_' . getmypid() . '.m4a';
        $cmd = escapeshellarg($ff) . ' -y -i ' . escapeshellarg($audio)
             . ' -ac 1 -ar 16000 -af ' . escapeshellarg('highpass=f=80,speechnorm=e=12.5:r=0.0001:l=1')
             . ' -c:a aac -b:a 64k ' . escapeshellarg($tmpNorm) . ' 2>/dev/null';
        @exec($cmd, $_o, $rc);
        if ($rc === 0 && is_file($tmpNorm) && filesize($tmpNorm) > 1000) {
            $sendPath = $tmpNorm;
        } else {
            if ($tmpNorm && is_file($tmpNorm)) @unlink($tmpNorm);
            $tmpNorm = null;
        }
    }

    $ch = curl_init('https://api.openai.com/v1/audio/transcriptions');
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $OPENAI_KEY],
        CURLOPT_POSTFIELDS => [
            'file'            => new CURLFile($sendPath, 'audio/mp4', $uuid . '.m4a'),
            'model'           => 'whisper-1',
            'response_format' => 'verbose_json',
            'language'        => 'ja',
            // temperature は送らない＝APIの temperature フォールバック（反復検出時に再デコード）に任せる
        ],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 300,
    ]);
    $resp = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $cerr = curl_error($ch);
    curl_close($ch);

    if ($tmpNorm && is_file($tmpNorm)) @unlink($tmpNorm);   // 正規化一時ファイルを掃除

    if ($resp === false) j_err('OpenAI接続に失敗: ' . $cerr, 502);
    if ($code < 200 || $code >= 300) j_err('文字起こしAPIエラー(HTTP ' . $code . '): ' . substr($resp, 0, 300), 502);

    $raw = json_decode($resp, true);
    if (!is_array($raw)) j_err('APIレスポンスの解析に失敗', 502);

    // 一時ファイル→rename（meta/は777, CLI/apacheの所有者混在でも置換可）
    $tmp = $rawFile . '.tmp' . getmypid();
    if (@file_put_contents($tmp, json_encode($raw, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), LOCK_EX) !== false) {
        if (!@rename($tmp, $rawFile)) @unlink($tmp);
    }
    respond_from_raw($raw, $me);
}

j_err('Invalid request');
