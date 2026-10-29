<?php
// pr_access.php — 認可（アクセス制御）ヘルパー。api.php / transcribe.php 共用。
//   is_owner             : 原稿/校正の作成者本人か
//   review_share_settings: 校正の共有設定 [recipients[], restricted]
//   can_view_review      : その校正を閲覧できるか（限定公開なら作成者＋指定相手のみ、他は公開）
//   is_requested_reviewer: その依頼のレビュアー本人か（チェック可能か）
if (!function_exists('is_owner')) {
    function is_owner($owner, $me) {
        if (!is_array($owner) || !$me) return false;
        $oe = strtolower(trim($owner['email'] ?? ''));
        return $oe !== '' && $oe === strtolower(trim($me['email'] ?? ''));
    }
}
function review_share_settings($owner) {
    $recips = (is_array($owner) && is_array($owner['recipients'] ?? null)) ? $owner['recipients'] : [];
    $restricted = (is_array($owner) && array_key_exists('restricted', $owner)) ? (bool)$owner['restricted'] : !empty($recips);
    return [$recips, $restricted];
}
function can_view_review($owner, $me) {
    list($recips, $restricted) = review_share_settings($owner);
    if (empty($recips) || !$restricted) return true;      // 公開（リンクを知っていれば誰でも）
    if (is_owner($owner, $me)) return true;               // 作成者
    return $me && in_array($me['user'] ?? '', $recips, true);   // 指定相手
}
function is_requested_reviewer($owner, $me) {
    if (!is_array($owner) || !isset($owner['review_request']['reviewers'])) return false;
    $u = $me['user'] ?? '';
    return $u !== '' && isset($owner['review_request']['reviewers'][$u]);
}
