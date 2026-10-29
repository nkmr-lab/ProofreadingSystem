# Proofreading System
PDF原稿を音声＋手書きで校正して返すツール (pr.nkmr.io)

**開発者向け**: 全体像・モジュール地図・エンドポイント・データモデル・デプロイ手順は [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) を参照。

.htaccessとpdfHandler.js内のbase_urlを自身のサイトのパスに書き換えれば動くはず（しらんけど）。

PDFをアップして、手書きとタイピングでチェックして返すことができます。同時編集できません（すると上書きされます）。
