# Numer0n ONLINE

ヌメロンのオンライン対戦ツール（Firebase + GitHub Pages）。CPU対戦はFirebase設定なしで遊べます。

## ファイル構成
```
index.html
css/style.css
js/main.js            画面遷移・HUD・演出
js/rules.js           ルールエンジン（判定・アイテム・ターン進行）
js/client.js          プレイヤー処理（自分の番号でEAT/BITEを自動回答）
js/cpu.js             CPU（候補を厳密に追跡して推理。SHUFFLE/CHANGEにも対応）
js/net.js             通信（ローカル / Firebase Realtime Database）
js/studio.js          3Dスタジオ（Three.js）
js/sound.js           効果音・BGM（Web Audioで合成。mp3で差し替え可）
js/memo.js            手書きメモ（2560×1440）
js/firebase-config.js Firebase設定 ← 自分の設定を書く（更新時も上書きしない）
database.rules.json   Realtime Database のルール
assets/               画像・音（下記）
```

## Firebase の準備
1. Firebaseコンソールでプロジェクトを作成
2. **Authentication** → ログイン方法 → **匿名** を有効化
3. **Realtime Database** を作成 → 「ルール」タブに `database.rules.json` の中身を貼って公開
4. プロジェクトの設定 → マイアプリ → ウェブアプリを追加 → 表示された `firebaseConfig` を `js/firebase-config.js` に貼る（`databaseURL` 必須）
5. Authentication → 設定 → 承認済みドメイン に `ユーザー名.github.io` を追加

## GitHub Pages
リポジトリにこのフォルダの中身をそのままアップロード → Settings → Pages → Branch: main / root。
※ ローカルで確認するときは `index.html` を直接開かず、簡易サーバーで開いてください（例：`npx serve` や VSCode の Live Server）。

## 素材（無くても仮デザインで動きます）
| ファイル | 内容 |
|---|---|
| `assets/cards/0.png` 〜 `9.png` | 数字カード（縦横比 5:7 推奨。例 500×700） |
| `assets/cards/back.png` | カード裏面（5:7） |
| `assets/items/double.png` `highlow.png` `target.png` `slash.png` `time.png` `shuffle.png` `change.png` | アイテムアイコン（正方形・白黒推奨。効果発動中は白黒反転、使用後は暗く表示） |
| `assets/memo_bg.png` | メモの背景（2560×1440） |
| `assets/monitor_items/double.png` など | アイテム効果中にモニターへ映す画像（16:9、ファイル名はアイテム画像と同じ）。映像のあと効果が切れるまで表示し、その後 monitor.png に戻ります |
| `assets/monitor.png` | スタジオのモニターに待機中に映す画像（16:9、例 1920×1080） |
| `assets/logo.png` | タイトルロゴ（任意・透過PNG。スタジオのモニターにも表示） |
| `assets/videos/double.mp4` など | アイテム映像（任意・音声込みOK）。再生開始でBGMが止まり、終了後にフェードで再開。使用時にモニターで再生され、6秒でカメラが戻ります（映像の途中でも打ち切り）。ファイル名はアイテム画像と同じ（double / highlow / target / slash / time / shuffle / change）。H.264のmp4推奨、1本10MB程度まで |
| `assets/sounds/*.wav` | 効果音の差し替え（任意。下の名前で置くと合成音の代わりに鳴る） |

試合中に鳴るのは次の音だけです（`assets/sounds/` に置くと差し替わります。無い場合は仮の合成音）
| ファイル名 | 用途 |
|---|---|
| `bgm_start.wav` | ゲームスタートBGM（GAME START表示と同時に流れ、終わったらゲーム開始） |
| `bgm_game.wav` | ゲーム中BGM（ループ） |
| `item_press.wav` | アイテムボタンPUSH |
| `call.wav` | コール音 |
| `judge.wav` | EAT / BITE 判定音 |
| `item_judge.wav` | アイテムジャッジ音（SLASH・HIGH&LOW・DOUBLEの開示・TARGETの結果・CHANGEのHIGH/LOW公開） |
| `fanfare.wav` | 3EAT（4・5EAT）達成ファンファーレ |
| `turn.wav` | ターン交代音（判定表示が消えた後に鳴り、その後 防御タイム → コール可能） |

メニュー画面などの試合外の音は合成音です。

## 操作
- 数字キー：入力 / Enter：コール / Backspace：1文字消す / I：ITEMボタン / M：メモ
- 画質（低/中/高）は右上の♪ボタンのメニューで変更（重い場合は「低」）

## 詰めヌメロン（β）
メニューの「詰めヌメロン」。コールやアイテムの結果から答えが1通りに決まる問題を毎回自動生成し、正解までのタイムを計ります（3桁/4桁、ふつう/むずかしい、ベストタイム保存）。

## 公開ボタン
ロビー設定「判定・アイテム結果を公開ボタンで公開する」（初期ON）。人間同士のオンライン対戦で、EAT/BITEの判定やHIGH&LOW等の結果を、答える側がボタンで公開します（30秒で自動公開）。

## 観戦
ルームは最大12人。対戦は2人、残りは観戦者。ロビーで「観戦へ／対戦へ」を切り替え（ホストは全員分を変更可）。観戦者は画面下のボタンで視点プレイヤーを選べます（ランダムも可）。視点プレイヤーの番号も表示されます。
※ 観戦者は視点プレイヤーの番号を読めるよう、`database.rules.json` を更新してください。
- メモ：P=ペン、E=消しゴム、Ctrl+Z / Ctrl+Y、ペンタブの筆圧対応、PNG保存
