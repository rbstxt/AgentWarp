// @a1
whenFlagClicked(() => { hide(); });

// @a2
whenBroadcastReceived("enter game", () => {
  hide();
  goForwardBackwardLayers("backward", 999);
  setVariableTo(vars["Local FromLR"], 0);
  createCloneOf("_myself_");
});

// @a3
whenBroadcastReceived("gameend", () => {
  block("control_stop", { fields: { "STOP_OPTION": "other scripts in sprite" }, mutation: {"tagName":"mutation","hasnext":"true","children":[]} });
  hide();
  deleteThisClone();
});

// @a4
whenStartAsClone(() => {
  switchCostumeTo(vars.Tile);
  ifElse(equals(vars["Local FromLR"], "1"), () => {
    goToXY(466, 0);
    show();
    glideSecsToXY(0.8, 0, 0);
  }, () => {
    ifElse(equals(vars["Local FromLR"], "2"), () => {
      goToXY(-466, 0);
      show();
      glideSecsToXY(0.8, 0, 0);
    }, () => {
      ifElse(equals(vars["Local FromLR"], "3"), () => {
        goToXY(0, -346);
        show();
        glideSecsToXY(0.8, 0, 0);
      }, () => {
        goToXY(0, 346);
        show();
        glideSecsToXY(0.8, 0, 0);
      });
    });
  });
  waitUntil(or(or(equals(vars["Next?"], "1"), equals(vars["Next?"], "-1")), or(equals(vars["Next?"], "-2"), equals(vars["Next?"], "2"))));
  ifElse(equals(vars["Next?"], "1"), () => {
    setVariableTo(vars["Local FromLR"], "1");
    createCloneOf("_myself_");
    glideSecsToXY(0.78, -466, 0);
    deleteThisClone();
  }, () => {
    ifElse(equals(vars["Next?"], "-1"), () => {
      setVariableTo(vars["Local FromLR"], "2");
      createCloneOf("_myself_");
      glideSecsToXY(0.78, 466, 0);
      deleteThisClone();
    }, () => {
      ifElse(equals(vars["Next?"], "2"), () => {
        setVariableTo(vars["Local FromLR"], "3");
        createCloneOf("_myself_");
        glideSecsToXY(0.78, 0, 346);
        deleteThisClone();
      }, () => {
        setVariableTo(vars["Local FromLR"], "4");
        createCloneOf("_myself_");
        glideSecsToXY(0.78, 0, -346);
        deleteThisClone();
      });
    });
  });
});

// --- 追加: リスタート時の掃除（スクロール停止＋クローン削除） ---
whenBroadcastReceived("restart", () => {
  block("control_stop", { fields: { "STOP_OPTION": "other scripts in sprite" }, mutation: {"tagName":"mutation","hasnext":"true","children":[]} });
  hide();
  deleteThisClone();
});
