// 一時停止メニュー（Pキーで開閉、SPACEで続ける、Rで最初から）
// 既存の動作は変えない：Paused が 1 の間だけ Hitbox/Tile のループが待機する。

whenFlagClicked(() => {
  hide();
  setVariableTo(vars.Paused, 0);
});

whenKeyPressed("p", () => {
  ifElse(equals(vars.Paused, 0), () => {
    setVariableTo(vars.Paused, 1);
    goToXY(0, 20);
    goToFrontBack("front");
    show();
    waitUntil(not(keyPressed("p")));
  }, () => {
    setVariableTo(vars.Paused, 0);
    hide();
    waitUntil(not(keyPressed("p")));
  });
});

whenKeyPressed("space", () => {
  ifThen(equals(vars.Paused, 1), () => {
    setVariableTo(vars.Paused, 0);
    hide();
  });
});

whenKeyPressed("r", () => {
  ifThen(equals(vars.Paused, 1), () => {
    hide();
    setVariableTo(vars.Paused, 0);
    broadcast("done");
    wait(0.3);
    broadcast("deletecc");
    wait(0.1);
    broadcast("restart");
    wait(0.3);
    broadcast("enter game");
  });
});

whenBroadcastReceived("gameend", () => {
  hide();
  setVariableTo(vars.Paused, 0);
});
