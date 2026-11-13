// @a1
define("残像", () => {
    setLookEffectTo("GHOST", "0");
    repeat("5", () => { changeLookEffectBy("GHOST", "20"); });
    deleteThisClone();
  });

// @a2
script(() => {
  switchCostumeTo("コスチューム1");
});

// @a3
whenBroadcastReceived("次!", () => {
  hide();
  wait("2.5");
});

// @a4
whenStartAsClone(() => {
  switchCostumeTo("コスチューム3");
  call("残像");
});

// @a5
whenFlagClicked(() => { hide(); });

// @a6
define("戻る", () => {
    broadcast("i");
    startSound("Crunch");
    goToXY("-210", "0");
    show();
    setVariableTo(vars.x, "0");
    setVariableTo(vars.y, "0");
  });

// @a7
whenBroadcastReceived("すてーじかわった", () => {
  wait("0.8");
  call("戻る(クリア)");
});

// @a8
whenFlagClicked(() => { broadcast("Intro start"); });

// @a9
whenBroadcastReceived("イントロ完", () => {
  setVariableTo(vars.ステージのバグ解消, "0");
  setVolumeTo("100");
  forever(() => {
    wait("1");
    playSoundUntilDone(random("4", "9"));
  });
});

// @a10
define("戻る(クリア)", () => {
    setVariableTo(vars.ステージのバグ解消, "0");
    goToXY("-210", "0");
    show();
    switchCostumeTo("コスチューム1");
  });

// @a11
whenStartAsClone(() => {
  setLookEffectTo("GHOST", "0");
  switchCostumeTo("コスチューム3");
  repeat("15", () => {
    changeSizeBy("-2");
    changeLookEffectBy("GHOST", "7");
  });
  deleteThisClone();
});

// @a12
whenBroadcastReceived("イントロ完", () => {
  wait("1");
  goToXY("-150", "0");
  show();
  setRotationStyle("left-right");
  setVariableTo(vars.x, "0");
  setVariableTo(vars.y, "0");
  setSizeTo("65");
  forever(() => {
    ifElse(or(or(keyPressed("w"), keyPressed("up arrow")), and(mouseDown(), lessThan("0", mouseY()))), () => { ifElse(or(and(or(keyPressed("w"), keyPressed("up arrow")), or(or(keyPressed("d"), keyPressed("right arrow")), or(keyPressed("a"), keyPressed("left arrow")))), and(mouseDown(), lessThan("0", mouseY()))), () => { switchCostumeTo("コスチューム4"); }, () => { switchCostumeTo("コスチューム6"); }); }, () => {
      switchCostumeTo("コスチューム1");
      ifElse(or(or(keyPressed("a"), keyPressed("left arrow")), and(mouseDown(), lessThan(mouseX(), "0"))), () => { switchCostumeTo("コスチューム2"); }, () => { ifElse(or(or(keyPressed("d"), keyPressed("right arrow")), and(mouseDown(), lessThan("0", mouseX()))), () => { switchCostumeTo("コスチューム2"); }, () => { switchCostumeTo("コスチューム1"); }); });
    });
    ifThen(or(or(keyPressed("d"), keyPressed("right arrow")), and(mouseDown(), lessThan("0", mouseX()))), () => {
      pointInDirection("90");
      changeVariableBy(vars.x, "1.75");
    });
    ifThen(or(or(keyPressed("a"), keyPressed("left arrow")), and(mouseDown(), lessThan(mouseX(), "0"))), () => {
      changeVariableBy(vars.x, "-1.75");
      pointInDirection("-90");
    });
    setVariableTo(vars.x, multiply(vars.x, "0.8"));
    changeX(vars.x);
    ifThen(or(touching("動くステージ"), or(touching("ステージ"), undefined)), () => {
      changeY("1");
      ifThen(or(touching("動くステージ"), or(touching("ステージ"), undefined)), () => {
        changeY("1");
        ifThen(or(touching("動くステージ"), or(touching("ステージ"), undefined)), () => {
          changeY("1");
          ifThen(or(touching("動くステージ"), or(touching("ステージ"), undefined)), () => {
            changeY("1");
            ifThen(or(touching("動くステージ"), or(touching("ステージ"), undefined)), () => {
              changeY("1");
              ifThen(or(touching("動くステージ"), or(touching("ステージ"), or(touching("鍵穴"), touching("鍵穴2")))), () => {
                changeX(multiply(vars.x, "-1"));
                changeY("-5");
                ifElse(and(or(or(keyPressed("w"), keyPressed("up arrow")), and(mouseDown(), lessThan("0", mouseY()))), not(touching("水"))), () => {
                  startSound("壁キック");
                  ifElse(greaterThan(vars.x, "0"), () => { setVariableTo(vars.x, "-15"); }, () => { setVariableTo(vars.x, "15"); });
                  setVariableTo(vars.y, "15.5");
                }, () => { setVariableTo(vars.x, "0"); });
              });
            });
          });
        });
      });
    });
    changeVariableBy(vars.y, "-1");
    changeY(vars.y);
    ifThen(or(touching("動くステージ"), or(touching("ステージ"), or(touching("鍵穴"), touching("鍵穴2")))), () => {
      changeY(multiply(vars.y, "-1"));
      setVariableTo(vars.y, "0");
    });
    ifThen(or(or(keyPressed("w"), keyPressed("up arrow")), and(mouseDown(), lessThan("0", mouseY()))), () => {
      changeY("-1");
      ifThen(and(or(touching("動くステージ"), or(touching("ステージ"), or(touching("鍵穴"), touching("鍵穴2")))), or(or(keyPressed("w"), keyPressed("up arrow")), and(mouseDown(), lessThan("0", mouseY())))), () => {
        changeVariableBy(vars.y, "17");
        startSound("ジャンプ3");
      });
      changeY("1");
    });
    ifThen(lessThan("240", xPosition()), () => {
      broadcast("次のステージ");
      goToXY("-210", "0");
      setVariableTo(vars.ステージのバグ解消, "1");
      wait("3");
      setVariableTo(vars.x, "0");
      setVariableTo(vars.y, "0");
    });
    ifThen(touching("ジャンプ台"), () => {
      startSound("ジャンプ3");
      setVariableTo(vars.y, "20");
    });
    ifThen(or(lessThan(yPosition(), "-182"), or(touching("針"), or(touching("敵キャラ"), or(touching("針(特殊?)"), touching("動く針2"))))), () => { ifElse(touching("敵キャラ"), () => { ifElse(touchingColor("#da4343"), () => { ifElse(touchingColor("#dd4848"), () => { call("戻る"); }, () => {}); }, () => { call("戻る"); }); }, () => { call("戻る"); }); });
    createCloneOf("_myself_");
    broadcast("huhh0");
  });
});

// @a13
whenBroadcastReceived("huhh0", () => { ifThen(not(or(touching("動くステージ"), or(touching("ステージ"), or(touching("鍵穴"), touching("鍵穴2"))))), () => { changeY("-1"); }); });

// @a14
whenBroadcastReceived("イントロ完", () => {
  forever(() => {
    waitUntil(touching("水"));
    ifElse(or(keyPressed("up arrow"), and(mouseDown(), lessThan("0", mouseY()))), () => { setVariableTo(vars.y, "5"); }, () => { setVariableTo(vars.y, "-1.5"); });
  });
});
