<?php
header('Content-Type: application/json');

// nkmr SSO: サーバ保存（アップロード）はログイン必須。閲覧(GET)は従来どおり公開。
require_once __DIR__ . '/nkmrauth.php';
function require_login() {
    $id = nkmrauth_identity();          // リダイレクトせず身元だけ確認
    if (!$id) {
        http_response_code(401);
        echo json_encode(['status' => 'error', 'message' => 'ログインが必要です（中村研アカウントでログインしてください）'], JSON_UNESCAPED_SLASHES);
        exit;
    }
    return $id;
}

$targetDir = __DIR__ . "/files/"; // 絶対パス推奨
if (!is_dir($targetDir)) {
    mkdir($targetDir, 0755, true);
}

const MAX_JSON_BYTES  = 10_000_000;   // 10MB
const MAX_PDF_BYTES   = 50_000_000;  // 25MB
const MAX_AUDIO_BYTES = 100_000_000;  // 100MB（必要に応じて）

function json_error($msg, $code = 400) {
    http_response_code($code);
    echo json_encode(['status' => 'error', 'message' => $msg], JSON_UNESCAPED_SLASHES);
    exit;
}

function generateUUIDv4() {
    $data = random_bytes(16);
    $data[6] = chr((ord($data[6]) & 0x0f) | 0x40);
    $data[8] = chr((ord($data[8]) & 0x3f) | 0x80);
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));
}

function is_valid_uuid($uuid) {
    return is_string($uuid) && preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', $uuid);
}

function safe_path($dir, $uuid, $ext) {
    // uuidチェック済みを前提。パストラバーサルを完全に殺す
    return $dir . $uuid . '.' . $ext;
}

function file_exists_for_uuid($dir, $uuid) {
    return file_exists(safe_path($dir, $uuid, 'pdf'));
}

// 所有者メタは Web 非公開の meta/ に置く（files/ は直アクセス可なのでメール流出を防ぐ）。
function meta_dir() {
    $d = __DIR__ . '/meta/';
    if (!is_dir($d)) {
        @mkdir($d, 0755, true);
        @file_put_contents($d . '.htaccess', "Require all denied\n");
    }
    return $d;
}
function owner_path($uuid) { return meta_dir() . $uuid . '.json'; }
// メタ書き込み：一時ファイル→rename（meta/ は777なので所有者が違っても置換できる）。
// CLI(nakamura)とWeb(apache)が混在してもお互いのファイルを上書きできるようにする。
function meta_put($path, $content) {
    $tmp = $path . '.tmp' . getmypid();
    if (@file_put_contents($tmp, $content, LOCK_EX) === false) return false;
    if (@rename($tmp, $path)) return true;
    @unlink($tmp);
    return false;
}
function read_owner($uuid) {
    $p = owner_path($uuid);
    if (!is_file($p)) return null;
    $j = json_decode(@file_get_contents($p), true);
    return is_array($j) ? $j : null;
}
function write_owner($uuid, $me, $title = '') {
    meta_put(owner_path($uuid), json_encode([
        'email'   => $me['email'] ?? '',
        'name'    => $me['name'] ?? '',
        'title'   => $title,
        'created' => gmdate('c'),
    ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
}
// 削除可否：ログイン中 && (自分が所有者 || 所有者未記録の旧データ)。
function can_delete($uuid, $me) {
    if (!$me) return false;
    $o = read_owner($uuid);
    if (!$o) return true;   // 所有者未記録（旧データ）はログインしていれば可
    return isset($o['email']) && hash_equals((string)$o['email'], (string)($me['email'] ?? ''));
}
// uuid に紐づく全ファイルを削除。
function delete_uuid_files($dir, $uuid) {
    foreach (['pdf', 'json', 'm4a'] as $ext) {
        $p = safe_path($dir, $uuid, $ext);
        if (is_file($p)) @unlink($p);
    }
    $op = owner_path($uuid);
    if (is_file($op)) @unlink($op);
    $wf = meta_dir() . $uuid . '.whisper.json';   // 文字起こしキャッシュも消す
    if (is_file($wf)) @unlink($wf);
}

// 現在のユーザーが所有する校正の一覧（新しい順）。meta/{uuid}.json を走査。
function list_my_reviews($filesDir, $me) {
    $meEmail = strtolower(trim($me['email'] ?? ''));
    $items = [];
    $metaDir = meta_dir();
    foreach (@scandir($metaDir) ?: [] as $fn) {
        if (!preg_match('/^([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.json$/i', $fn, $m)) continue;
        $o = json_decode(@file_get_contents($metaDir . $fn), true);
        if (!is_array($o)) continue;
        if (strtolower(trim($o['email'] ?? '')) !== $meEmail || $meEmail === '') continue;
        $u = $m[1];
        if (!is_file($filesDir . $u . '.pdf')) continue;   // 実体が無いものは除外
        $items[] = [
            'uuid'    => $u,
            'title'   => $o['title'] ?? '',
            'created' => $o['created'] ?? '',
            'hasAudio'=> is_file($filesDir . $u . '.m4a'),
        ];
    }
    usort($items, fn($a, $b) => strcmp($b['created'], $a['created']));
    return $items;
}

// 現在のユーザーに共有された（recipients に含まれる）校正の一覧。自分所有は除外。
function list_shared_reviews($filesDir, $me) {
    $meUser  = $me['user'] ?? '';
    $meEmail = strtolower(trim($me['email'] ?? ''));
    if ($meUser === '') return [];
    $items = [];
    $metaDir = meta_dir();
    foreach (@scandir($metaDir) ?: [] as $fn) {
        if (!preg_match('/^([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.json$/i', $fn, $m)) continue;
        $o = json_decode(@file_get_contents($metaDir . $fn), true);
        if (!is_array($o)) continue;
        $recips = is_array($o['recipients'] ?? null) ? $o['recipients'] : [];
        if (!in_array($meUser, $recips, true)) continue;
        if (strtolower(trim($o['email'] ?? '')) === $meEmail) continue;   // 自分所有は items 側
        $u = $m[1];
        if (!is_file($filesDir . $u . '.pdf')) continue;
        $items[] = [
            'uuid'    => $u,
            'title'   => $o['title'] ?? '',
            'created' => $o['created'] ?? '',
            'owner'   => $o['name'] ?? '',
            'hasAudio'=> is_file($filesDir . $u . '.m4a'),
        ];
    }
    usort($items, fn($a, $b) => strcmp($b['created'], $a['created']));
    return $items;
}

// OpenAI キー（サーバのみの config.local.php）
function read_openai_key() {
    $cfg = __DIR__ . '/config.local.php';
    if (is_file($cfg)) { $c = require $cfg; if (is_array($c)) return $c['openai_key'] ?? ''; }
    return '';
}

// 所有者meta のタイトルだけ更新（他フィールドは温存）
function update_owner_title($uuid, $title) {
    $p = owner_path($uuid);
    $o = is_file($p) ? json_decode(@file_get_contents($p), true) : null;
    if (!is_array($o)) $o = [];
    $o['title'] = $title;
    meta_put($p, json_encode($o, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
}

// 1ページ目テキストから文書タイトルを抽出（失敗時は空文字）
function openai_extract_title($text) {
    $text = trim((string)$text);
    if ($text === '') return '';
    $key = read_openai_key();
    if ($key === '') return '';

    $payload = [
        'model'       => 'gpt-4o-mini',
        'temperature' => 0,
        'max_tokens'  => 80,
        'messages'    => [
            ['role' => 'system', 'content' => 'あなたは文書のメタデータ抽出器です。与えられた1ページ目のテキストから、その文書（論文・レポート等）のタイトルだけを1行で返してください。前置き・引用符・説明は不要。タイトルが判別できなければ空文字を返してください。'],
            ['role' => 'user', 'content' => mb_substr($text, 0, 4000)],
        ],
    ];
    $ch = curl_init('https://api.openai.com/v1/chat/completions');
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $key, 'Content-Type: application/json'],
        CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 30,
    ]);
    $resp = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($resp === false || $code < 200 || $code >= 300) return '';

    $d = json_decode($resp, true);
    $t = $d['choices'][0]['message']['content'] ?? '';
    $t = trim(preg_replace('/\s+/u', ' ', (string)$t));
    $t = trim($t, "\"'「」 　");
    return mb_substr($t, 0, 200);
}

function sniff_pdf($tmpPath) {
    $fh = fopen($tmpPath, 'rb');
    if (!$fh) return false;
    $head = fread($fh, 5);
    fclose($fh);
    return $head === "%PDF-";
}

function finfo_mime($tmpPath) {
    $finfo = new finfo(FILEINFO_MIME_TYPE);
    return $finfo->file($tmpPath) ?: '';
}

function require_same_origin_if_possible() {
    // 最低限。Origin が取れないケースもあるので厳格にはしない。
    if (!empty($_SERVER['HTTP_ORIGIN'])) {
        $origin = $_SERVER['HTTP_ORIGIN'];
        $host = (isset($_SERVER['HTTPS']) ? 'https://' : 'http://') . $_SERVER['HTTP_HOST'];
        if (stripos($origin, $host) !== 0) {
            json_error('Forbidden origin', 403);
        }
    }
}

require_same_origin_if_possible();

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'POST') {

    // ---- 1) JSON保存（raw JSON: {uuid, data}）----
    $contentType = $_SERVER['CONTENT_TYPE'] ?? '';
    if (stripos($contentType, 'application/json') !== false) {
        $me = require_login();
        $raw = file_get_contents('php://input', false, null, 0, MAX_JSON_BYTES + 1);
        if ($raw === false) json_error('Failed to read request body');
        if (strlen($raw) > MAX_JSON_BYTES) json_error('JSON too large');

        $input = json_decode($raw, true);
        if (!is_array($input)) json_error('Invalid JSON payload');

        // ---- 1a) 削除（{action:'delete', uuid}）----
        if (($input['action'] ?? '') === 'delete') {
            $uuid = $input['uuid'] ?? '';
            if (!is_valid_uuid($uuid)) json_error('Invalid uuid');
            if (!can_delete($uuid, $me)) json_error('削除する権限がありません（作成者のみ削除できます）', 403);
            delete_uuid_files($targetDir, $uuid);
            echo json_encode(['status' => 'success']);
            exit;
        }

        // ---- 1c) 共有相手の設定（{action:'recipients', uuid, recipients:[username]}）----
        if (($input['action'] ?? '') === 'recipients') {
            $uuid = $input['uuid'] ?? '';
            if (!is_valid_uuid($uuid)) json_error('Invalid uuid');
            $owner = read_owner($uuid);
            $amOwner = is_array($owner) && strtolower(trim($me['email'] ?? '')) === strtolower(trim($owner['email'] ?? '')) && ($owner['email'] ?? '') !== '';
            if (!$amOwner) json_error('作成者のみ設定できます', 403);

            $clean = [];
            foreach ((array)($input['recipients'] ?? []) as $r) {
                $r = trim((string)$r);
                if ($r !== '' && preg_match('/^[A-Za-z0-9_.-]{1,64}$/', $r)) $clean[] = $r;
            }
            $clean = array_values(array_unique($clean));
            $owner['recipients'] = $clean;
            meta_put(owner_path($uuid), json_encode($owner, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
            echo json_encode(['status' => 'success', 'recipients' => $clean], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            exit;
        }

        // ---- 1b) タイトル抽出（{action:'title', uuid, text}）----
        if (($input['action'] ?? '') === 'title') {
            $uuid = $input['uuid'] ?? '';
            if (!is_valid_uuid($uuid)) json_error('Invalid uuid');
            if (!can_delete($uuid, $me)) json_error('権限がありません', 403);   // 作成者のみ
            $title = openai_extract_title($input['text'] ?? '');
            if ($title !== '') update_owner_title($uuid, $title);
            echo json_encode(['status' => 'success', 'title' => $title], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            exit;
        }

        if (!isset($input['uuid']) || !isset($input['data'])) {
            json_error('Invalid JSON payload');
        }

        $uuid = $input['uuid'];
        if (!is_valid_uuid($uuid)) json_error('Invalid uuid');

        // ★重要：PDFが存在するuuidのみ保存を許可
        if (!file_exists_for_uuid($targetDir, $uuid)) json_error('Unknown uuid (pdf not found)', 403);

        // data は「文字列(JSONテキスト)」を想定
        $data = $input['data'];
        if (!is_string($data)) json_error('data must be string');

        if (strlen($data) > MAX_JSON_BYTES) json_error('data too large');

        $jsonFile = safe_path($targetDir, $uuid, 'json');

        // 既存上書き可ならLOCKで安全に
        $ok = file_put_contents($jsonFile, $data, LOCK_EX);
        if ($ok === false) json_error('Failed to save data', 500);

        echo json_encode(['status' => 'success']);
        exit;
    }

    // ---- 2) 音声アップロード（multipart: uuid + audio）----
    if (isset($_POST['uuid']) && isset($_FILES['audio']) && $_FILES['audio']['error'] === UPLOAD_ERR_OK) {
        require_login();
        $uuid = $_POST['uuid'];
        if (!is_valid_uuid($uuid)) json_error('Invalid uuid');

        // ★重要：PDFが存在するuuidのみアップロードを許可
        if (!file_exists_for_uuid($targetDir, $uuid)) json_error('Unknown uuid (pdf not found)', 403);

        if ($_FILES['audio']['size'] > MAX_AUDIO_BYTES) json_error('Audio too large');

        $tmp = $_FILES['audio']['tmp_name'];
        $mime = finfo_mime($tmp);

        // 許可mime（ざっくり）
        $allowed = [
            'audio/mp4',  // m4a
            'video/mp4',  // iOSでvideo/mp4になる場合
            'audio/webm',
            'audio/ogg',
            'application/octet-stream', // 端末によってはこれになるので許可しつつ拡張子で判定
        ];
        if (!in_array($mime, $allowed, true)) {
            json_error('Unsupported audio type: ' . $mime, 415);
        }

        // 拡張子は固定（フロントは m4a 想定なのでここは m4a に寄せる）
        // もし webm/ogg を使うなら、POSTで ext を送らせて whitelist で分岐
        $targetAudio = safe_path($targetDir, $uuid, 'm4a');

        if (!move_uploaded_file($tmp, $targetAudio)) json_error('Failed to upload audio', 500);

        echo json_encode(['status' => 'success', 'audio' => 'files/' . $uuid . '.m4a', 'mime' => $mime]);
        exit;
    }

    // ---- 3) PDFアップロード（multipart: file）----
    if (isset($_FILES['file']) && $_FILES['file']['error'] === UPLOAD_ERR_OK) {
        $me = require_login();

        if ($_FILES['file']['size'] > MAX_PDF_BYTES) json_error('PDF too large');

        $tmp = $_FILES['file']['tmp_name'];

        // 実体チェック（最重要）
        if (!sniff_pdf($tmp)) json_error('Not a PDF', 415);

        $uuid = generateUUIDv4();
        $targetFile = safe_path($targetDir, $uuid, 'pdf');

        if (!move_uploaded_file($tmp, $targetFile)) json_error('Failed to upload file', 500);

        // タイトル＝アップロードされた元ファイル名（履歴表示用）
        $title = '';
        if (isset($_FILES['file']['name'])) {
            $title = preg_replace('/[\x00-\x1f]/', '', (string)$_FILES['file']['name']);
            $title = mb_substr(basename($title), 0, 200);
        }

        // 作成時に所有者を記録（本人だけが削除できるように）
        write_owner($uuid, $me, $title);

        echo json_encode(['uuid' => $uuid]);
        exit;
    }

    json_error('Invalid request or file upload error', 400);
}

// ---- GET: 自分の履歴一覧（ログイン必須）----
if ($method === 'GET' && ($_GET['action'] ?? '') === 'mine') {
    $me = require_login();
    echo json_encode([
        'status' => 'success',
        'items'  => list_my_reviews($targetDir, $me),      // 自分が作った
        'shared' => list_shared_reviews($targetDir, $me),  // 自分に共有された
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

// ---- GET: 研究室メンバー一覧（共有相手ピッカー用）。CORS回避で auth へサーバ中継 ----
if ($method === 'GET' && ($_GET['action'] ?? '') === 'roster') {
    require_login();
    $tok = $_COOKIE['NKMRID'] ?? '';
    $ch = curl_init('https://auth.nkmr.io/?action=roster');
    curl_setopt_array($ch, [
        CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $tok],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 6,
    ]);
    $r = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($r === false || $code < 200 || $code >= 300) json_error('メンバー一覧を取得できませんでした', 502);
    echo $r;   // auth の JSON をそのまま返す
    exit;
}

// ---- GET: uuid で取得 ----
if ($method === 'GET' && isset($_GET['uuid'])) {
    $uuid = $_GET['uuid'];
    if (!is_valid_uuid($uuid)) json_error('Invalid uuid', 400);

    $pdfFile   = safe_path($targetDir, $uuid, 'pdf');
    $jsonFile  = safe_path($targetDir, $uuid, 'json');
    $audioFile = safe_path($targetDir, $uuid, 'm4a');

    if (file_exists($pdfFile) && file_exists($jsonFile)) {
        // ---- アクセス制御：recipients 指定時は 本人＋指定相手のみ（空なら公開）----
        $me = nkmrauth_identity();
        $owner = read_owner($uuid);
        $recipients = (is_array($owner) && is_array($owner['recipients'] ?? null)) ? $owner['recipients'] : [];
        $isOwner = ($me && is_array($owner) && strtolower(trim($me['email'] ?? '')) === strtolower(trim($owner['email'] ?? '')) && ($owner['email'] ?? '') !== '');
        if (!empty($recipients)) {
            $allowed = $isOwner || ($me && in_array($me['user'] ?? '', $recipients, true));
            if (!$allowed) {
                json_error($me ? 'この校正の閲覧権限がありません（作成者が指定した人のみ閲覧できます）' : 'この校正は限定公開です。中村研アカウントでログインしてください。', 403);
            }
        }

        $jsonData = file_get_contents($jsonFile);
        if ($jsonData === false) json_error('Failed to read session', 500);

        $resp = [
            'pdf' => 'files/' . $uuid . '.pdf',
            'annotations' => $jsonData
        ];
        if (file_exists($audioFile)) $resp['audio'] = 'files/' . $uuid . '.m4a';

        // ログイン中で、自分の校正（または所有者未記録の旧データ）なら削除可
        $resp['canDelete'] = can_delete($uuid, $me);
        $resp['isOwner'] = (bool)$isOwner;
        if ($isOwner) $resp['recipients'] = $recipients;   // 相手指定は作成者にだけ返す

        echo json_encode($resp, JSON_UNESCAPED_SLASHES);
        exit;
    }
    json_error('File not found', 404);
}

json_error('Invalid request', 400);
