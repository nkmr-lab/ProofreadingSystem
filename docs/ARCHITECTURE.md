# ProofreadingSystem アーキテクチャ / 開発ガイド

pr.nkmr.io — PDF原稿を「音声＋手書き」で校正して返すツール。校正者がPDFを開き、喋りながらペンで書き込み→保存。著者は共有URLで音声＋手書きを時系列再生できる。研究室ログイン（nkmr SSO）者はサーバ保存・依頼・文字起こし・AI査読が使える。外部（未ログイン）はローカル録音（ZIP出力）と共有された校正の閲覧のみ。

これはコードの地図。詳しい経緯・判断は Claude のメモリ `project_proofreading.md` を参照。

---

## 1. 動かす場所・デプロイ

- **本番サーバ**: `rocky@133.125.33.6`（さくら Rocky10.2 / PHP8.3 / httpd＋php-fpm。drive/chai と同居）
- **docroot**: `/var/www/html/pen/pdf_audio`
- **vhost**: `/etc/httpd/conf.d/pr.nkmr.conf` + `pr.nkmr-le-ssl.conf`。**`<Directory>` に `AllowOverride All` が必須**（.htaccess が meta/ 遮断・`/{uuid}` リライト・js/css no-cache を担う。新サーバ流用時は要確認）
- **GitHub**: `nkmr-lab/ProofreadingSystem`（public）。ローカル作業コピー `C:\Dropbox\Programs\Claude\ProofreadingSystem`
- **デプロイ手順**（docroot は apache 所有で直 scp 不可）:
  1. `scp` でファイルを `/tmp/prdeploy/` に置く（**ssh/scp は PowerShell から**。Git Bash は鍵を拾えず fail2ban リスク）
  2. `sudo cp /tmp/prdeploy/… /var/www/html/pen/pdf_audio/`
  3. `sudo chown apache:apache … && sudo chmod 644 …`
  4. **PHP を変えたら `sudo systemctl reload php-fpm`**（opcache が古い実体を配るため。JSのみなら不要）
- **配布前チェック**: JS は `node --check`、PHP は `php -l`。index.php は本番反映前に必ず `php -l`。
- デプロイ後 `git add … && git commit && git push`（本番とGitHubをセットで）。

## 2. サーバ限定設定 `config.local.php`（リポジトリ外・apache所有644）

`<?php return [ ... ];` の連想配列。読み込みは `config_util.php` の `local_config()` に集約（api.php / transcribe.php 共用）。キー:

| キー | 用途 |
|---|---|
| `openai_key` | Whisper / gpt-4o-transcribe / gpt-4o（AI査読・タイトル抽出） |
| `whisper_prompt` | 文字起こしの語彙/句読点バイアス（未設定は既定文） |
| `labpay_event_url` | pr内依頼の通知先 `https://pay.nkmr.io/api/incoming-notify` |
| `labpay_event_secret` | 上記の Bearer トークン |
| `pr_integration.shared_secret` | LabPay→pr の Phase1(mark_in_review) 検証用 X-PR-Secret |

いずれも未設定ならその機能は安全にノーオペ。**シークレットはチャット等に貼らない／貼ったらローテート。**

## 3. データモデル（フラットファイル。DBなし）

- `files/{uuid}.pdf` … 原稿/校正のPDF（静的配信。URLを知れば誰でも取得可能）
- `files/{uuid}.m4a` … 録音音声
- `files/{uuid}.json` … 注釈（手書きストローク）＋タイムライン events
- `meta/{uuid}.json` … **所有者メタ**: `email, name, title, created, recipients[], restricted, review_request{reviewers{user:{name,status,result_uuid}}, message, created}, received_src`
- `meta/{uuid}.whisper.json` … whisper 生応答（**時刻用**キャッシュ）
- `meta/{uuid}.gpt.json` … gpt-4o-transcribe 本文（**本文用**キャッシュ）
- `meta/{uuid}.review.json` … AI査読結果キャッシュ
- `meta/inreview/{key}.json` … LabPay被依頼タスク（key = `reviewId_rowId`）
- **`meta/` と `meta/inreview/` は .htaccess で web 遮断**（注釈・メール・文字起こしが漏れないように）

一つの「依頼原稿」uuid と、レビュアーが録音して作る「校正結果」uuid は**別物**。校正結果は `request_done` で依頼に紐づく。

## 4. アクセスモデル（外部 / 研究室内 / 作成者 / 被依頼者）

- `nkmrauth.php` の `nkmrauth_identity()` → `$me = {email, user, name}` or `null`。
- **ログイン必須**（`require_login`→401）: upload / annotation save / delete / recipients / request_* / inreview_* / title / ai_review / mine / roster / transcribe / request_get。
- **公開**: 校正閲覧 GET `api.php?uuid=`（`restricted` な限定公開以外）、`files/*.pdf`（静的）。
- **作成者のみ**（`is_owner($owner,$me)`）: recipients設定・依頼作成・依頼取り下げ・🔗共有ボタン表示。
- **被依頼者のみ**: 原稿のチェック（録音保存）。`request_get` は**ログイン済みなら誰でも閲覧**でき `canCheck`(=被依頼者) を返す→非被依頼者は `appState.viewOnly`（閲覧のみ）。
- 未チェックの依頼原稿は `/{uuid}`（ビューアGET）でも PDF＋`review_request` があれば `manuscript:true` を返し、クライアントは閲覧ビューに委譲。

## 5. サーバ（PHP）

- **index.php** … ページ骨格。ツールバー・各パネル・`$me` のときだけダッシュボード。`data-checker`/`data-loggedin` を body に出す。
- **api.php** … JSONアクション＋閲覧GET。主なヘルパ: `local_config / is_owner / openai_chat / notify_labpay / meta_put / owner_path / read_owner / can_delete / json_error`。
  - POSTアクション: `delete, recipients, request_create, request_done, request_dismiss, request_cancel, inreview_done, received_register, review_callback, ai_review, title, mark_in_review`、他に `{uuid,data}` で校正保存。
  - GETアクション: `mine`(ホーム一覧), `request_get`, `inreview_get`, `ai_review`, `roster`(auth中継), `?uuid=`(閲覧データ or manuscript)。
- **transcribe.php** … ハイブリッド文字起こし（§7）。
- **nkmrauth.php** … SSO（Ed25519 cookie 検証）。公開鍵のみでpublicリポOK。
- **config_util.php** … `local_config()`。

## 6. クライアント（Vanilla JS ESM）

- **main.js** … エントリ。URL分岐（`/{uuid}`閲覧 / `?req=`チェック・閲覧 / `?mr=`LabPay作業 / `?recheck=`やり直し / ホーム）＋ボタン配線＋各init。PDFダウンロードもここ。
- **appState.js** … 画面全体の可変状態（isCheckerMode, isRecording, viewOnly, reqUuid, mrKey, reviewCb, inputMode, pdfUrl…）。
- **pdfHandler.js** … pdf.jsでPDF読込/描画。`pdfDoc, pdfScale, paths, changePage, loadPdfFile, getUploadedPDFFile`。
- **drawingHandler.js** … ストローク描画/消去、SVGパス生成、筆圧、再描画。
- **inputHandler.js** … pointerイベント→描画。**ペン優先/パームリジェクション**、入力モード(pen/touch/mouse)とスマホtouchMode、**端スワイプでページめくり**(`attachEdgeSwipeNav`)。
- **viewportHandler.js** … ピンチ/パン（CSS transform）と表示範囲のタイムライン記録/再生。`abortGesture`（ペン優先）。
- **timelineHandler.js** … events（stroke/page/view）を音声時刻に同期して記録/再生。
- **audioHandler.js** … MediaRecorder（mp4/m4a）、録音タイマー/レベル、アップロード。
- **recordingHandler.js** … 録音開始/終了/一時停止（サーバ/ローカル）、保存フロー、`request_done`/`inreview_done`、`postReviewResult`(→`review_callback`中継)、タイトル抽出。
- **storageHandler.js** … 閲覧読込(`loadDataFromServer`)、ZIP入出力、注釈保存、削除。
- **historyHandler.js** … ホームのダッシュボード各一覧（履歴/共有/届いた依頼📩/📥/出した依頼📨）＋⋯メニュー（録音し直す/削除）＋🔄再読み込み。
- **requestHandler.js** … pr内依頼の作成（モーダル＋roster）、`loadRequestForCheck`(?req)、`loadInReviewForCheck`(?mr)、`loadReviewForRecheck`(?recheck)。
- **shareHandler.js** … 共有ダイアログ（公開/限定/相手指定）。
- **transcriptHandler.js** … 文字起こしパネル（同期字幕・行タップで頭出し）。
- **reviewHandler.js** … AI査読パネル。
- **silenceHandler.js** … 無音スキップ再生。
- **UIHandler.js** … `updateButtons()`＝モード別の表示/非表示の中枢。入力モードUI。
- **htmlHandler.js** … SVGパス生成、`setHidden/setDisabled`、パスアニメ。
- **subModule.js** … 共通ユーティリティ: `escapeHtml, apiPost, makePanel, fetchRoster, GRADE_ORDER, extractUUID, calculateMedianPressure, getLocalTimeString`。
- **debugHud.js** … `?dbg=1` で入力イベントを画面表示（iPadの描画不具合切り分け）。

## 7. 文字起こし（ハイブリッド／幻聴対策）

whisper-1 の反復・無音幻聴（「ご視聴ありがとう」等）で本文が崩れる問題への恒久対策。**本文は gpt-4o-transcribe（句読点プロンプト付・生音声）、時刻は whisper（正規化音声）** を併用。
- whisper: ffmpeg正規化(highpass+speechnorm,16k mono)→verbose_jsonでセグメント時刻。
- gpt-4o: **生音声**（speechnormは静かな音声でgptを劣化させる）。**約25分(1500秒)上限**を超える音声は1400秒ごとにチャンク分割して結合。
- 合成(`build_hybrid`): セグメント単位のローカルアライメント（`local_align_end`・線形で長尺OK）で各gpt文字にwhisper時刻を割当→**文単位で区切る**。whisperの幻聴セグメントはgpt本文に対応が無く空→自動的に落ちる。
- キャッシュ2本（whisper.json/gpt.json）。GET/POSTとも両方あればhybrid・whisperのみなら旧表示・gpt失敗はwhisperにフォールバック。既存は🔄で再生成。コストはAPI2回。

## 8. AI査読

原稿PDFを `pdftotext`→gpt-4o で構造化レビュー。system promptは LabPay由来（HCI/CSCW査読者・章立て要約＋6項目チェックリスト）＋JSONスキーマ（summary/strengths/weaknesses/checklist/overall/judgment）。`meta/{uuid}.review.json` にキャッシュ。閲覧ページの🧐AI査読パネル（文字起こしと両方開くと広い画面で左右分割）。研究室ログイン限定。

## 9. LabPay 連携

- **handoff**（LabPay→pr）: `/?src=&cb=&cbt=&title=&requester=` で原稿を受けチェックモードへ。`received_register` で被依頼として登録（📥）。
- **結果返却**（pr→LabPay）: 保存時 `postReviewResult` → `api.php action=review_callback` が**サーバ中継**で `cb`(pay.nkmr.io/.../review-result) に `{cbt, resultUrl}` をPOST（ブラウザ直POSTはCORSで弾かれるため中継）。
- **pr内依頼の通知**（pr→LabPay）: `request_create`/`request_done` 時に `notify_labpay()` が `/api/incoming-notify`（Bearer）へ `{source,to_emails,body,slack_channel:'#labpay'}` を送信→LabPayが in-app/Slack DM/#labpay broadcast。依頼作成はprがレビュアーのメールを持たないため `to_emails:[]`（#labpayブロードキャストのみ）、完了は依頼者メールで本人通知。
- **Phase1**（LabPay→pr, 任意）: `mark_in_review`（X-PR-Secret 認証）。

## 10. 規約・注意

- UIの文言は学生向けは柔らかい和語。日本語に不要なスペースを入れない。
- 反映のたびに動作確認（作り切り→自分でテスト→動くものだけ提示）。破壊的操作は確認ダイアログ。
- PowerShell→Linux配布の文字化け/CR混入に注意（日本語ファイルは Write→scp 直送）。
- 既知の制約: 同時編集不可（後勝ちで上書き）。`files/*.pdf` は静的公開（真の非公開には files/ の認証配信化が別途必要）。
