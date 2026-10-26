# 引き継ぎ: pr.nkmr.io 連携仕様（Proofreading System）

pr.nkmr.io は「PDF原稿を音声＋手書きで校正し、結果を時系列再生で共有する」ツール。
**外部システム（現状は LabPay = pay.nkmr.io）が「原稿チェックを依頼 → pr で校正 → 結果URLを受け取る」**
ための連携契約を、pr 側の実装に即してまとめる。これは pr 側の正本。LabPay 側の対応仕様は
`labpay/docs/HANDOFF_manuscript_review.md`。

最終更新: 2026-10-26。

## 役割分担（重要）
- **依頼を出す側 = 外部システム（LabPay）**。pr 自体に「依頼を作る」UI は無い。
- **校正する側・結果を見る/共有する側 = pr.nkmr.io**。
- 外部システムは pr に「この PDF を校正して」と**ハンドオフ**し、pr は校正後に**結果URLをコールバック**で返す。

## 実体・デプロイ（2026-10 時点）
- サーバ: `ssh rocky@133.125.33.6`（さくら Rocky10.2 / PHP8.3、drive/chai 同居）。旧 nkmr-dev は使わない。
- docroot: `/var/www/html/pen/pdf_audio`（vhost `/etc/httpd/conf.d/pr.nkmr-le-ssl.conf`、`AllowOverride All` 必須＝.htaccess で `/{uuid}` ルーティング・`meta/` 非公開・js/css no-cache を効かせている）。
- GitHub: `nkmr-lab/ProofreadingSystem`（ソース起点）。ローカル作業コピー `C:\Dropbox\Programs\Claude\ProofreadingSystem`。
- **デプロイ: docroot は apache 所有で rocky 直 scp 不可。`scp で /tmp/deploy_pr/ → sudo cp で docroot → chown apache:apache + chmod 644`**（scratchpad の `deploy_pr.sh` 参照）。
- 秘密: OpenAI キーは `config.local.php`（gitignore・サーバのみ、`return ['openai_key'=>'sk-...']`）。
- ffmpeg（EPEL ffmpeg-free）導入済 = 文字起こしの音量正規化に使用（無くても原音フォールバックで動く）。

## ① ハンドオフ IN（外部 → pr：原稿を渡して校正モードで開く）
外部システムは、校正者のブラウザを次の URL へ遷移させる（302 でも a href でも可）:

```
https://pr.nkmr.io/?src=<PDF取得URL>&title=<タイトル>&cb=<コールバックURL>&cbt=<コールバックトークン>
```

各パラメータ（`main.js` の `maybeLoadFromHandoff` が処理）:

| param | 必須 | 内容・制約 |
|---|---|---|
| `src`  | ○ | 校正対象 PDF を返す URL。**`https://` かつ host が `pay.nkmr.io` のみ許可**（それ以外は「不正な転送元」で拒否）。pr はこれを `fetch(src)` で取得（cookie 不要＝**トークン付き URL** にすること）。**配信側は pr.nkmr.io からの CORS を許可**しておくこと（pay 側は `*.nkmr.io` 許可済）。|
| `title`| 任意 | 原稿ファイル名/タイトル。無ければ `document.pdf`。|
| `cb`   | ○(結果返却するなら) | 結果URLの返却先（POST される）。**host が `pay.nkmr.io` のときだけ採用**。|
| `cbt`  | ○(同上) | コールバックトークン（pr は中身を解釈せずそのまま送り返すだけ＝**署名/検証は外部側の責務**）。|

- pr は取得後、`?src` 等の**トークンをアドレスバーから消す**（`history.replaceState`）＝共有や履歴に残さない。
- `cb`/`cbt` は `appState.reviewCb` に保持し、保存時に使う。

## ② コールバック OUT（pr → 外部：結果URLを返す）
**サーバー録音を保存したとき**、pr は `cb` へ次を POST（`recordingHandler.js` の `postReviewResult`）:

```
POST <cb>
Content-Type: application/json
X-Requested-With: labpay          ← LabPay の CSRF ゲート通過に必須（ハードコード）
{ "cbt": "<受け取った cbt>", "resultUrl": "https://pr.nkmr.io/<uuid>" }
```

- `resultUrl` = 校正結果の閲覧URL（`https://pr.nkmr.io/{uuid}`）。外部側は host=pr.nkmr.io / https を検証して保存推奨。
- pr 側はエラーを握りつぶす（校正保存は成功させ、返却失敗は警告ログのみ）。
- **ローカル録音では送らない**（サーバー保存時のみ）。

## ③ 結果の閲覧URL
- `https://pr.nkmr.io/{uuid}` を開くと、PDF＋音声＋手書きを時系列再生。無音スキップ・文字起こし（研究室ログイン限定）も付く。
- 既定は「リンクを知っていれば誰でも閲覧可」。作成者は共有ダイアログで「指定した人だけ（限定公開）」「指定した人に届ける＋公開」に変更可（owner meta の `recipients` / `restricted`）。

## 既知の制約・拡張ポイント
- **現状 pr は `pay.nkmr.io` 専用にハードコード**: `src`/`cb` の host チェックが `pay.nkmr.io` 固定、コールバックの `X-Requested-With: labpay` も固定。**別システムを連携させるには pr 側のコード変更が必要**（host 許可リスト化＋ヘッダの出し分け）。
- `src` は CORS で pr.nkmr.io オリジンからの GET を許可する必要がある。
- 大きな PDF/音声でも可だが、文字起こし（Whisper）は 25MB 上限（録音30分≒14MBで収まる）。

## pr 内部 API（参考）
docroot の `api.php`（ログインは nkmr SSO = `nkmrauth.php`）:
- `GET  api.php?uuid=<uuid>` : pdf/annotations(+audio) を返す。recipients で限定時は 403。`isOwner`/`canDelete` 付き。
- `GET  api.php?action=mine` : 自分が作った＋自分に共有された校正一覧（ログイン必須）。
- `GET  api.php?action=roster` : 研究室メンバー一覧（auth へサーバ中継、共有相手ピッカー用）。
- `POST api.php`（JSON）: `{uuid,data}` 注釈保存 / `{action:'delete',uuid}` / `{action:'title',uuid,text}` / `{action:'recipients',uuid,recipients,restricted}`。いずれもログイン必須。
- `POST api.php`（multipart）: PDFアップロード（owner/title 記録）・音声アップロード。
- `transcribe.php?uuid=` : 文字起こし（研究室ログイン限定、Whisper、meta/ にキャッシュ）。
- 所有者メタ・文字起こしは **Web 非公開の `meta/`**（`.htaccess` Require all denied）。
