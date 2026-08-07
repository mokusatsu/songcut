# SCUT-031 公開・名前付き関数の日本語JSDoc整備

## 目的

production TypeScriptの関数責務、引数、重要な副作用を日本語で追えるようにし、今後追加される公開関数も同じ説明水準を保つ。

## 変更範囲

- `gui/src`と`gui/electron`のproduction TypeScript/TSX
- 公開関数・component・hook、およびSCUT-029/030で変更する名前付き関数
- JSDoc存在と日本語本文を検査するstatic contract

## 禁止事項

- 匿名callback、JSX内の一回限りの処理へ形式的なコメントを付けない。
- 関数名を言い換えるだけの説明、事実と異なる副作用説明を追加しない。
- JSDoc追加と同時に無関係な挙動変更や大規模整形を行わない。
- JSDoc専用のproduction依存を追加しない。

## 完了条件

- [x] production TypeScriptのexportされた関数・component・hookに日本語JSDocがある。
- [x] `App.tsx`とSCUT-029/030の変更moduleにある名前付き関数へ日本語JSDocがある。
- [x] public APIでは引数、戻り値、重要な副作用または例外が必要な範囲で説明される。
- [x] TypeScript ASTを使うstatic contractが対象漏れと日本語本文欠落を検出する。
- [x] GUI全テスト、typecheck、production buildが成功する。

## テスト方法

- Static contract: TypeScript ASTによるJSDoc検査
- Unit: GUI全Vitest
- Static: GUI typecheck
- Build: GUI production build
- Diff: `git diff --check`

## 停止条件

- 既存関数の意味をコードとテストから判断できず、誤った説明になる場合は対象を記録して実装判断を止める。

## 実施証跡

- `gui/src`と`gui/electron`のproduction TypeScriptについて、export関数・component・hookと、AppおよびSCUT-029/030変更moduleの名前付き関数437件へ日本語JSDocを追加した。
- component描画、React hook、HTTP API、永続化、schema検証、正規化、選択、media操作、model downloadなど、責務別に副作用と戻り値の意味が分かる説明へ揃えた。
- `jsdocContracts.test.ts`がTypeScript ASTでproduction sourceを走査し、対象関数のJSDoc欠落と日本語本文欠落を検出する。匿名callbackとtest sourceは対象外とした。
- 一回限りの挿入scriptは実施後に削除し、production依存は追加していない。
- JSDoc contract 1 test、全Vitest 47 files／280 tests、typecheck、production build、`git diff --check`が成功した。
