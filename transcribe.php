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
require_once __DIR__ . '/config_util.php';   // local_config()（api.phpと共用）

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
        'engine'   => 'whisper',
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

// ===== 案C ハイブリッド：whisperのセグメント時刻 ＋ gpt-4o-transcribe の高精度本文 =====
// セグメントごとにローカルアライメント（線形）で gpt 本文を割り当てる。長尺でもメモリ安全。
// whisperの幻聴セグメント（「ご視聴ありがとう」「反復」等）は gpt 本文に対応が無く空になる→落ちる。

// Ws（whisperセグメントの文字列）を win（gptの窓）の先頭から整列し、Wsを全消費したときの
// 窓側の最良終端インデックスを返す（match+2/mismatch-1/gap-1、窓の末尾ギャップは無料）。
function local_align_end($Ws, $win) {
    $L = count($Ws); $M = count($win);
    if ($L === 0 || $M === 0) return 0;
    $prev = [];
    for ($j = 0; $j <= $M; $j++) $prev[$j] = -$j;      // dp[0][j]：Ws未消費で窓をj個スキップ
    for ($i = 1; $i <= $L; $i++) {
        $cur = [0 => -$i];
        $wi = $Ws[$i-1];
        for ($j = 1; $j <= $M; $j++) {
            $s = ($wi === $win[$j-1]) ? 2 : -1;
            $diag = $prev[$j-1] + $s;
            $up   = $prev[$j] - 1;
            $left = $cur[$j-1] - 1;
            $mx = $diag; if ($up > $mx) $mx = $up; if ($left > $mx) $mx = $left;
            $cur[$j] = $mx;
        }
        $prev = $cur;
    }
    $best = $prev[0]; $bj = 0;
    for ($j = 1; $j <= $M; $j++) { if ($prev[$j] >= $best) { $best = $prev[$j]; $bj = $j; } }
    return $bj;
}

function build_hybrid($raw, $gptText) {
    $segs = $raw['segments'] ?? [];
    $Gall = preg_split('//u', (string)$gptText, -1, PREG_SPLIT_NO_EMPTY);
    $G = count($Gall);
    if ($G === 0) return [];

    // (1) 各 gpt 文字に whisper セグメント由来の時刻を割り当てる（セグメント単位ローカル整列）
    $charTime = array_fill(0, $G, 0.0);
    $gpos = 0; $ns = count($segs); $lastT = 0.0;
    foreach ($segs as $idx => $sg) {
        if ($gpos >= $G) break;
        $wtext = preg_replace('/\s+/u', '', (string)($sg['text'] ?? ''));
        $Ws = preg_split('//u', $wtext, -1, PREG_SPLIT_NO_EMPTY);
        $L = count($Ws);
        if ($L === 0) continue;
        $isLast = ($idx === $ns - 1);
        $wlen = $isLast ? ($G - $gpos) : min($G - $gpos, $L * 2 + 40);
        $win = array_slice($Gall, $gpos, $wlen);
        $j = local_align_end($Ws, $win);
        $t = round((float)($sg['start'] ?? 0), 2);
        for ($k = $gpos; $k < $gpos + $j; $k++) $charTime[$k] = $t;
        $gpos += $j;
        $lastT = $t;
    }
    for ($k = $gpos; $k < $G; $k++) $charTime[$k] = $lastT;   // 余り
    // 時刻を単調増加に補正（整列のゆらぎで前後しても戻さない）
    $mx = 0.0;
    for ($k = 0; $k < $G; $k++) { if ($charTime[$k] < $mx) $charTime[$k] = $mx; else $mx = $charTime[$k]; }

    // (2) gpt 本文を文単位で区切る（単語途中で切らない）。長すぎる文は読点でも分ける。
    $out = [];
    $buf = ''; $bufStart = null; $bufEnd = 0.0;
    for ($k = 0; $k < $G; $k++) {
        $ch = $Gall[$k];
        if ($bufStart === null) $bufStart = $charTime[$k];
        $buf .= $ch;
        $bufEnd = $charTime[$k];
        $isEnd  = preg_match('/[。！？!?\n]/u', $ch);
        $soft   = (mb_strlen($buf) >= 60 && preg_match('/[、]/u', $ch));
        if ($isEnd || $soft) {
            $t = trim($buf);
            if ($t !== '') $out[] = ['start' => $bufStart, 'end' => $bufEnd, 'text' => $t];
            $buf = ''; $bufStart = null;
        }
    }
    if (trim($buf) !== '') $out[] = ['start' => $bufStart ?? $lastT, 'end' => $bufEnd, 'text' => trim($buf)];
    return $out;
}

function respond_from_hybrid($raw, $gptText, $me) {
    echo json_encode([
        'status'   => 'success',
        'has'      => true,
        'lang'     => $raw['language'] ?? 'ja',
        'segments' => build_hybrid($raw, $gptText),
        'by'       => $me['email'] ?? '',
        'engine'   => 'hybrid',
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

// gpt-4o-transcribe の単発呼び出し（本文を返す。失敗時は''）。
function tr_gpt_one($path, $key, $prompt){
    $ch = curl_init('https://api.openai.com/v1/audio/transcriptions');
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $key],
        CURLOPT_POSTFIELDS => ['file'=>new CURLFile($path,'audio/mp4',basename($path)),'model'=>'gpt-4o-transcribe','response_format'=>'json','language'=>'ja','prompt'=>$prompt],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 300,
    ]);
    $r = curl_exec($ch); $c = curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
    if ($c >= 200 && $c < 300){ $d = json_decode((string)$r, true); if (is_array($d)) return trim((string)($d['text'] ?? '')); }
    return '';
}
// gpt-4o-transcribe で本文を得る。★生音声を使う（speechnorm正規化は静かな音声でgptを劣化させるため）。
// ★gpt-4o系は約25分(1500秒)が上限なので、超える音声はチャンク分割して結合する。
function tr_gpt_text($audio, $key, $prompt){
    $dur = 0.0;
    $o = @shell_exec('/usr/bin/ffprobe -v error -show_entries format=duration -of csv=p=0 ' . escapeshellarg($audio) . ' 2>/dev/null');
    $dur = (float)trim((string)$o);
    $CHUNK = 1400;
    if ($dur <= 0 || $dur <= $CHUNK) return tr_gpt_one($audio, $key, $prompt);
    $n = (int)ceil($dur / $CHUNK);
    $parts = [];
    for ($i = 0; $i < $n; $i++){
        $ss = $i * $CHUNK;
        $tmp = sys_get_temp_dir() . '/gptc_' . getmypid() . '_' . $i . '.m4a';
        $cmd = '/usr/bin/ffmpeg -y -ss ' . $ss . ' -t ' . $CHUNK . ' -i ' . escapeshellarg($audio)
             . ' -ac 1 -ar 16000 -c:a aac -b:a 64k ' . escapeshellarg($tmp) . ' 2>/dev/null';
        @exec($cmd, $oo, $rc);
        if ($rc === 0 && is_file($tmp)){ $t = tr_gpt_one($tmp, $key, $prompt); if ($t !== '') $parts[] = $t; @unlink($tmp); }
    }
    return implode("\n", $parts);
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
$restricted = (is_array($owner) && array_key_exists('restricted', $owner)) ? (bool)$owner['restricted'] : !empty($recips);
if (!empty($recips) && $restricted) {
    $isOwner = strtolower(trim($me['email'] ?? '')) === strtolower(trim($owner['email'] ?? '')) && ($owner['email'] ?? '') !== '';
    if (!$isOwner && !in_array($me['user'] ?? '', $recips, true)) j_err('閲覧権限がありません', 403);
}

$rawFile = $metaDir . $uuid . '.whisper.json';   // whisper 生応答のキャッシュ（時刻用）
$gptFile = $metaDir . $uuid . '.gpt.json';       // gpt-4o-transcribe 本文のキャッシュ（本文用）

// ---- GET: 既存があれば返す（両方あればハイブリッド、whisperのみなら旧方式）----
if ($method === 'GET') {
    if (is_file($rawFile)) {
        $raw = json_decode(file_get_contents($rawFile), true);
        $gpt = is_file($gptFile) ? json_decode(file_get_contents($gptFile), true) : null;
        if (is_array($raw) && is_array($gpt) && trim($gpt['text'] ?? '') !== '') respond_from_hybrid($raw, $gpt['text'], $me);
        if (is_array($raw)) respond_from_raw($raw, $me);   // gpt未生成の旧キャッシュはwhisperで
    }
    echo json_encode(['status' => 'success', 'has' => false, 'segments' => []], JSON_UNESCAPED_UNICODE);
    exit;
}

// ---- POST: 生成（force が無ければキャッシュ再利用）----
if ($method === 'POST') {
    $force = !empty($_POST['force']);
    if (!$force && is_file($rawFile)) {
        $raw = json_decode(file_get_contents($rawFile), true);
        $gpt = is_file($gptFile) ? json_decode(file_get_contents($gptFile), true) : null;
        if (is_array($raw) && is_array($gpt) && trim($gpt['text'] ?? '') !== '') respond_from_hybrid($raw, $gpt['text'], $me);
        if (is_array($raw)) respond_from_raw($raw, $me);
    }

    $cfg = local_config();
    $OPENAI_KEY = (string)($cfg['openai_key'] ?? '');
    $WHISPER_PROMPT = (string)($cfg['whisper_prompt'] ?? '');
    if ($OPENAI_KEY === '') j_err('OpenAI APIキーが未設定です（サーバ管理者に config.local.php の設定を依頼してください）', 500);
    // 語彙・句読点をバイアスして精度を上げるプロンプト（config.local.php の whisper_prompt で上書き可）。
    if ($WHISPER_PROMPT === '') {
        $WHISPER_PROMPT = '日本語の研究論文に対する校閲コメントの音声です。ヒューマンコンピュータインタラクション、ユーザインタフェース、ユーザビリティ、被験者、実験、評価、提案手法、関連研究などの専門用語や、カタカナ語・英単語・人名が含まれます。句読点を適切に付けてください。';
    }

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
            'prompt'          => $WHISPER_PROMPT,   // 語彙・句読点バイアスで精度向上
            // temperature は送らない＝APIの temperature フォールバック（反復検出時に再デコード）に任せる
        ],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 300,
    ]);
    $resp = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $cerr = curl_error($ch);
    curl_close($ch);

    // gpt-4o-transcribe（高精度本文）。★生音声から（speechnorm劣化回避）＋25分超はチャンク分割。失敗してもwhisperで続行。
    $gptText = tr_gpt_text($audio, $OPENAI_KEY, $WHISPER_PROMPT);

    if ($tmpNorm && is_file($tmpNorm)) @unlink($tmpNorm);   // 正規化一時ファイルを掃除

    if ($resp === false) j_err('OpenAI接続に失敗: ' . $cerr, 502);
    if ($code < 200 || $code >= 300) j_err('文字起こしAPIエラー(HTTP ' . $code . '): ' . substr($resp, 0, 300), 502);

    $raw = json_decode($resp, true);
    if (!is_array($raw)) j_err('APIレスポンスの解析に失敗', 502);

    // whisper 生応答をキャッシュ（時刻用）
    $tmp = $rawFile . '.tmp' . getmypid();
    if (@file_put_contents($tmp, json_encode($raw, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), LOCK_EX) !== false) {
        if (!@rename($tmp, $rawFile)) @unlink($tmp);
    }

    // gpt 本文をキャッシュ（取れた時のみ）。幻聴に強い高精度本文。
    if ($gptText !== '') {
        $gtmp = $gptFile . '.tmp' . getmypid();
        $gpayload = json_encode(['text' => $gptText, 'model' => 'gpt-4o-transcribe', 'generated' => gmdate('c')], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if (@file_put_contents($gtmp, $gpayload, LOCK_EX) !== false) {
            if (!@rename($gtmp, $gptFile)) @unlink($gtmp);
        }
        respond_from_hybrid($raw, $gptText, $me);   // 案C：高精度本文＋whisper時刻
    }

    // gpt が失敗したら whisper だけで返す（従来動作のフォールバック）
    respond_from_raw($raw, $me);
}

j_err('Invalid request');
