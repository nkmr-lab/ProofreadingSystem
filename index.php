<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, height=device-height, initial-scale=1.0">
    <title>PDF Checker</title>
    <link href="https://cdnjs.cloudflare.com/ajax/libs/noUiSlider/15.8.1/nouislider.min.css" rel="stylesheet">
    <link rel="stylesheet" href="styles.css">
    <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.9.359/pdf.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/noUiSlider/15.8.1/nouislider.js"></script>
    <script type="module" src="main.js"></script>
</head>
<body id='bodyContent'>
    <input type="file" id="file-input" class="hidden-file-input" />
    <button id="prev-page" disabled style="background: #ccffcc">＜前</button>
    <button id="filter-pages" disabled>絞込</button>
    <button id="show-thumbnails" disabled>一覧</button>
    <button id="next-page" disabled style="background: #ccffcc">次＞</button>
    　
    <button id="drawing-mode" disabled style="background: #ffcccc">[描く] 書く 消す 閲覧</button>
    <button id="undo" disabled>戻す</button>
    　
<!--
    <button id="save-json" <?php if (isset($_GET['uuid'])) { echo " style=\"display: none;\""; } ?>>保存</button>
    <button id="load-json" <?php if (isset($_GET['uuid'])) { echo " style=\"display: none;\""; } ?>>読込</button>
-->
    <button id="share" <?php if (isset($_GET['uuid'])) { echo " style=\"display: none\""; } ?> style='background: #ccccff' disabled>共有</button>
    <?php if (!isset($_GET['uuid'])) { echo "　"; } ?>
    <label for="zoomSlider">🔎</label>
    <input type="range" id="zoomSlider" min="0.5" max="3" step="0.1" value="1">
    　
    <?php if (isset($_GET['uuid'])){ ?><input type="button" onclick="location.href='https://pr.nkmr.io/'" value="🏚️"><?php } ?>
    <div id="sliderContainer">
        <button id="playPauseBtn">⏩️</button>
        <input type="checkbox" id="autoplay" checked>
        <input type="range" id="playSlider" min="0" max="0" value="0">
    </div>
    <div id="pdf-container">
        <button class="file-select-button" id="file-select-button" <?php if (isset($_GET['uuid'])) { echo " style=\"display: none;\""; } ?>>Select File</button>
        <svg id="pdf-svg" width="100%" height="100%"></svg>
    </div>
    <div id="thumbnails" style="display: none;"></div>
    <div class="fixed-control">
        <div id="pressure-range-slider" style="height:100px;"></div>
    </div>
</body>
</html>
