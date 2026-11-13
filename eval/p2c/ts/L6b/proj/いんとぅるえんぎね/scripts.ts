// @a1
define("Rw %s %s %s %s %s", { warp: true }, (x, y, dir, z, c) => {
    setVariableTo(vars["Rw C"], c);
    setVariableTo(vars["Rw siz"], z);
    setVariableTo(vars["clone Dir"], dir);
    setVariableTo(vars["clone X"], x);
    setVariableTo(vars["clone Y"], y);
    setVariableTo(vars["Cam Control?"], "1");
    setVariableTo(vars.ID, "rw");
    createCloneOf("_myself_");
    setVariableTo(vars["clone X"], add(x, "25"));
    setVariableTo(vars["clone Y"], subtract(y, "15"));
    setVariableTo(vars.ID, "rw影");
    createCloneOf("_myself_");
  });

// @a2
whenBroadcastReceived("Intro start", () => {});

// @a3
define("Sw Type %s x,y,dir %s %s %s size %s Color %s", { warp: true, argumentDefaults: ["", "", "", "", "", "", "", ""] }, ($arg /* "" */, x, y, d, z, c) => {
    setVariableTo(vars["Sw C"], c);
    setVariableTo(vars["Sw,type"], $arg);
    setVariableTo(vars["clone X"], x);
    setVariableTo(vars["clone Y"], y);
    setVariableTo(vars["sw z"], z);
    setVariableTo(vars["Sw dir"], d);
    setVariableTo(vars["Cam Control?"], "1");
    setVariableTo(vars.ID, "sw");
    createCloneOf("_myself_");
    setVariableTo(vars["clone X"], add(x, "25"));
    setVariableTo(vars["clone Y"], subtract(y, "15"));
    setVariableTo(vars.ID, "sw影");
    createCloneOf("_myself_");
  });

// @a4
whenStartAsClone(() => {
  ifThen(equals(vars.ID, "rw影"), () => {
    goToFrontBack("front");
    goForwardBackwardLayers("backward", "1");
    setLookEffectTo("BRIGHTNESS", "-100");
    setLookEffectTo("GHOST", "50");
    show();
    switchCostumeTo("Filler (Size)");
    setVariableTo(vars["clone Z"], "0");
    switchCostumeTo("Diamond 1");
    repeat("15", () => {
      changeVariableBy(vars["clone Z"], divide(subtract(vars["Rw siz"], size()), "7"));
      nextCostume();
    });
    repeat("7", () => {
      changeVariableBy(vars["clone Z"], divide(subtract(vars["Rw siz"], size()), "4"));
      nextCostume();
      changeLookEffectBy("GHOST", "1");
    });
    hide();
  });
});

// @a5
whenBroadcastReceived("Intro start", () => {
  deleteAllOfList(lists["Fwのためだけのリスト。"]);
  insertAtList("2", "1", lists["Fwのためだけのリスト。"]);
  insertAtList("4", "2", lists["Fwのためだけのリスト。"]);
  insertAtList("6", "3", lists["Fwのためだけのリスト。"]);
  insertAtList("8", "4", lists["Fwのためだけのリスト。"]);
  insertAtList("10", "5", lists["Fwのためだけのリスト。"]);
  insertAtList("12", "6", lists["Fwのためだけのリスト。"]);
  insertAtList("14", "7", lists["Fwのためだけのリスト。"]);
  insertAtList("16", "8", lists["Fwのためだけのリスト。"]);
  insertAtList("18", "9", lists["Fwのためだけのリスト。"]);
  insertAtList("20", "10", lists["Fwのためだけのリスト。"]);
});

// @a6
whenStartAsClone(() => {
  ifThen(equals(vars.ID, "rw"), () => {
    setLookEffectTo("COLOR", vars["Rw C"]);
    goToFrontBack("front");
    setLookEffectTo("GHOST", "0");
    show();
    switchCostumeTo("Filler (Size)");
    setVariableTo(vars["clone Z"], "0");
    switchCostumeTo("Diamond 1");
    repeat("15", () => {
      changeVariableBy(vars["clone Z"], divide(subtract(vars["Rw siz"], size()), "7"));
      nextCostume();
    });
    repeat("7", () => {
      changeVariableBy(vars["clone Z"], divide(subtract(vars["Rw siz"], size()), "4"));
      nextCostume();
      changeLookEffectBy("GHOST", "1");
    });
    hide();
  });
});

// @a7
define("Fw %s %s %s %s %s type %s", { warp: true, argumentDefaults: ["", "", "", "", "", "", ""] }, (x, y, z, 本数, Color, $arg /* "" */) => {
    setVariableTo(vars["clone Dir"], "0");
    setVariableTo(vars["Fw Color"], Color);
    setVariableTo(vars["Fw type"], $arg);
    setVariableTo(vars["clone X"], x);
    setVariableTo(vars["clone Y"], y);
    setVariableTo(vars["clone Z"], z);
    setVariableTo(vars.Fw, "0");
    repeat(本数, () => {
      changeVariableBy(vars.Fw, "1");
      changeVariableBy(vars["clone Dir"], divide("360", 本数));
      call("Clone %s %s", "fw", "1");
    });
    setVariableTo(vars["clone X"], add(x, "25"));
    setVariableTo(vars["clone Y"], subtract(y, "15"));
    repeat(本数, () => {
      changeVariableBy(vars.Fw, "1");
      changeVariableBy(vars["clone Dir"], divide("360", 本数));
      call("Clone %s %s", "fw影", "1");
    });
  });

// @a8
whenStartAsClone(() => {
  ifThen(equals(vars.ID, "sw"), () => {
    goToFrontBack("front");
    ifThen(equals(vars["Sw,type"], "a"), () => {
      setLookEffectTo("COLOR", vars["Sw C"]);
      setVariableTo(vars.sw, "10");
      setVariableTo(vars["clone Z"], "0");
      switchCostumeTo("sw");
      setLookEffectTo("FISHEYE", "0");
      repeat("70", () => {
        setVariableTo(vars.sw, multiply(vars.sw, "1.19"));
        changeLookEffectBy("FISHEYE", vars.sw);
        changeVariableBy(vars["clone Z"], divide(subtract(vars["sw z"], size()), "5"));
      });
    });
    ifThen(equals(vars["Sw,type"], "b"), () => {
      setLookEffectTo("COLOR", vars["Sw C"]);
      setVariableTo(vars.sw, "10");
      setVariableTo(vars["clone Z"], "0");
      setLookEffectTo("FISHEYE", "0");
      switchCostumeTo("1/2sw");
      setVariableTo(vars["clone Dir"], vars["Sw dir"]);
      repeat("70", () => {
        setVariableTo(vars.sw, multiply(vars.sw, "1.19"));
        changeLookEffectBy("FISHEYE", vars.sw);
        changeVariableBy(vars["clone Z"], divide(subtract(vars["sw z"], size()), "5"));
      });
    });
    deleteThisClone();
  });
});

// @a9
whenStartAsClone(() => {
  ifThen(equals(vars.ID, "sw影"), () => {
    ifThen(equals(vars["Sw,type"], "a"), () => {
      setLookEffectTo("COLOR", vars["Sw C"]);
      setLookEffectTo("GHOST", "50");
      setLookEffectTo("BRIGHTNESS", "-100");
      setVariableTo(vars.sw, "10");
      setVariableTo(vars["clone Z"], "0");
      setVariableTo(vars.cos, "sw");
      switchCostumeTo("sw");
      setLookEffectTo("FISHEYE", "0");
      repeat("70", () => {
        setVariableTo(vars.sw, multiply(vars.sw, "1.19"));
        changeLookEffectBy("FISHEYE", vars.sw);
        changeVariableBy(vars["clone Z"], divide(subtract(vars["sw z"], size()), "5"));
      });
    });
    ifThen(equals(vars["Sw,type"], "b"), () => {
      setLookEffectTo("COLOR", vars["Sw C"]);
      setLookEffectTo("GHOST", "50");
      setLookEffectTo("BRIGHTNESS", "-100");
      setVariableTo(vars.sw, "10");
      setVariableTo(vars["clone Z"], "0");
      switchCostumeTo("1/2sw");
      setVariableTo(vars.cos, "1/2sw");
      setLookEffectTo("FISHEYE", "0");
      setVariableTo(vars["clone Dir"], vars["Sw dir"]);
      repeat("70", () => {
        setVariableTo(vars.sw, multiply(vars.sw, "1.19"));
        changeLookEffectBy("FISHEYE", vars.sw);
        changeVariableBy(vars["clone Z"], divide(subtract(vars["sw z"], size()), "5"));
      });
    });
    deleteThisClone();
  });
});

// @a10
whenStartAsClone(() => {
  ifThen(equals(vars.ID, "fw影"), () => {
    setLookEffectTo("BRIGHTNESS", "-100");
    goToFrontBack("front");
    goForwardBackwardLayers("backward", vars.Fw);
    switchCostumeTo("le1");
    changeLookEffectBy("GHOST", "50");
    repeat("10", () => { nextCostume(); });
    repeat("2", () => {
      nextCostume();
      changeLookEffectBy("GHOST", "10");
    });
    deleteThisClone();
  });
});

// @a11
whenBroadcastReceived("Intro start", () => {});

// @a12
whenBroadcastReceived("Intro start", () => {
  call("Clone %s %s", "back", "");
  call("wait %s", "3");
  call("Clone %s %s", "text", "1");
  call("Fw %s %s %s %s %s type %s", "", "", "200", "10", "130", "b");
});

// @a13
script(() => {
  forever(() => { call("しゃけ %s %s %s %s", "12", "90", "", ""); });
});

// @a14
whenStartAsClone(() => {
  ifThen(equals(vars.ID, "back"), () => {
    setSizeTo("100");
    goToFrontBack("back");
    switchCostumeTo("back");
    setLookEffectTo("GHOST", "100");
    repeat("50", () => { changeLookEffectBy("GHOST", "-2"); });
  });
});

// @a15
whenStartAsClone(() => {
  ifThen(equals(vars.ID, "fw"), () => {
    setLookEffectTo("GHOST", "0");
    goToFrontBack("front");
    ifElse(equals(vars["Fw type"], "a"), () => {
      setLookEffectTo("COLOR", vars["Fw Color"]);
      switchCostumeTo("le1");
      repeat("10", () => { nextCostume(); });
      repeat("2", () => {
        nextCostume();
        changeLookEffectBy("GHOST", "10");
      });
      deleteThisClone();
    }, () => {
      ifElse(equals(vars["Fw type"], "b"), () => {
        ifElse(listContains(lists["Fwのためだけのリスト。"], vars.Fw), () => {
          setLookEffectTo("BRIGHTNESS", "100");
          setLookEffectTo("COLOR", vars["Fw Color"]);
          switchCostumeTo("le1");
          repeat("10", () => { nextCostume(); });
          repeat("2", () => {
            nextCostume();
            changeLookEffectBy("GHOST", "10");
          });
          deleteThisClone();
        }, () => {
          setLookEffectTo("BRIGHTNESS", "0");
          setLookEffectTo("COLOR", vars["Fw Color"]);
          switchCostumeTo("le1");
          repeat("10", () => { nextCostume(); });
          repeat("2", () => {
            nextCostume();
            changeLookEffectBy("GHOST", "10");
          });
          deleteThisClone();
        });
      }, () => {});
    });
  });
});

// @a16
whenBroadcastReceived("Intro start", () => {
  deleteAllOfList(lists.おとはっめ);
  insertAtList("3.33", "1", lists.おとはっめ);
  insertAtList("4.29", "2", lists.おとはっめ);
  insertAtList("5", "3", lists.おとはっめ);
  insertAtList("5.74", "4", lists.おとはっめ);
  insertAtList("6.3", "5", lists.おとはっめ);
  insertAtList("6", "6", lists.おとはっめ);
  insertAtList("7.1", "7", lists.おとはっめ);
  insertAtList("", "8", lists.おとはっめ);
  insertAtList("8.2", "9", lists.おとはっめ);
  insertAtList("9.8", "10", lists.おとはっめ);
  insertAtList("10.5", "11", lists.おとはっめ);
});

// @a17
whenStartAsClone(() => {
  ifThen(equals(vars.ID, "light"), () => {
    setSizeTo("100");
    goToFrontBack("front");
    switchCostumeTo("Light");
  });
});

// @a18
whenStartAsClone(() => {
  ifThen(equals(vars.ID, "text"), () => {
    goToFrontBack("front");
    setVariableTo(vars["clone Z"], "0");
    switchCostumeTo("text");
    repeatUntil(equals(round(vars["clone Z"]), "100"), () => { changeVariableBy(vars["clone Z"], divide(subtract("100", vars["clone Z"]), "3")); });
    call("wait %s", "4");
    hide();
    call("wait %s", "4.5");
    show();
    call("wait %s", "10.5");
    call("ふぇどあ");
    deleteThisClone();
  });
});

// @a19
whenStartAsClone(() => { ifThen(equals(vars.ID, "text"), () => { forever(() => { goToFrontBack("front"); }); }); });

// @a20
script(() => {
  call("Fw %s %s %s %s %s type %s", "", "", "100", "14", "130", "b");
});

// @a21
whenBroadcastReceived("Intro start", () => {
  call("wait %s", itemOfList("1", lists.おとはっめ));
  call("しゃけ %s %s %s %s", "25", "90", "", "");
  call("wait %s", itemOfList("3", lists.おとはっめ));
  call("b");
  call("しゃけ %s %s %s %s", "25", "90", "", "");
  call("wait %s", itemOfList("4", lists.おとはっめ));
  call("しゃけ %s %s %s %s", "25", "90", "", "");
  call("wait %s", itemOfList("7", lists.おとはっめ));
  call("Rw %s %s %s %s %s", "", "", "", "100", "120");
  call("Rw %s %s %s %s %s", "", "", "", "200", "120");
  call("しゃけ %s %s %s %s", "25", "90", "", "");
  call("wait %s", itemOfList("11", lists.おとはっめ));
  setVariableTo(vars["(ﾟ∀ﾟ)"], "30");
});

// @a22
whenBroadcastReceived("Intro start", () => {
  playSoundUntilDone("Catch Me (Wy Flip)");
  wait("2");
  broadcast("イントロ完");
});

// @a23
whenBroadcastReceived("Intro start", () => {
  call("wait %s", "1");
  repeat("8", () => {
    setVariableTo(vars["clone Y"], "0");
    setVariableTo(vars["clone Dir"], "90");
    setVariableTo(vars["clone Z"], "1");
    call("Clone %s %s", "chev", "1");
    wait("0.5");
    setVariableTo(vars["clone X"], "0");
    setVariableTo(vars["clone Y"], "0");
    setVariableTo(vars["clone Dir"], "90");
    setVariableTo(vars["clone Z"], "1");
    call("Clone %s %s", "chev2", "1");
    wait("0.5");
  });
});

// @a24
define("しゃけ %s %s %s %s", { argumentDefaults: ["", "", "", "", "", ""] }, (たいむ, _ /* "°" */, x, y) => {
    setVariableTo(vars.しゃけ, "60");
    repeat(たいむ, () => {
      changeVariableBy(vars.しゃけ, divide(subtract("0", vars.しゃけ), "5"));
      goToXY(add(multiply(multiply(mathOp("sin", multiply(timer(), "600")), "0.9"), vars.しゃけ), x), add(multiply(multiply(mathOp("cos", multiply(timer(), "600")), "0.9"), vars.しゃけ), y));
      pointInDirection(add(multiply(multiply(mathOp("sin", multiply(timer(), "800")), "1.5"), divide(vars.しゃけ, "7")), _));
      setVariableTo(vars.ShakeDir, add(multiply(multiply(mathOp("sin", multiply(timer(), "800")), "1.5"), divide(vars.しゃけ, "7")), subtract(_, "90")));
      setVariableTo(vars.ShakeX, add(multiply(multiply(mathOp("sin", multiply(timer(), "600")), "0.9"), vars.しゃけ), x));
      setVariableTo(vars.ShakeY, add(multiply(multiply(mathOp("cos", multiply(timer(), "600")), "0.9"), vars.しゃけ), y));
    });
  });

// @a25
vars["(ﾟ∀ﾟ)"];

// @a26
define("ふぇどあ", () => {
    setVariableTo(vars.加速イージング, "5");
    repeat("35", () => {
      setVariableTo(vars.加速イージング, multiply(vars.加速イージング, "1.12"));
      changeVariableBy(vars["clone Y"], subtract(vars.加速イージング, multiply(vars.加速イージング, "2.01")));
      turnRight(divide(vars.加速イージング, "3"));
    });
    deleteThisClone();
  });

// @a27
script(() => {
  setVariableTo(vars["clone X"], "0");
});

// @a28
whenStartAsClone(() => {
  ifThen(equals(vars.ID, "chev"), () => {
    switchCostumeTo("コスチューム1");
    repeatUntil(undefined, () => {
      changeVariableBy(vars["clone Z"], divide(multiply(vars["(ﾟ∀ﾟ)"], vars["clone Z"]), "100"));
      setVariableTo(vars["clone Dir"], "90");
      setVariableTo(vars["clone X"], "");
      setVariableTo(vars["clone Y"], "");
    });
  });
});

// @a29
whenStartAsClone(() => {
  ifThen(equals(vars.ID, "chev2"), () => {
    switchCostumeTo("コスチューム1");
    setLookEffectTo("BRIGHTNESS", "90");
    repeatUntil(undefined, () => {
      changeVariableBy(vars["clone Z"], divide(multiply(vars["(ﾟ∀ﾟ)"], vars["clone Z"]), "100"));
      setVariableTo(vars["clone Dir"], "90");
      setVariableTo(vars["clone X"], "");
      setVariableTo(vars["clone Y"], "");
    });
  });
});

// @a30
multiply(vars["(ﾟ∀ﾟ)"], vars["clone Z"]);

// @a31
whenStartAsClone(() => {
  show();
  ifThen(equals(vars["Cam Control?"], "1"), () => { forever(() => { call("position %s", costumeNumberName("name")); }); });
});

// @a32
define("Clone %s %s", { warp: true }, (ID, CC_ /* "CC?" */) => {
    setVariableTo(vars["Cam Control?"], CC_);
    setVariableTo(vars.ID, ID);
    createCloneOf("_myself_");
  });

// @a33
define("wait %s", (time) => {
    waitUntil(greaterThan(timer(), time));
  });

// @a34
whenBroadcastReceived("Intro start", () => {
  call("wait %s", itemOfList("6", lists.おとはっめ));
  call("Rw %s %s %s %s %s", "-200", "", "45", "50", "120");
  call("Rw %s %s %s %s %s", "-100", "", "45", "50", "120");
  call("Rw %s %s %s %s %s", "", "", "45", "50", "120");
  call("Rw %s %s %s %s %s", "100", "", "45", "50", "120");
  call("Rw %s %s %s %s %s", "200", "", "45", "50", "120");
  call("Rw %s %s %s %s %s", "-200", "100", "45", "50", "120");
  call("Rw %s %s %s %s %s", "-100", "100", "45", "50", "120");
  call("Rw %s %s %s %s %s", "", "100", "45", "50", "120");
  call("Rw %s %s %s %s %s", "100", "100", "45", "50", "120");
  call("Rw %s %s %s %s %s", "200", "100", "45", "50", "120");
  call("Rw %s %s %s %s %s", "-200", "200", "45", "50", "120");
  call("Rw %s %s %s %s %s", "-100", "200", "45", "50", "120");
  call("Rw %s %s %s %s %s", "", "200", "45", "50", "120");
  call("Rw %s %s %s %s %s", "100", "200", "45", "50", "120");
  call("Rw %s %s %s %s %s", "200", "200", "45", "50", "120");
  call("Rw %s %s %s %s %s", "-200", "-100", "45", "50", "120");
  call("Rw %s %s %s %s %s", "-100", "-100", "45", "50", "120");
  call("Rw %s %s %s %s %s", "", "-100", "45", "50", "120");
  call("Rw %s %s %s %s %s", "100", "-100", "45", "50", "120");
  call("Rw %s %s %s %s %s", "200", "-100", "45", "50", "120");
  call("Rw %s %s %s %s %s", "-200", "-200", "45", "50", "120");
  call("Rw %s %s %s %s %s", "-100", "-200", "45", "50", "120");
  call("Rw %s %s %s %s %s", "", "-200", "45", "50", "120");
  call("Rw %s %s %s %s %s", "100", "-200", "45", "50", "120");
  call("Rw %s %s %s %s %s", "200", "-200", "45", "50", "120");
  repeatUntil(equals(round(vars["🎥 Dir"]), "180"), () => { changeVariableBy(vars["🎥 Dir"], divide(subtract("180", vars["🎥 Dir"]), "3")); });
  wait("0");
  repeatUntil(equals(round(vars["🎥 Dir"]), "360"), () => { changeVariableBy(vars["🎥 Dir"], divide(subtract("360", vars["🎥 Dir"]), "2.5")); });
});

// @a35
comment("FOR ALL SPRITES! This variables controls the direction of the \"camera\".");

// @a36
comment("FOR ALL SPRITES! This variable is used to change the direction of the camera (try changing the sliders)");

// @a37
comment("FOR ALL SPRITES! This variable is used to set the x position of the camera (try changing the sliders)");

// @a38
comment("FOR ALL SPRITES! This variables controls the x position of the \"camera\".");

// @a39
script(() => {
  changeVariableBy(vars["clone Dir"], divide(subtract("150", vars["clone Dir"]), "37"));
});

// @a40
whenBroadcastReceived("Intro start", () => {});

// @a41
comment("FOR ALL SPRITES! This variable is used to set the y position of the camera (try changing the sliders)");

// @a42
comment("FOR ALL SPRITES! This variables controls the y position of the \"camera\".");

// @a43
comment("FOR ALL SPRITES! This variable is used to set the Z position (size) of the camera (try changing the sliders)");

// @a44
comment("FOR ALL SPRITES! This variables controls the z position (size) of the \"camera\".");

// @a45
whenBroadcastReceived("Intro start", () => {
  switchCostumeTo("おおきさかんりよう()");
  resetTimer();
  goToXY("0", "0");
  pointInDirection("90");
  setSizeTo("0");
  hide();
  setVariableTo(vars["🎥 Dir"], "0");
  setVariableTo(vars["🎥 X"], "0");
  setVariableTo(vars["🎥 Y"], "0");
  setVariableTo(vars["🎥 Z"], "1");
  setVariableTo(vars["clone Dir"], "90");
  setVariableTo(vars["clone X"], "");
  setVariableTo(vars["clone Y"], "");
  setVariableTo(vars["clone Z"], "0");
});

// @a46
direction();

// @a47
comment("FOR THIS SPRITE ONLY! This variable controls the direction of each INDIVIDUAL clone");

// @a48
comment("FOR THIS SPRITE ONLY! This variable is used to set the direction of each INDIVIDUAL clone.");

// @a49
comment("FOR THIS SPRITE ONLY! This variable controls the x position of each INDIVIDUAL clone");

// @a50
comment("FOR THIS SPRITE ONLY! This variable is used to set the x position of each INDIVIDUAL clone. Not according to the camera");

// @a51
comment("FOR THIS SPRITE ONLY! This variable is used to set the y position of each INDIVIDUAL clone. Not according to the camera");

// @a52
comment("FOR THIS SPRITE ONLY! This variable controls the y position of each INDIVIDUAL clone");

// @a53
define("position %s", { warp: true, argumentDefaults: ["", ""] }, ($arg /* "" */) => {
    ifElse(greaterThan(size(), "100"), () => { switchCostumeTo("Filler (Size)"); }, () => { switchCostumeTo("Screen"); });
    setSizeTo(multiply(vars["clone Z"], vars["🎥 Z"]));
    switchCostumeTo("Filler (Movement)");
    pointInDirection(subtract(vars["clone Dir"], add(vars["🎥 Dir"], vars.ShakeDir)));
    // @c1
    // This is the block that positions the clones. It uses some trigonometry, and I dont fully understand how it works, but you can view some of @MathMathMath's tutorials for more info
    goToXY(subtract(multiply(multiply(add(vars["clone X"], add(vars["🎥 X"], vars.ShakeX)), vars["🎥 Z"]), mathOp("cos", add(vars["🎥 Dir"], vars.ShakeDir))), multiply(multiply(add(vars["clone Y"], add(vars["🎥 Y"], vars.ShakeY)), vars["🎥 Z"]), mathOp("sin", add(vars["🎥 Dir"], vars.ShakeDir)))), add(multiply(multiply(add(vars["clone X"], add(vars["🎥 X"], vars.ShakeX)), vars["🎥 Z"]), mathOp("sin", add(vars["🎥 Dir"], vars.ShakeDir))), multiply(multiply(add(vars["clone Y"], add(vars["🎥 Y"], vars.ShakeY)), vars["🎥 Z"]), mathOp("cos", add(vars["🎥 Dir"], vars.ShakeDir)))));
    switchCostumeTo($arg);
  });

// @a54
comment("FOR THIS SPRITE ONLY! This variable is used to set the z position (size) of each INDIVIDUAL clone. Not according to the camera");

// @a55
comment("FOR THIS SPRITE ONLY! This variable controls the z position (size) of each INDIVIDUAL clone. Unlike Camera Z, this value can from 0 to 100, not just 0 to 1");

// @a56
whenStartAsClone(() => {
  show();
  ifThen(equals(vars.ID, "g"), () => {
    goToFrontBack("front");
    setSizeTo("100");
    switchCostumeTo("g");
    goToXY("-118", "0");
    call("Sw Type %s x,y,dir %s %s %s size %s Color %s", "a", xPosition(), "50", "-90", "50", "120");
    repeatUntil(lessThan("5", timer()), () => {
      call("a");
      goToXY(multiply(mathOp("sin", vars.θ), "-118"), multiply(mathOp("cos", vars.θ), "-118"));
    });
    deleteThisClone();
  });
  ifThen(equals(vars.ID, "o"), () => {
    goToFrontBack("front");
    setSizeTo("100");
    switchCostumeTo("o");
    goToXY("-76", "0");
    call("Sw Type %s x,y,dir %s %s %s size %s Color %s", "a", xPosition(), "-50", "-90", "50", "120");
    repeatUntil(lessThan("4.5", timer()), () => { goToXY(multiply(mathOp("sin", vars.θ), "-76"), multiply(mathOp("cos", vars.θ), "-76")); });
    deleteThisClone();
  });
  ifThen(equals(vars.ID, "r"), () => {
    goToFrontBack("front");
    setSizeTo("100");
    switchCostumeTo("r");
    goToXY("-31", "");
    call("Sw Type %s x,y,dir %s %s %s size %s Color %s", "a", xPosition(), "50", "-90", "50", "120");
    repeatUntil(lessThan("4.5", timer()), () => {
      call("a");
      goToXY(multiply(mathOp("sin", vars.θ), "-31"), multiply(mathOp("cos", vars.θ), "-31"));
    });
    deleteThisClone();
  });
  ifThen(equals(vars.ID, "i"), () => {
    goToFrontBack("front");
    setSizeTo("100");
    switchCostumeTo("i");
    goToXY("3", "");
    call("Sw Type %s x,y,dir %s %s %s size %s Color %s", "a", xPosition(), "-50", "-90", "50", "120");
    repeatUntil(lessThan("4.5", timer()), () => {
      call("a");
      goToXY(multiply(mathOp("sin", vars.θ), "3"), multiply(mathOp("cos", vars.θ), "3"));
    });
    deleteThisClone();
  });
  ifThen(equals(vars.ID, "r2"), () => {
    goToFrontBack("front");
    setSizeTo("100");
    switchCostumeTo("r2");
    goToXY("40", "");
    call("Sw Type %s x,y,dir %s %s %s size %s Color %s", "a", xPosition(), "50", "-90", "50", "120");
    repeatUntil(lessThan("4.5", timer()), () => {
      call("a");
      goToXY(multiply(mathOp("sin", vars.θ), "40"), multiply(mathOp("cos", vars.θ), "40"));
    });
    deleteThisClone();
  });
  ifThen(equals(vars.ID, "a"), () => {
    goToFrontBack("front");
    setSizeTo("100");
    switchCostumeTo("a");
    goToXY("83", "");
    call("Sw Type %s x,y,dir %s %s %s size %s Color %s", "a", xPosition(), "-50", "-90", "50", "120");
    repeatUntil(lessThan("4.5", timer()), () => {
      call("a");
      goToXY(multiply(mathOp("sin", vars.θ), "83"), multiply(mathOp("cos", vars.θ), "83"));
    });
    deleteThisClone();
  });
  ifThen(equals(vars.ID, "f"), () => {
    goToFrontBack("front");
    setSizeTo("100");
    goToXY("123", "");
    call("Sw Type %s x,y,dir %s %s %s size %s Color %s", "a", xPosition(), "50", "-90", "50", "120");
    switchCostumeTo("f");
    repeatUntil(lessThan("4.5", timer()), () => {
      call("a");
      goToXY(multiply(mathOp("sin", vars.θ), "123"), multiply(mathOp("cos", vars.θ), "123"));
    });
    deleteThisClone();
  });
});

// @a57
whenBroadcastReceived("Intro start", () => { setVariableTo(vars["(ﾟ∀ﾟ)"], "10"); });

// @a58
whenBroadcastReceived("Intro start", () => {
  call("wait %s", "8");
  call("Fw %s %s %s %s %s type %s", "", "", "100", "10", "125", "b");
  repeatUntil(equals(round(vars["🎥 X"]), "180"), () => { changeVariableBy(vars["🎥 X"], divide(subtract("180", vars["🎥 X"]), "4")); });
  call("Fw %s %s %s %s %s type %s", "180", "", "100", "10", "125", "b");
  repeatUntil(equals(round(vars["🎥 X"]), "-180"), () => { changeVariableBy(vars["🎥 X"], divide(subtract("-180", vars["🎥 X"]), "4")); });
  call("Fw %s %s %s %s %s type %s", "-180", "", "100", "10", "125", "b");
  repeatUntil(equals(round(vars["🎥 X"]), "0"), () => { changeVariableBy(vars["🎥 X"], divide(subtract("0", vars["🎥 X"]), "3")); });
  call("Sw Type %s x,y,dir %s %s %s size %s Color %s", "a", "", "", "", "100", "115");
  call("Sw Type %s x,y,dir %s %s %s size %s Color %s", "a", "150", "", "", "100", "130");
  call("Sw Type %s x,y,dir %s %s %s size %s Color %s", "a", "-150", "", "", "100", "130");
  call("Sw Type %s x,y,dir %s %s %s size %s Color %s", "a", "", "150", "", "100", "130");
  call("Sw Type %s x,y,dir %s %s %s size %s Color %s", "a", "150", "150", "", "100", "115");
  call("Sw Type %s x,y,dir %s %s %s size %s Color %s", "a", "-150", "150", "", "100", "115");
  call("Sw Type %s x,y,dir %s %s %s size %s Color %s", "a", "", "-150", "", "100", "130");
  call("Sw Type %s x,y,dir %s %s %s size %s Color %s", "a", "150", "-150", "", "100", "115");
  call("Sw Type %s x,y,dir %s %s %s size %s Color %s", "a", "-150", "-150", "", "100", "115");
});

// @a59
script(() => {
  call("Rw %s %s %s %s %s", "", "", "", "200", "120");
});

// @a60
script(() => {
  call("Clone %s %s", "g", "");
});

// @a61
equals(costumeNumberName("name"), "text");

// @a62
vars["(ﾟ∀ﾟ)"];

// @a63
divide(subtract("10", "5"), "10");

// @a64
script(() => {
  switchCostumeTo("o");
  goToXY("-76", "");
});

// @a65
script(() => {
  switchCostumeTo("g");
});

// @a66
script(() => {
  switchCostumeTo("r2");
  goToXY("40", "");
});

// @a67
script(() => {
  switchCostumeTo("i");
  goToXY("3", "");
});

// @a68
define("a", () => {});

// @a69
define("b", () => {
    call("Sw Type %s x,y,dir %s %s %s size %s Color %s", "a", "", "", "90", "100", "120");
    call("Sw Type %s x,y,dir %s %s %s size %s Color %s", "a", "", "", "90", "200", "120");
  });

// @a70
script(() => {
  switchCostumeTo("f");
});

// @a71
whenStartAsClone(() => {
  call("wait %s", "10.4");
  ifElse(not(or(or(contains(costumeNumberName("name"), "le"), equals(costumeNumberName("name"), "text")), undefined)), () => {
    repeat("4", () => {
      changeLookEffectBy("BRIGHTNESS", "25");
      changeLookEffectBy("GHOST", "25");
    });
    deleteThisClone();
  }, () => {});
});

// @a72
whenBroadcastReceived("Intro start", () => {
  call("wait %s", "8");
  setVariableTo(vars["🎥 Dir"], "0");
  setVariableTo(vars.A, "1");
  repeat("72", () => { changeVariableBy(vars["🎥 Dir"], "5"); });
});

// @a73
script(() => {
  switchCostumeTo("r");
  goToXY("-31", "");
});

// @a74
script(() => {
  switchCostumeTo("a");
  goToXY("83", "");
});

// @a75
whenBroadcastReceived("Intro start", () => {
  setVariableTo(vars.b, "1");
  call("wait %s", "4");
  setVariableTo(vars.θ, "90");
  call("Clone %s %s", "g", "");
  call("Clone %s %s", "o", "");
  call("Clone %s %s", "r", " ");
  call("Clone %s %s", "i", " ");
  call("Clone %s %s", "r2", " ");
  call("Clone %s %s", "a", " ");
  call("Clone %s %s", "f", " ");
  repeat("18", () => { changeVariableBy(vars.θ, "20"); });
});

// @a76
script(() => {
  setVariableTo(vars.b, multiply(vars.b, "1.11"));
  turnRight(vars.b);
});
