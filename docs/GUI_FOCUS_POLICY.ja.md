# GUIフォーカス設計ルール

## 概要

SongcutのCut/Sub編集画面では、操作ボタンをクリックしたあとも`WASD`、`Q/E`、`Z/X/C`、`Space`をすぐ使えることを基本契約とする。そのため、編集画面のボタン類はフォーカスを保持せず、操作後はCut/Sub共通のeditor focus anchorへフォーカスを戻す。

文字入力にはcaretとIMEのためのフォーカスが必要であり、設定dialogでは通常のキーボード操作が必要になる。この2つは例外として通常のフォーカスを維持し、その間だけeditor shortcutを抑止する。

| 場所・操作 | フォーカス契約 | Editor shortcut |
| --- | --- | --- |
| Cut/Subの操作ボタン、toggle、checkbox、mode tab | Tab移動先にせず、操作後にeditor anchorへ戻す | 有効 |
| Cut/Subのtext/number input、textarea、contenteditable | 編集中だけ入力欄が保持する | 抑止 |
| Settings等のmodal dialog内 | 通常どおりTab移動とfocusを扱う | dialog全体で抑止 |
| timelineのsegment、境界handle、waveform drag | pointer操作中に不要なfocusを作らない | 有効 |

## 必須の設計原則

1. Cut/Subで同じfocus処理を個別実装しない。`EditorFocusProvider`と共通UI primitiveを使う。
2. Editor actionのfocus復帰先は`document.body`ではなく、`tabIndex={-1}`のeditor focus anchorとする。
3. Editor action controlはeditor scope内で`tabIndex={-1}`にする。通常のTab操作が必要なdialog内ではこの規則を解除する。
4. shortcut抑止は「interactiveかどうか」ではなく「文字入力中か、modal内か」で判定する。`button`、`role=button`、checkboxを一律抑止対象に戻さない。
5. 文字入力をfocusなしで実装しない。caret、選択、clipboard、IME、アクセシビリティのいずれもfocusを必要とする。
6. IME composition中、`keyCode === 229`、すでに`preventDefault`されたkey eventをeditor shortcutへ流さない。
7. 新しいmodalは共通`Dialog`を使う。React portalは親contextを引き継ぐため、Dialog側で明示的にnormal focus scopeへ戻す。

## 実装方法

### Editor root

Cut/Subを含む編集領域は、Appで一度だけ`EditorFocusProvider`へ接続する。focus anchorとなる既存root elementにはrefと`tabIndex={-1}`を設定する。focusのためだけにCut/Sub別wrapperを追加しない。

```tsx
const editorRootRef = useRef<HTMLElement>(null);

<EditorFocusProvider rootRef={editorRootRef}>
  <main ref={editorRootRef} tabIndex={-1}>
    {/* Cut / Sub editor */}
  </main>
</EditorFocusProvider>
```

共通`Button`、`Toggle`、`Checkbox`、`TabsTrigger`はeditor scopeを検出し、次を自動で行う。

- 明示的な`tabIndex`がなければ`-1`を設定する。
- 利用側のevent handlerを先に実行する。
- eventがcancelされていなければ、操作後に共通editor anchorへfocusを戻す。
- disabled controlや、dialog内のnormal focus scopeには適用しない。

Native `<button>`を直接使う必要がある場合は、共通focus hookを適用する。単に各所へ`blur()`、`tabIndex={-1}`、`preventDefault()`を貼る実装は、focus復帰先とevent順序がばらつくため禁止する。

### 入力欄

`Input`と`Textarea`はeditor scope内でもfocus可能なままにする。入力中はglobal editor shortcutを抑止する。

- `Escape`で編集を終了できるUIでは、composition中でないことを確認してからblurし、editor anchorへ戻す。
- single-line inputで`Enter`をcommitに使う場合も、composition中のEnterをcommitにしない。
- multiline textareaの`Enter`は改行なので、共通処理でblurさせない。
- component固有の`onKeyDown`が`preventDefault()`した場合、共通処理は追加動作をしない。
- 独自入力widgetには`data-editor-shortcuts="suppress"`を付ける。通常ボタンの回避策としてこの属性を使わない。

### DialogとSettings

Dialogが開いたらdialog内をnormal focus scopeにし、適切な初期focusを与える。dialog表示中はactive elementの種類に関係なくeditor shortcutを抑止する。閉じたときは、可能ならopen前のfocusへ戻し、open元がeditor actionなら最終的にeditor anchorがactiveになるようにする。

設定dialog内のbutton、checkbox、select、inputは通常どおりTab移動できる。Editor向けの`tabIndex={-1}`をglobal CSSや全button共通属性として実装してはいけない。

### Timeline pointer操作

Segment、boundary handle、waveform scrubは、pointer downでブラウザ既定のfocus移動やtext selectionが邪魔になる場合だけ`preventDefault()`する。drag lifecycle、pointer capture、preview/commit/cancelの共通処理はfocus policyと混ぜない。pointer操作完了後にfocus復帰が必要なら共通focus APIを呼ぶ。

## Shortcut抑止の判定

Global shortcutは次の場合だけ抑止する。

- `[role="dialog"][aria-modal="true"]`が表示されている。
- event targetがtext/number input、textarea、select、contenteditable、textbox/combobox/searchbox/spinbuttonである。
- event targetまたは祖先に`data-editor-shortcuts="suppress"`がある。
- eventがIME composition中、key code 229、repeat、modifier付き、または処理済みである。

Button、link、checkbox、radio、menu item等を「interactiveだから」という理由だけで抑止対象にしない。Editor actionがfocusを保持しない契約と、入力中だけ抑止する契約を組み合わせて成立させる。

## 新規GUI実装時の判断表

| 質問 | Yesの場合 |
| --- | --- |
| 値を文字として入力・編集するか | 通常focusを許可し、入力中shortcutを抑止する |
| modal dialog内か | normal focus scopeを使い、dialog全体でshortcutを抑止する |
| Cut/Sub editorの即時actionか | 共通action primitive/hookを使い、focusをeditorへ戻す |
| pointer dragか | 必要な既定動作だけ抑止し、drag終了時のfocusを確認する |
| 独自の編集widgetか | `data-editor-shortcuts="suppress"`と終了時focus復帰を設計する |
| Cut/Sub両方に存在するか | 共通primitiveまたは共通controllerに置き、mode側には意味の差だけを残す |

## レビューとテストのチェックリスト

- CutとSubの各toolbar buttonをクリック後、`W/S`と`Space`が一回で動作する。
- Buttonにfocusがある状態を人工的に作ってclickしても、操作後はeditor anchorへ戻る。
- Editor action controlがTab順序へ入らない。
- Textarea/inputへ入力中は`WASD`や`Space`が文字入力を壊さない。
- IME変換中のEnter/Escapeで意図しないcommit、blur、shortcutが起きない。
- Settings/dialog内はTab、Shift+Tab、Space、Enterが通常どおり使える。
- Dialogを閉じるとeditor shortcutが再開する。
- Cut/Subのどちらかだけにfocus処理が複製されていない。
- Unit testにfocus分類とshortcut契約を追加し、再build済みdistでCut/Sub E2Eを確認する。

## 禁止パターン

- `document.activeElement.blur()`だけを呼び、明確なfocus復帰先を持たない。
- `window`のkeydown handlerでbuttonを含む全interactive elementを一律除外する。
- 全buttonへglobalに`tabIndex={-1}`を設定し、Settings/dialogのkeyboard navigationも消す。
- textareaをfocus不要に見せるため、透明inputやdocument-level key captureで文字入力を再実装する。
- 同じ`onMouseDown(event.preventDefault)`や`focus()`処理をCut/Subへ別々にコピーする。
