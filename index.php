<?php
// /var/www/html/pen/pdf_audio/index.php
// nkmr SSO: 強制リダイレクトせず身元だけ確認する（未ログインでも公開ツールとして使える）。
require_once __DIR__ . '/nkmrauth.php';
$me = nkmrauth_identity();                 // ログイン済みなら ['email','name',...]、未ログインなら null
$self = 'https://' . ($_SERVER['HTTP_HOST'] ?? 'pr.nkmr.io') . ($_SERVER['REQUEST_URI'] ?? '/');
$loginUrl  = NKMRAUTH_URL . '/?action=sso&return=' . urlencode($self);
$logoutUrl = nkmrauth_logout_url();
?>
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <!-- ネイティブのページズーム(2本指)を無効化。PDF拡大はアプリ側(SVG変形)で行うので
         ページ全体がズームしてツールバーが画面外へ飛ぶ事故を防ぐ。 -->
    <meta name="viewport" content="width=device-width, height=device-height, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>PDF Checker</title>

    <link rel="stylesheet" href="styles.css">
    <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.9.359/pdf.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>
    <script type="module" src="main.js"></script>

    <link rel="manifest" href="./manifest.json">
    <meta name="theme-color" content="#ffffff">
</head>

<body id="bodyContent" data-checker="<?php echo isset($_GET['uuid']) ? '0' : '1'; ?>" data-loggedin="<?php echo $me ? '1' : '0'; ?>">
<div class="toolbar">
<input type="button" id='homeButton' class="btn btn--icon" onclick="location.href='/'" value="🏚️">
<button id="shareReview" class="btn btn--primary" style="display:none;">🔗 共有</button>
<button id="deleteReview" class="btn btn--danger" style="display:none;">🗑️削除</button>
<div id="speedButtons" class="speedButtons">
    再生速度：
    <button type="button" class="btn speedBtn" data-rate="1.0">×1.0</button>
    <button type="button" class="btn speedBtn" data-rate="1.2">×1.2</button>
    <button type="button" class="btn speedBtn" data-rate="1.5">×1.5</button>
    <button type="button" class="btn speedBtn" data-rate="2.0">×2.0</button>
</div>

<button id="skipSilence" class="btn speedBtn" title="喋っていない区間を自動で飛ばす" style="display:none;">⏭️ 無音スキップ</button>
<?php if ($me): // 文字起こしは研究室ログイン限定 ?>
<button id="genTranscript" class="btn btn--secondary" style="display:none;">📝 文字起こし</button>
<?php endif; ?>

<input type="file" id="file-input" class="hidden-file-input" />

<button id="prev-page" class="btn btn--neutral" disabled>＜前</button>
<button id="next-page" class="btn btn--neutral" disabled>次＞</button>

<button id="drawing-mode" class="btn btn--neutral" disabled>[描く] 消す</button>
<button id="undo" class="btn btn--neutral" disabled>戻す</button>

<div id="pdfControls">
<button id="file-select-button" class="btn btn--primary">PDF読込</button>
</div>

<?php if (!$me): // ZIP読込はローカル録音の外部共有用。中村研(ログイン)はサーバ保存なので不要 ?>
<div id="zipControls">
<button id="importZipBtn" class="btn btn--secondary">ZIP読込</button>
<input type="file" id="importZipInput" accept=".zip" style="display:none;">
</div>
<?php endif; ?>

<div id="inputModeBox">
<button class="input-toggle active" id="allowPen" data-mode="pen">Pen</button>
<button class="input-toggle active" id="allowTouch" data-mode="touch">Touch</button>
<button class="input-toggle active" id="allowMouse" data-mode="mouse">Mouse</button>
</div>

<!-- スマホ限定：1本指の用途を切替（PC/iPadでは非表示） -->
<div id="touchModeBox">
<button class="tmode" id="touchModeDraw">✍️手書き</button>
<button class="tmode" id="touchModeAuto">✨おまかせ</button>
<button class="tmode" id="touchModeMove">✋移動</button>
</div>

<button id="recordLocal" class="btn btn--success" disabled>● ローカル録音</button>
<button id="recordServer" class="btn btn--record" disabled>● サーバー録音</button>
<button id="recordPause" class="btn btn--neutral" disabled>⏸ 一時停止</button>
<button id="recordStop" class="btn btn--danger" disabled>■ 録音終了</button>

<?php if ($me): ?>
<span id="userBadge" class="user-badge">👤 <?php echo htmlspecialchars($me['name'] ?? $me['email'] ?? '', ENT_QUOTES); ?> <a href="<?php echo htmlspecialchars($logoutUrl, ENT_QUOTES); ?>">ログアウト</a></span>
<?php else: ?>
<button id="loginServerBtn" class="btn btn--login" data-login="<?php echo htmlspecialchars($loginUrl, ENT_QUOTES); ?>" style="display:none;">🔑 中村研の人はログイン（サーバー保存）</button>
<?php endif; ?>

<div id="recIndicator" class="recIndicator hidden">
    <div id="recLevel" class="recLevel"></div>
</div>

<div id="recTimer" class="recTimer hidden">00:00</div>

</div>

<audio id="audioPlayer" controls style="width:100%;"></audio>

<?php if ($me): // 同期字幕パネル（研究室ログイン限定） ?>
<div id="transcriptPanel" style="display:none;">
  <div class="transcript-head">
    <span>📝 文字起こし（行をタップでその場面へ）</span>
    <span style="display:flex; gap:6px;">
      <button id="transcriptRegen" class="btn btn--icon" title="もう一度文字起こしし直す">🔄</button>
      <button id="transcriptClose" class="btn btn--icon" title="閉じる">✕</button>
    </span>
  </div>
  <div id="transcriptList"></div>
</div>
<?php endif; ?>

<div id="pdf-container">
    <svg id="pdfSVG" width="100%" height="100%"></svg>
</div>

<?php if ($me): // 自分のチェック履歴（ログイン時のみ） ?>
<div id="sharedBox" style="display:none;">
  <h2>🤝 あなたに共有された校正</h2>
  <div id="sharedList"></div>
</div>
<div id="historyBox" style="display:none;">
  <h2>📋 あなたのチェック履歴</h2>
  <div id="historyList"></div>
</div>
<?php endif; ?>

<div id="description">
  <h2>システムの使い方</h2>

  <div class="steps">
<?php if ($me): ?>
    <div class="step js-load-pdf" role="button" tabindex="0" title="タップしてPDFを読み込む">
      <div class="step-number">1</div>
      <div class="step-content">
        <h3>PDFを読み込む</h3>
        <p>チェックしたい原稿のPDFファイルを「PDF読込」で開きます。読み込んだだけではまだサーバには保存されません。</p>
        <p class="tap-hint">👆 このカードをタップして読み込み</p>
      </div>
    </div>

    <div class="step">
      <div class="step-number">2</div>
      <div class="step-content">
        <h3>「サーバー録音」でチェック</h3>
        <p>マイクで話しながらペンやマウス、指などで書き込み、原稿をチェックしていきます。<br>「サーバー録音」を押すと、PDF・音声・手書きがサーバに保存され、あなたのチェック記録として残ります。</p>
      </div>
    </div>

    <div class="step">
      <div class="step-number">3</div>
      <div class="step-content">
        <h3>URLで共有</h3>
        <p>録音を終えると共有用のURLが表示されます。相手に渡すだけで、音声と手書きを時系列で再生してチェック内容を確認してもらえます。</p>
      </div>
    </div>
<?php else: ?>
    <div class="step js-load-pdf" role="button" tabindex="0" title="タップしてPDFを読み込む">
      <div class="step-number">1</div>
      <div class="step-content">
        <h3>PDFをアップロード</h3>
        <p>チェックしたい原稿のPDFファイルを「PDF読込」で読み込みます。なお、PDFはこのタイミングではサーバに送信されませんのでご安心を。</p>
        <p class="tap-hint">👆 このカードをタップして読み込み</p>
      </div>
    </div>

    <div class="step">
      <div class="step-number">2</div>
      <div class="step-content">
        <h3>録音ボタンを押してチェック開始</h3>
        <p>マイクで喋りながらペンやマウス、指などで書き込むことで原稿のチェックをしていきます。<br>ローカル録音の場合は、最後にPDFと録音した音声、手書きのデータがZIP圧縮してダウンロードされます。そのデータを渡すとチェック内容を確認できます。サーバには何もアップロードされませんのでご安心を。</p>
      </div>
    </div>

    <div class="step">
      <div class="step-number">3</div>
      <div class="step-content">
        <h3>閲覧</h3>
        <p>共有されたZIPファイルを「ZIP読込」で読み込むか、共有されたURLを閲覧するだけで、チェック内容を時系列で確認することができます。</p>
      </div>
    </div>
<?php endif; ?>
  </div>
</div>

</body>
</html>
