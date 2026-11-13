// Cloud: 背景の雲 (自作SVG)。左へ流れてループするパララックス背景
// ゲームの横スクロール感を出す飾り。当たり判定はない

// @a1
// 緑旗: 1つ目を出して、2つ目をクローンで作る
whenFlagClicked(() => {
  goToXY(-100, 120);
  show();
  createCloneOf("_myself_");
  forever(() => {
    changeX(-1);
    ifThen(lessThan(xPosition(), -260), () => {
      setX(260);
    });
  });
});

// @a2
// クローン: 少し高い位置を同じ速さで流れる
whenStartAsClone(() => {
  goToXY(100, 145);
  show();
  forever(() => {
    changeX(-1);
    ifThen(lessThan(xPosition(), -260), () => {
      setX(260);
    });
  });
});
