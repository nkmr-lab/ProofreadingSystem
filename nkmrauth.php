<?php
/**
 * nkmrauth.php — nkmr 共通認証(SSO)クライアント。
 * 各アプリはこれを require し、先頭で nkmrauth_require() を呼ぶだけ。
 *  - .nkmr.io の署名クッキー(Ed25519)を「公開鍵で検証のみ」→ 身元を得る(秘密は持たない)。
 *  - 無効/無ければ auth.nkmr.io へリダイレクトし、認証後に元URLへ戻る。
 * これ1枚を置けば新しいアプリも SSO に乗る。
 */
if (!defined('NKMRAUTH_URL'))    define('NKMRAUTH_URL', 'https://auth.nkmr.io');
if (!defined('NKMRAUTH_COOKIE')) define('NKMRAUTH_COOKIE', 'NKMRID');
// auth.nkmr.io の Ed25519 公開鍵(base64)。配布して安全。
if (!defined('NKMRAUTH_PUBKEY')) define('NKMRAUTH_PUBKEY', 'nK1rEaUwR+ZCLCaS6eU8pdXeh6Zg0pPkarVg7fKz2HA=');

function nkmrauth_b64url_decode(string $s): string { return base64_decode(strtr($s, '-_', '+/')); }

/** 現在の身元を返す。無効なら null。['email','user','name','iat','exp'] */
function nkmrauth_identity(): ?array {
    $tok = $_COOKIE[NKMRAUTH_COOKIE] ?? '';
    if ($tok === '') return null;
    $parts = explode('.', $tok);
    if (count($parts) !== 2) return null;
    [$b, $s] = $parts;
    $sig = nkmrauth_b64url_decode($s);
    if (strlen($sig) !== SODIUM_CRYPTO_SIGN_BYTES) return null;
    if (!sodium_crypto_sign_verify_detached($sig, $b, base64_decode(NKMRAUTH_PUBKEY))) return null;
    $p = json_decode(nkmrauth_b64url_decode($b), true);
    if (!is_array($p) || (int)($p['exp'] ?? 0) < time()) return null;
    return $p;
}

/**
 * 利用ビーコン。どのアプリを使ったかを auth に記録(usage)。
 * 30分に1回だけ(nk_ping クッキーで抑制)・短タイムアウトで実質ノンブロッキング。
 */
function nkmrauth_ping(): void {
    if (($_COOKIE['nk_ping'] ?? '') !== '') return;   // 30分throttle
    $tok = $_COOKIE[NKMRAUTH_COOKIE] ?? '';
    if ($tok === '') return;
    if (!headers_sent()) {
        setcookie('nk_ping', '1', ['expires'=>time()+1800, 'path'=>'/', 'secure'=>true, 'httponly'=>true, 'samesite'=>'Lax']);
    }
    nkmrauth_send_event(['app'=>($_SERVER['HTTP_HOST'] ?? ''), 'token'=>$tok]);
}

/** 明示的な機能イベント(任意)。例: 保存時に nkmrauth_event('save')。 */
function nkmrauth_event(string $feature): void {
    $tok = $_COOKIE[NKMRAUTH_COOKIE] ?? '';
    if ($tok === '') return;
    nkmrauth_send_event(['app'=>($_SERVER['HTTP_HOST'] ?? ''), 'feature'=>$feature, 'token'=>$tok]);
}

function nkmrauth_send_event(array $fields): void {
    $ch = curl_init(NKMRAUTH_URL . '/?action=event');
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => http_build_query($fields),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT_MS => 400,
        CURLOPT_TIMEOUT_MS => 800,
    ]);
    @curl_exec($ch); @curl_close($ch);
}

/** 認証必須。身元を返す。無ければ auth へ飛ばして戻る。 */
function nkmrauth_require(): array {
    $id = nkmrauth_identity();
    if ($id) { nkmrauth_ping(); return $id; }
    $self = 'https://' . ($_SERVER['HTTP_HOST'] ?? '') . ($_SERVER['REQUEST_URI'] ?? '/');
    header('Location: ' . NKMRAUTH_URL . '/?action=sso&return=' . urlencode($self));
    exit;
}

/** ログアウトURL(このアプリのトップに戻す) */
function nkmrauth_logout_url(?string $return = null): string {
    $r = $return ?? ('https://' . ($_SERVER['HTTP_HOST'] ?? '') . '/');
    return NKMRAUTH_URL . '/?action=logout&return=' . urlencode($r);
}
